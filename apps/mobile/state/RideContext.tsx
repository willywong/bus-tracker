import {
  plannerRealtimeRoutes,
  WALKING_METERS_PER_MINUTE,
  type Itinerary,
  type LatLng,
  type Leg,
  type Mode,
  type Place,
  type TransitNetwork,
} from '@bus-tracker/shared';
import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { formatStopName } from '@/components/map/format';
import { lineName, routeInfoOf } from '@/components/plan/results';
import {
  advanceJourney,
  honestTiming,
  journeyActivityProps,
  journeyPaths,
  keepWalkPaths,
  offRouteMeters,
  offRouteStep,
  retimeFrom,
  retimeJourney,
  type JourneyProgress,
} from '@/components/ride/journey';
import {
  advanceRide,
  isLoopRoute,
  rideDestinations,
  rideMinutes,
  rideSequence,
  type RideProgress,
  type RideStop,
} from '@/components/ride/model';
import { useJourneyLiveActivity } from '@/hooks/useJourneyLiveActivity';
import { plannerStore } from '@/hooks/usePlannerEngine';
import { clearGoGeofences, startGoGeofences } from '@/services/arrival/geofence';
import { setGoActive } from '@/services/liveActivityOwner';
import { workspaceBusy } from '@/services/planner/workspace';
import type { RealtimeSnapshot } from '@/services/realtime';
import {
  cancelGetOffAlert,
  cancelJourneyAlert,
  cancelJourneyAlerts,
  ensureNotificationPermission,
  scheduleGetOffAlert,
  scheduleJourneyAlerts,
  speakGetOff,
} from '@/services/reminders/notifications';
import {
  goLegAlertId,
  journeyAlertsMoved,
  planJourneyAlerts,
  type JourneyAlertOptions,
} from '@/services/reminders/plan';
import { usePlanner } from '@/state/PlannerContext';
import { useTrip } from '@/state/TripContext';
import { devClockOffsetMs, devNow } from '@/utils/devClock';
import { haptics } from '@/utils/haptics';

type Ride = Extract<Leg, { kind: 'ride' }>;

/** One route: from your boarding stop to where you get off. */
interface RouteRide {
  kind: 'route';
  routeCode: string;
  boardStopId: string;
  destStopId: string;
  /** The live bus you boarded, when we knew it. Its fixes stand in for your GPS. */
  vehicleId: string | null;
}

/** Go (15/06): an itinerary, leg by leg. */
interface JourneyRide {
  kind: 'journey';
  /** As followed now: re-timed from live positions, a broken tail re-planned. */
  itinerary: Itinerary;
  startedAt: number;
  /** The first bus leg's live vehicle when Go started. */
  vehicleId: string | null;
  /** What `retime` starts from: the itinerary as started, or the last re-planned one adopted. */
  base: Itinerary;
  /** The network it was planned on, the destination and modes: `retime`'s context. */
  net: TransitNetwork;
  to: Place;
  modes: readonly Mode[] | undefined;
  /** The arrival when Go started: "Times updated · was 9:12". */
  startedArriveAt: number;
  /** Apple walking paths from the itinerary sheet, by leg index. */
  walkPaths: Record<number, LatLng[]>;
}

type ActiveRide = RouteRide | JourneyRide;

export interface RideContextValue {
  /** Stops you can ride to from your boarding stop, in order. */
  destinations: RideStop[];
  /** A single-route ride is on ("Alert me before my stop"). A journey is `itinerary`. */
  active: boolean;
  destination: RideStop | null;
  progress: RideProgress | null;
  /** Minutes left, roughly. */
  minutesLeft: number | null;
  /** Where the position comes from: your phone, the bus feed, or nothing yet. */
  positionSource: 'phone' | 'bus' | null;
  speak: boolean;
  setSpeak: (on: boolean) => void;
  start: (destStopId: string) => void;
  /** Ends a route ride or a journey. */
  end: () => void;

  // --- Go (15/06) ---------------------------------------------------------
  /** The journey being followed, as shown: live only while live (`honestTiming`). */
  itinerary: Itinerary | null;
  /** Where you are on it. */
  journey: JourneyProgress | null;
  /** The network it was planned on (names, stations, shapes). */
  journeyNetwork: TransitNetwork | null;
  /** Where it goes, for "To KLCC" and a re-plan. */
  journeyDestination: Place | null;
  /** Apple walking paths for its walks, by leg index. */
  journeyWalkPaths: Readonly<Record<number, LatLng[]>>;
  /** The current bus leg's feed isn't polled (no spare budget): it stays "Scheduled". */
  journeyLiveSkipped: boolean;
  /** Follows `it` (the open itinerary): replaces any ride, ends following a bus. */
  startJourney: (it: Itinerary) => void;
  /** More than 400 m off the route for 30 s: offer a re-plan, never do one. */
  offRoute: boolean;
  /** "Not now": hides the off-route row for 5 minutes. */
  dismissOffRoute: () => void;
  /** Your phone's last fix while riding either way (the map frames it with the leg). */
  here: LatLng | null;
}

const RideContext = createContext<RideContextValue | null>(null);

/** Arrived rides close themselves after this. */
const AUTO_END_MS = 2 * 60_000;
/** Reschedule the background alert only when the estimate moves this much. */
const RESCHEDULE_DRIFT_MS = 60_000;
/** Go steps on this beat as well as on each fix, so rail legs move with no GPS. */
const JOURNEY_TICK_MS = 15_000;
/** "Get off" holds this long before the sheet moves to the next leg. */
const LEG_DONE_HOLD_MS = 4_000;
/** "Not now" on the off-route row. */
const OFF_ROUTE_SNOOZE_MS = 5 * 60_000;

const isBusLeg = (l: Leg | undefined): l is Ride => l?.kind === 'ride' && (l.mode === 'bus' || l.mode === 'feeder');
const isRailLeg = (l: Leg | undefined): l is Ride => l?.kind === 'ride' && !isBusLeg(l);

/** Go's alert copy: line names from the network, bus stops display-cased. */
function alertOptions(net: TransitNetwork): JourneyAlertOptions {
  const routes = routeInfoOf(net);
  return {
    lineName: (l) => (l.mode === 'bus' || l.mode === 'feeder' ? l.label : lineName(routes.longName(l.route) || l.label)),
    stopName: (p, bus) => (bus ? formatStopName(p.name) : p.name),
  };
}

/** The legs from `from` on, as an itinerary: what's left to poll for. */
function remaining(it: Itinerary, from: number): Itinerary {
  return { ...it, legs: it.legs.slice(Math.max(0, Math.min(from, it.legs.length - 1))) };
}

/**
 * On-board mode, two ways:
 * - **A route:** pick where you get off and BusBuddy counts the stops down,
 *   buzzes (and optionally speaks) when yours is next, and schedules a
 *   notification for the estimated time in case the screen is off.
 * - **A journey (Go, 15/06):** an itinerary from the planner, leg by leg:
 *   its walks, waits and rides, the Live Activity on the current leg,
 *   timed leave / change / get-off alerts (and a geofence per alight stop
 *   when the arrival alert is on), re-timed with live buses as it goes, and
 *   an offer to re-plan when you leave the route.
 * Uses your phone's location while the app is open (When In Use only),
 * falling back to the bus's own position from the feed.
 */
export function RideProvider({ children }: { children: ReactNode }) {
  const trip = useTrip();
  const planner = usePlanner();
  const [ride, setRide] = useState<ActiveRide | null>(null);
  const [speak, setSpeak] = useState(false);
  const [phone, setPhone] = useState<{ lat: number; lng: number } | null>(null);
  const [progress, setProgress] = useState<RideProgress | null>(null);

  const routeRide = ride?.kind === 'route' ? ride : null;
  const journeyRide = ride?.kind === 'journey' ? ride : null;

  const ordered = useMemo<RideStop[]>(
    () =>
      (trip.route?.stops ?? []).map((s) => ({
        stopId: s.stop_id,
        name: formatStopName(s.stop_name),
        lat: s.stop_lat,
        lng: s.stop_lon,
      })),
    [trip.route?.stops],
  );
  const isLoop = useMemo(() => isLoopRoute(trip.route?.polyline ?? []), [trip.route?.polyline]);

  const destinations = useMemo(
    () => (trip.stopId ? rideDestinations(ordered, trip.stopId, isLoop) : []),
    [ordered, trip.stopId, isLoop],
  );

  const seq = useMemo(
    () => (routeRide ? rideSequence(ordered, routeRide.boardStopId, routeRide.destStopId, isLoop) : []),
    [routeRide, ordered, isLoop],
  );

  // Switching route or stop ends a route ride; it no longer describes your
  // trip. A journey doesn't depend on the tracked route.
  useEffect(() => {
    if (routeRide && (routeRide.routeCode !== trip.routeCode || routeRide.boardStopId !== trip.stopId)) {
      setRide(null);
    }
  }, [routeRide, trip.routeCode, trip.stopId]);

  // Phone GPS while riding either way, if location is already allowed. Never prompts here.
  const riding = ride != null;
  useEffect(() => {
    if (!riding) {
      setPhone(null);
      return;
    }
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15 },
        (loc) => setPhone({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
      );
      if (cancelled) sub.remove();
    })().catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [riding]);

  const busFix = routeRide?.vehicleId
    ? trip.bus.positions.find((p) => p.vehicleId === routeRide.vehicleId) ?? null
    : null;
  const position = phone ?? (busFix ? { lat: busFix.lat, lng: busFix.lng } : null);
  const routeSource = phone ? 'phone' : busFix ? 'bus' : null;

  useEffect(() => {
    if (!routeRide || seq.length < 2) {
      setProgress(null);
      return;
    }
    setProgress((prev) => advanceRide(seq, position, prev?.passedIndex ?? 0));
    // position is a fresh object each render; key on its coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRide, seq, position?.lat, position?.lng]);

  // The two moments: your stop is next, and you're there.
  const prevPhase = useRef<RideProgress['phase'] | null>(null);
  useEffect(() => {
    const phase = progress?.phase ?? null;
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (!phase || phase === was || was == null) return;
    if (phase === 'next-is-yours' && progress?.nextStop) {
      haptics.warning();
      if (speak) speakGetOff(progress.nextStop.name);
      void cancelGetOffAlert();
    } else if (phase === 'arrived') {
      haptics.success();
    }
  }, [progress, speak]);

  // Background safety net: a notification around when your stop is next.
  const scheduledAt = useRef<number | null>(null);
  useEffect(() => {
    if (!routeRide || !progress || progress.phase !== 'riding') return;
    const dest = seq[seq.length - 1];
    if (!dest) return;
    // A minute or so before the estimated arrival, about one stop early.
    const atMs = Date.now() + Math.max(0, rideMinutes(progress.remainingMeters) - 1) * 60_000;
    if (scheduledAt.current != null && Math.abs(scheduledAt.current - atMs) < RESCHEDULE_DRIFT_MS) return;
    scheduledAt.current = atMs;
    void scheduleGetOffAlert({ stopName: dest.name, atMs }).catch(() => {});
  }, [routeRide, progress, seq]);

  useEffect(() => {
    if (progress?.phase !== 'arrived') return;
    const t = setTimeout(() => setRide(null), AUTO_END_MS);
    return () => clearTimeout(t);
  }, [progress?.phase]);

  // Ending (or auto-ending) a route ride clears the pending alert.
  const routeActive = routeRide != null;
  useEffect(() => {
    if (routeActive) return;
    scheduledAt.current = null;
    prevPhase.current = null;
    void cancelGetOffAlert().catch(() => {});
  }, [routeActive]);

  // =========================================================================
  // Go: a journey, leg by leg
  // =========================================================================
  const journeyKey = journeyRide?.startedAt ?? null;
  const [journey, setJourney] = useState<JourneyProgress | null>(null);
  const [tick, setTick] = useState(0);
  const [snap, setSnap] = useState<RealtimeSnapshot | null>(null);

  // The beat: rail legs and the clock fallbacks move with no GPS.
  useEffect(() => {
    if (journeyKey == null) return;
    const t = setInterval(() => setTick((n) => n + 1), JOURNEY_TICK_MS);
    return () => clearInterval(t);
  }, [journeyKey]);

  // Live buses for the journey, polled under its own name ('go'): closing
  // the planner's sheets drops the planner's routes, never these.
  useEffect(() => {
    if (journeyKey == null) {
      setSnap(null);
      return;
    }
    plannerStore.start();
    setSnap(plannerStore.getSnapshot());
    const unsubscribe = plannerStore.subscribe(() => setSnap(plannerStore.getSnapshot()));
    return () => {
      unsubscribe();
      plannerStore.setExtraRoutes('go', []);
      plannerStore.stop();
    };
  }, [journeyKey]);

  const legIndex = journey?.legIndex ?? 0;
  const currentLeg = journeyRide?.itinerary.legs[legIndex];
  // A bus leg the feed can't afford stays "Scheduled" in the sheet and on the Lock Screen.
  const journeyLiveSkipped = useMemo(() => {
    if (!journeyRide || !snap || snap.plannerSkipped.length === 0) return false;
    const feeds = plannerRealtimeRoutes([remaining(journeyRide.itinerary, legIndex)], journeyRide.net, devNow());
    return feeds.some((f) => snap.plannerSkipped.includes(f.category));
  }, [journeyRide, snap, legIndex]);

  // Keep the current (or next) bus leg's route polled; the horizon moves with the clock.
  useEffect(() => {
    if (!journeyRide) return;
    plannerStore.setExtraRoutes(
      'go',
      plannerRealtimeRoutes([remaining(journeyRide.itinerary, legIndex)], journeyRide.net, devNow()),
    );
  }, [journeyRide, legIndex, tick]);

  // The bus you're on stands in for your phone once it's due at the stop.
  const vehicleId =
    isBusLeg(currentLeg) && currentLeg.timing.kind === 'live' ? currentLeg.timing.vehicleId : journeyRide?.vehicleId ?? null;
  const vehicleDue = isBusLeg(currentLeg) && devNow() >= currentLeg.from.time;
  const journeyBusFix = useMemo(() => {
    if (!vehicleId || !vehicleDue || !snap) return null;
    for (const c of Object.values(snap.byCategory)) {
      const v = c.positions.find((p) => p.vehicleId === vehicleId);
      if (v) return { lat: v.lat, lng: v.lng };
    }
    return null;
  }, [vehicleId, vehicleDue, snap]);
  const journeyPosition = phone ?? journeyBusFix;
  const journeySource = phone ? 'phone' : journeyBusFix ? 'bus' : null;

  // advanceJourney on each fix, on the beat, and when a retime moves the legs.
  const journeyIt = journeyRide?.itinerary ?? null;
  useEffect(() => {
    if (!journeyIt) {
      setJourney(null);
      return;
    }
    setJourney((prev) => advanceJourney(journeyIt, prev, journeyPosition, devNow()));
    // journeyPosition is a fresh object each render; key on its coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyIt, journeyPosition?.lat, journeyPosition?.lng, tick]);

  // A leg done ("Get off at Pasar Seni") holds a moment, then the next leg.
  useEffect(() => {
    if (journey?.phase !== 'leg-done') return;
    const t = setTimeout(() => setTick((n) => n + 1), LEG_DONE_HOLD_MS);
    return () => clearTimeout(t);
  }, [journey]);

  // As followed now: a live time only while it's fresh and its feed is polled.
  const shown = useMemo(
    () => (journeyIt ? honestTiming(journeyIt, devNow(), journeyLiveSkipped) : null),
    // `tick` ages live fixes out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journeyIt, journeyLiveSkipped, tick],
  );

  // Live re-timing (spec §4.4): once per new snapshot, only the legs not yet
  // done, never while a plan() on the same network is mid-run.
  const latest = useRef({ ride: journeyRide, journey });
  latest.current = { ride: journeyRide, journey };
  const snapKey = snap ? `${snap.lastUpdated}|${snap.plannerSkipped.join(',')}` : null;
  useEffect(() => {
    const { ride: r, journey: p } = latest.current;
    if (!r || !p || !snap || Object.keys(snap.byCategory).length === 0) return;
    if (workspaceBusy(r.net)) return;
    const next = retimeJourney(
      r.base,
      r.itinerary,
      retimeFrom(p),
      { byCategory: snap.byCategory },
      r.net,
      { to: r.to, walkMetersPerMin: WALKING_METERS_PER_MINUTE, modes: r.modes },
      r.startedArriveAt,
    );
    if (next === r.itinerary) return;
    // A broken transfer re-planned the tail: adopt it, and retime from it from now on.
    const replanned = next.id !== r.itinerary.id;
    setRide((cur) =>
      cur !== r
        ? cur
        : {
            ...r,
            itinerary: next,
            base: replanned ? next : r.base,
            walkPaths: replanned ? keepWalkPaths(r.itinerary, next, r.walkPaths) : r.walkPaths,
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey]);

  // Haptics (§7.9): your stop next on a ride, a warning (and speech); got
  // off a ride, or arrived, success. Walks and waits are quiet.
  const prevJourney = useRef<JourneyProgress | null>(null);
  const silenced = useRef(new Set<string>());
  useEffect(() => {
    const was = prevJourney.current;
    prevJourney.current = journey;
    if (!journey || !was || !journeyIt) return;
    if (journey.legIndex === was.legIndex && journey.phase === was.phase) return;
    const leg = journeyIt.legs[journey.legIndex];
    if (journey.phase === 'next-is-yours' && leg?.kind === 'ride') {
      haptics.warning();
      if (speak && journey.nextStop) speakGetOff(journey.nextStop.name);
      // Announced here: its timed alert would only repeat it.
      const ordinal = journeyIt.legs.slice(0, journey.legIndex).filter((l) => l.kind === 'ride').length;
      const id = goLegAlertId(ordinal);
      silenced.current.add(id);
      void cancelJourneyAlert(id).catch(() => {});
    } else if ((journey.phase === 'leg-done' && leg?.kind === 'ride') || journey.phase === 'arrived') {
      haptics.success();
    }
  }, [journey, journeyIt, speak]);

  // Timed alerts: leave, change, get off. Rescheduled when a retime moves one
  // by more than a minute (or adds or drops one).
  const scheduledAlerts = useRef(new Map<string, number>());
  useEffect(() => {
    if (!shown || !journeyRide) return;
    const now = devNow();
    const alerts = planJourneyAlerts(shown, now, alertOptions(journeyRide.net)).filter(
      (a) => !silenced.current.has(a.id),
    );
    // Alerts that have fired are no change.
    for (const [id, at] of scheduledAlerts.current) if (at <= now) scheduledAlerts.current.delete(id);
    if (!journeyAlertsMoved(scheduledAlerts.current, alerts, RESCHEDULE_DRIFT_MS)) return;
    scheduledAlerts.current = new Map(alerts.map((a) => [a.id, a.atMs]));
    // Itinerary times are on the dev clock; notifications fire on the device's.
    const offset = devClockOffsetMs();
    void scheduleJourneyAlerts(alerts.map((a) => ({ ...a, atMs: a.atMs - offset }))).catch(() => {});
    // `journeyRide.net` is fixed for the journey; `shown` carries its changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Geofences (opt-in): one per ride leg's alight stop, set when Go starts
  // and again after a re-plan. Never asks for Always.
  const shownId = shown?.id ?? null;
  useEffect(() => {
    const r = latest.current.ride;
    if (!r || !shownId) return;
    const offset = devClockOffsetMs();
    const legs = planJourneyAlerts(r.itinerary, -Infinity, alertOptions(r.net)).flatMap((a) => {
      const l = a.legIndex != null ? r.itinerary.legs[a.legIndex] : undefined;
      if (!l || l.kind !== 'ride') return [];
      const stopKey = l.to.stop != null ? (r.net.stops.id[l.to.stop] ?? `${l.to.stop}`) : `${l.to.lat},${l.to.lng}`;
      return [{ legIndex: a.legIndex!, stopKey, lat: l.to.lat, lng: l.to.lng, alert: { ...a, atMs: a.atMs - offset } }];
    });
    void startGoGeofences({ legs }).catch(() => {});
  }, [journeyKey, shownId]);

  // Off route: > 400 m from what's left of the route for 30 s, from the
  // phone's own fix. Not on a train (GPS is ignored there) or once arrived.
  const offSince = useRef<number | null>(null);
  const [offRouteRaw, setOffRouteRaw] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const journeyPhase = journey?.phase ?? null;
  useEffect(() => {
    const r = latest.current.ride;
    const leg = r?.itinerary.legs[legIndex];
    if (!r || !phone || journeyPhase == null || journeyPhase === 'arrived' || isRailLeg(leg)) {
      offSince.current = null;
      setOffRouteRaw(false);
      return;
    }
    const d = offRouteMeters(phone, journeyPaths(r.itinerary, legIndex, r.walkPaths));
    const step = offRouteStep(offSince.current, d, Date.now());
    offSince.current = step.since;
    setOffRouteRaw(step.off);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone?.lat, phone?.lng, tick, legIndex, journeyPhase, journeyIt]);
  const offRoute = offRouteRaw && Date.now() >= snoozedUntil;
  const dismissOffRoute = useCallback(() => setSnoozedUntil(Date.now() + OFF_ROUTE_SNOOZE_MS), []);

  // The Live Activity mirrors the current leg.
  const activityProps = useMemo(
    () => (shown && journey ? journeyActivityProps(shown, journey, devNow()) : null),
    [shown, journey],
  );
  useJourneyLiveActivity(activityProps);
  // Go owns the one Live Activity: a followed bus's waits until Go ends.
  const goOn = journeyRide != null;
  useEffect(() => {
    setGoActive(goOn);
    return () => setGoActive(false);
  }, [goOn]);

  // Arrived journeys close themselves too.
  useEffect(() => {
    if (journeyPhase !== 'arrived') return;
    const t = setTimeout(() => setRide((cur) => (cur?.kind === 'journey' ? null : cur)), AUTO_END_MS);
    return () => clearTimeout(t);
  }, [journeyPhase]);

  // A journey ending (or replaced) takes its alerts, regions and state with it.
  useEffect(() => {
    if (journeyKey == null) return;
    return () => {
      void cancelJourneyAlerts().catch(() => {});
      void clearGoGeofences().catch(() => {});
      scheduledAlerts.current = new Map();
      silenced.current = new Set();
      prevJourney.current = null;
      offSince.current = null;
      setOffRouteRaw(false);
      setSnoozedUntil(0);
    };
  }, [journeyKey]);

  const { run, walkPaths: plannerWalkPaths, to: plannerTo } = planner;
  const { unfollow } = trip;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const startJourney = useCallback(
    (it: Itinerary) => {
      const net = run.network;
      const last = it.legs[it.legs.length - 1];
      const to: Place | null =
        run.query?.to ?? plannerTo ?? (last ? { kind: 'place', name: last.to.name, lat: last.to.lat, lng: last.to.lng } : null);
      if (!net || !to || it.legs.length === 0) return;
      // One Live Activity at a time: Go takes over from a followed bus.
      // Silently: Go plays only its success haptic.
      unfollow({ silent: true });
      // The first step now, so the sheet shows the journey from the first frame.
      setJourney(advanceJourney(it, null, phoneRef.current, devNow()));
      setProgress(null);
      const firstBus = it.legs.find(isBusLeg);
      setRide({
        kind: 'journey',
        itinerary: it,
        startedAt: devNow(),
        vehicleId: firstBus?.timing.kind === 'live' ? firstBus.timing.vehicleId : null,
        base: it,
        net,
        to,
        modes: run.query?.modes,
        startedArriveAt: it.arriveAt,
        walkPaths: { ...plannerWalkPaths[it.id] },
      });
      haptics.success();
      // Asked on a user action, never at launch. Denied: timed alerts are
      // simply never shown; Go carries on.
      void ensureNotificationPermission().catch(() => {});
    },
    [run.network, run.query, plannerTo, plannerWalkPaths, unfollow],
  );

  const start = useCallback(
    (destStopId: string) => {
      if (!trip.routeCode || !trip.stopId) return;
      setProgress(null);
      setRide({
        kind: 'route',
        routeCode: trip.routeCode,
        boardStopId: trip.stopId,
        destStopId,
        vehicleId:
          trip.eta.primaryArrival?.kind === 'live'
            ? trip.eta.primaryArrival.live?.vehicleId ?? null
            : null,
      });
      haptics.success();
      // Asked on a user action, never at launch.
      void ensureNotificationPermission().catch(() => {});
    },
    [trip.routeCode, trip.stopId, trip.eta.primaryArrival],
  );

  const end = useCallback(() => {
    setRide(null);
    haptics.light();
  }, []);

  const destination = routeRide ? seq[seq.length - 1] ?? null : null;
  const routeIsActive = routeRide != null && seq.length >= 2;

  const value = useMemo<RideContextValue>(
    () => ({
      destinations,
      active: routeIsActive,
      destination,
      progress,
      minutesLeft: progress ? rideMinutes(progress.remainingMeters) : null,
      positionSource: journeyRide ? journeySource : routeSource,
      speak,
      setSpeak,
      start,
      end,
      itinerary: shown,
      journey: journeyRide ? journey : null,
      journeyNetwork: journeyRide?.net ?? null,
      journeyDestination: journeyRide?.to ?? null,
      journeyWalkPaths: journeyRide?.walkPaths ?? NO_PATHS,
      journeyLiveSkipped,
      startJourney,
      offRoute,
      dismissOffRoute,
      here: phone,
    }),
    [
      destinations,
      routeIsActive,
      destination,
      progress,
      journeyRide,
      journeySource,
      routeSource,
      speak,
      start,
      end,
      shown,
      journey,
      journeyLiveSkipped,
      startJourney,
      offRoute,
      dismissOffRoute,
      phone,
    ],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

const NO_PATHS: Readonly<Record<number, LatLng[]>> = {};

export function useRide(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used inside <RideProvider>');
  return ctx;
}
