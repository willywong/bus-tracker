import {
  computeEta,
  pickApproachingVehicle,
  polylineLength,
  toMalaysiaParts,
  type ComputeEtaResult,
  type EtaSource,
  type LatLng,
  type RouteId,
  type VehiclePosition,
} from "@bus-tracker/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDb } from "@/db/database";
import {
  getRoutePolyline,
  getRoutes,
  getScheduledStopTimeForTrip,
  getStops,
  type PolylinePoint,
  type ScheduledDeparture,
  type StopRow,
} from "@/db/queries";
import { useBusPosition } from "@/hooks/useBusPosition";
import { useScheduledDepartures } from "@/hooks/useScheduledDepartures";
import { fetchTrafficEta, type TrafficProvider } from "@/services/trafficEta";
import {
  resolveEta,
  useArrivalStatus,
  type ApproachingBus,
  type ArrivalStatus,
  type EtaMode,
  type ResolvedEta,
} from "@/components/tracker/logic";
import { devNow } from "@/utils/devClock";

export type { ApproachingBus } from "@/components/tracker/logic";

const TRAFFIC_REFRESH_MS = 30_000;
// Max age of the *GTFS Realtime* feed before we fall back to scheduled ETA.
// With a 30s poll cadence, 75s tolerates one fully-missed poll (~60s) plus
// ~15s of network jitter — previously 60s, which flipped to SCHEDULED on any
// single slow tick.
const STALE_AFTER_MS = 75_000;
/** Rough bus speed used to project a "next vehicle" ETA when we don't hit /traffic-eta for the second bus. */
const FALLBACK_BUS_METERS_PER_MINUTE = 20_000 / 60;

function toFiniteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Max |live-projected-arrival - trip-scheduled-departure| we trust before declaring the trip-id match unreliable. */
export const TRIP_MATCH_MAX_MIN = 15;

export type ArrivalKind = "live" | "sched";

export interface ArrivalEntry {
  kind: ArrivalKind;
  /** Absolute epoch ms when the bus is expected at the user's stop. */
  epochMs: number;
  /** Live vehicle info — present when `kind === "live"`. */
  live: ApproachingBus | null;
  /** Scheduled row — present when `kind === "sched"`, or when a confident trip-id match annotates a live entry. */
  sched: ScheduledDeparture | null;
  /** Trip id backing this entry (live's reported trip_id or sched.tripId). Used for dedupe. */
  tripId: string | null;
}

export interface UseEtaResult {
  minutesToStop: number | null;
  isStale: boolean;
  source: EtaSource | null;
  /** Traffic provider that produced the most recent traffic minutes, or null if ETA is schedule-based. */
  trafficSource: TrafficProvider | null;
  vehicleId: string | null;
  lastComputedAt: number | null;
  /** Combined error (static load, traffic fetch, or realtime feed). */
  error: Error | null;
  /** Just the traffic-API error, separated so callers can distinguish a degraded ETA from a fatal load. */
  trafficError: Error | null;
  /** The closest approaching bus with its traffic-adjusted ETA (same as top-level fields). */
  current: ApproachingBus | null;
  /** The second-closest approaching bus, with a rough distance-based ETA (no traffic call). */
  next: ApproachingBus | null;
  /** Timetable-fed view, blended with live data. */
  resolved: ResolvedEta;
  /** Which data source drives the hero countdown. */
  etaMode: EtaMode;
  /** Upcoming scheduled departures (next ~8) for the (stop, route) pair. */
  scheduledUpcoming: ScheduledDeparture[];
  /** Scheduled departure matched to the live `current` bus, if any. */
  currentScheduled: ScheduledDeparture | null;
  /** Exact epoch ms of the live trip's scheduled departure (derived from the matched stop_times row). Null when no trip match or match is beyond TRIP_MATCH_MAX_MIN. */
  currentScheduledEpochMs: number | null;
  /** Next scheduled departure that is NOT the one already represented by `currentScheduled`. Drives the "Next" row's schedule caption. */
  nextScheduledExcludingCurrent: ScheduledDeparture | null;
  /** Soonest expected bus arrival at the user's stop (live if available, otherwise first scheduled). */
  primaryArrival: ArrivalEntry | null;
  /** The arrival *after* `primaryArrival` — guaranteed to be a different trip and later in time. */
  secondaryArrival: ArrivalEntry | null;
  /** Service-day bounds for tracker edge states. */
  firstBusToday: number | null;
  lastBusToday: number | null;
  serviceEnded: boolean;
  beforeServiceStart: boolean;
  /** Total length (meters) of the active route's polyline. Null until the static cache loads. */
  polylineMeters: number | null;
  /** Hybrid distance+time+speed classifier for the primary arrival. Latches `'arrived'` for ~45s. */
  arrivalStatus: ArrivalStatus;
}

interface StaticCtx {
  stop: LatLng;
  polyline: LatLng[];
  intermediateCandidates: LatLng[];
}

export function useEta({
  stopId,
  routeCode,
  trafficProvider,
}: {
  stopId: string;
  routeCode: RouteId;
  trafficProvider?: TrafficProvider;
}): UseEtaResult {
  const { positions, lastUpdated: lastLiveFetchAt, error: rtError } =
    useBusPosition({ routeCode });

  const [staticCtx, setStaticCtx] = useState<StaticCtx | null>(null);
  const [staticError, setStaticError] = useState<Error | null>(null);
  const [trafficMinutes, setTrafficMinutes] = useState<number | null>(null);
  const [trafficSource, setTrafficSource] = useState<TrafficProvider | null>(
    null,
  );
  const [trafficError, setTrafficError] = useState<Error | null>(null);
  const [lastComputedAt, setLastComputedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => devNow());

  const previousByVehicleRef = useRef(
    new Map<string, { lat: number; lng: number }>(),
  );
  const lastTrafficFetchRef = useRef<{ at: number; key: string } | null>(null);
  const trafficInflightRef = useRef<AbortController | null>(null);
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active",
  );

  // Pause the traffic-ETA poll when the app isn't foregrounded — the biggest
  // single source of wasted HERE transactions is an app left open on a desk.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      setAppActive(status === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  // 1. Load static data once per (stopId, routeCode).
  useEffect(() => {
    let cancelled = false;
    setStaticError(null);
    setStaticCtx(null);
    (async () => {
      try {
        const db = await openDb();
        const [routes, stops] = await Promise.all([getRoutes(db), getStops(db)]);
        const route =
          routes.find((r) => r.code === routeCode) ?? routes[0] ?? null;
        if (!route) throw new Error(`no route ${routeCode} in cache`);

        const stop = stops.find((s: StopRow) => s.stop_id === stopId);
        if (!stop) throw new Error(`stop ${stopId} not found in cache`);

        const polyPoints = await getRoutePolyline(db, route.route_id);
        if (polyPoints.length < 2) {
          throw new Error(`polyline for route ${route.route_id} is empty`);
        }

        if (cancelled) return;
        const polyline: LatLng[] = polyPoints.map((p: PolylinePoint) => ({
          lat: p.lat,
          lng: p.lng,
        }));
        const intermediateCandidates: LatLng[] = stops
          .filter((s) => s.stop_id !== stopId)
          .map((s) => ({ lat: s.stop_lat, lng: s.stop_lon }));

        setStaticCtx({
          stop: { lat: stop.stop_lat, lng: stop.stop_lon },
          polyline,
          intermediateCandidates,
        });
      } catch (err) {
        if (cancelled) return;
        setStaticError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stopId, routeCode]);

  // 2. Drive `now` forward every 15s so `isStale` stays current.
  useEffect(() => {
    const t = setInterval(() => setNow(devNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  // 3. Maintain `previousByVehicleId` map whenever live positions change.
  useEffect(() => {
    const map = previousByVehicleRef.current;
    for (const p of positions) {
      map.set(p.vehicleId, { lat: p.lat, lng: p.lng });
    }
  }, [positions]);

  // 4. Compose the ETA result without triggering a network call — that's step 5.
  const composition: ComputeEtaResult | null = useMemo(() => {
    if (!staticCtx) return null;
    return computeEta({
      vehicles: positions as VehiclePosition[],
      previousByVehicleId: previousByVehicleRef.current,
      stop: staticCtx.stop,
      polyline: staticCtx.polyline,
      intermediateCandidates: staticCtx.intermediateCandidates,
      trafficMinutes,
      loop: true,
    });
  }, [staticCtx, positions, trafficMinutes]);

  // 4b. Pick the second-closest approaching vehicle for the "Next" row.
  const nextBus: ApproachingBus | null = useMemo(() => {
    if (!staticCtx || !composition?.vehicleId) return null;
    const picked = pickApproachingVehicle({
      vehicles: (positions as VehiclePosition[]).filter(
        (v) => v.vehicleId !== composition.vehicleId,
      ),
      previousByVehicleId: previousByVehicleRef.current,
      stop: staticCtx.stop,
      polyline: staticCtx.polyline,
      loop: true,
    });
    if (!picked) return null;
    const minutes = Math.round(
      picked.evaluation.forwardMeters / FALLBACK_BUS_METERS_PER_MINUTE,
    );
    return {
      minutesToStop: Math.max(0, minutes),
      vehicleId: picked.vehicle.vehicleId,
      forwardMeters: picked.evaluation.forwardMeters,
      source: null,
      speedKmh: toFiniteOrNull(picked.vehicle.speed),
    };
  }, [staticCtx, positions, composition?.vehicleId]);

  // 5. Fetch traffic ETA when the picked vehicle changes or ≥ 30s has passed.
  //    Key is intentionally coarse (vehicleId + provider only) — the server
  //    already caches per-coordinate for 60s, and the 30s floor below is what
  //    really throttles us. Including lat/lng here just forced an early
  //    refetch every time the bus moved, defeating the purpose of the floor.
  useEffect(() => {
    if (!appActive) return;
    if (!composition || !composition.busProjection || !staticCtx) return;
    const busLat = composition.busProjection.projected.lat;
    const busLng = composition.busProjection.projected.lng;
    const key = [composition.vehicleId ?? "", trafficProvider ?? ""].join("|");

    const last = lastTrafficFetchRef.current;
    const fresh = last && last.key === key && now - last.at < TRAFFIC_REFRESH_MS;
    if (fresh) return;

    trafficInflightRef.current?.abort();
    const ctrl = new AbortController();
    trafficInflightRef.current = ctrl;
    lastTrafficFetchRef.current = { at: devNow(), key };

    (async () => {
      try {
        const res = await fetchTrafficEta(
          { lat: busLat, lng: busLng },
          staticCtx.stop,
          { signal: ctrl.signal, provider: trafficProvider },
        );
        if (ctrl.signal.aborted) return;
        setTrafficMinutes(res.trafficMinutes);
        setTrafficSource(res.source);
        setTrafficError(null);
        setLastComputedAt(devNow());
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setTrafficError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [composition?.vehicleId, composition, staticCtx, now, trafficProvider, appActive]);

  // 6. When no approaching vehicle, clear stale traffic so we don't keep showing old minutes.
  useEffect(() => {
    if (composition && composition.vehicleId == null) {
      setTrafficMinutes(null);
      setTrafficSource(null);
      lastTrafficFetchRef.current = null;
    }
  }, [composition?.vehicleId, composition]);

  // 6b. Clear cached traffic minutes when the provider changes so the next render
  //     falls back to schedule-based ETA until the new provider replies.
  useEffect(() => {
    setTrafficMinutes(null);
    setTrafficSource(null);
    lastTrafficFetchRef.current = null;
  }, [trafficProvider]);

  const error = staticError ?? trafficError ?? rtError;
  // Live-vs-SCHEDULED is gated on the *realtime feed's* freshness, not on
  // `lastComputedAt` (which only bumps on a successful traffic-eta response).
  // Conflating the two meant a slow/failed traffic-eta would flip the Tracker
  // to SCHEDULED even though GTFS Realtime positions were arriving on schedule.
  const isStale =
    lastLiveFetchAt == null ? true : now - lastLiveFetchAt > STALE_AFTER_MS;

  const roundedMinutes =
    composition?.minutesToStop != null
      ? Math.round(composition.minutesToStop)
      : null;

  const currentSpeedKmh: number | null = useMemo(() => {
    if (composition?.vehicleId == null) return null;
    const hit = positions.find((p) => p.vehicleId === composition.vehicleId);
    return toFiniteOrNull(hit?.speed);
  }, [composition?.vehicleId, positions]);

  const current: ApproachingBus | null =
    composition?.vehicleId != null && composition.forwardMeters != null
      ? {
          minutesToStop: roundedMinutes,
          vehicleId: composition.vehicleId,
          forwardMeters: composition.forwardMeters,
          source: composition.source,
          speedKmh: currentSpeedKmh,
        }
      : null;

  // Schedule overlay: upcoming departures for (stop, route) plus per-trip
  // match for the currently-picked vehicle.
  const scheduled = useScheduledDepartures({ stopId, routeCode, limit: 8 });

  // Trip id of the picked vehicle, for matching against stop_times.
  const currentTripId = useMemo(() => {
    if (!current) return null;
    const hit = positions.find((p) => p.vehicleId === current.vehicleId);
    return hit?.tripId ?? null;
  }, [current, positions]);

  const [currentScheduledSeconds, setCurrentScheduledSeconds] = useState<
    number | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    if (!currentTripId) {
      setCurrentScheduledSeconds(null);
      return;
    }
    (async () => {
      try {
        const db = await openDb();
        const secs = await getScheduledStopTimeForTrip(db, currentTripId, stopId);
        if (!cancelled) setCurrentScheduledSeconds(secs);
      } catch {
        if (!cancelled) setCurrentScheduledSeconds(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTripId, stopId]);

  // Pick the scheduled departure whose wall-clock is nearest the live bus's
  // scheduled departure (used as the "anchor" chip in TimetableStrip, and as
  // a fallback delay input when getScheduledStopTimeForTrip fails).
  const currentScheduled: ScheduledDeparture | null = useMemo(() => {
    if (scheduled.upcoming.length === 0) return null;
    if (currentScheduledSeconds == null) return null;
    // departureSeconds is "seconds since today-midnight"; find the nearest.
    let best: ScheduledDeparture | null = null;
    let bestDiff = Infinity;
    for (const d of scheduled.upcoming) {
      const diff = Math.abs(d.departureSeconds - currentScheduledSeconds);
      if (diff < bestDiff) {
        best = d;
        bestDiff = diff;
      }
    }
    return best;
  }, [scheduled.upcoming, currentScheduledSeconds]);

  const nextScheduledForHero: ScheduledDeparture | null =
    scheduled.upcoming[0] ?? null;

  const polylineMeters = useMemo(
    () => (staticCtx ? polylineLength(staticCtx.polyline) : null),
    [staticCtx],
  );

  // Exact scheduled departure for the live trip, reconstructed from seconds
  // against today's Malaysia-local midnight. Used for the Current-row caption
  // so the time shown is the bus's own schedule, not the nearest upcoming
  // chip (which may belong to a different trip).
  //
  // Guard: if the live projected arrival diverges from the matched schedule
  // by more than TRIP_MATCH_MAX_MIN minutes, the upstream trip_id→stop_times
  // match is almost certainly wrong (the GTFS-RT doc warns matching can be
  // flaky). Suppress the time rather than show a phantom "scheduled 13:44".
  const currentScheduledEpochMs: number | null = useMemo(() => {
    if (currentScheduledSeconds == null) return null;
    const parts = toMalaysiaParts(new Date(now));
    const schedMs = parts.midnightUtcMs + currentScheduledSeconds * 1000;
    const liveRoundedMin = composition?.minutesToStop;
    if (liveRoundedMin != null) {
      const liveEtaMs = now + Math.round(liveRoundedMin) * 60_000;
      const diffMin = Math.abs(liveEtaMs - schedMs) / 60_000;
      if (diffMin > TRIP_MATCH_MAX_MIN) return null;
    }
    return schedMs;
  }, [currentScheduledSeconds, now, composition?.minutesToStop]);

  // Pick the next scheduled departure that isn't the same trip we're already
  // showing as "current" — avoids duplicating 13:14 in both rows.
  const nextScheduledExcludingCurrent: ScheduledDeparture | null = useMemo(() => {
    if (scheduled.upcoming.length === 0) return null;
    const currentId = currentScheduled?.tripId;
    if (!currentId) return scheduled.upcoming[0] ?? null;
    return (
      scheduled.upcoming.find((d) => d.tripId !== currentId) ?? null
    );
  }, [scheduled.upcoming, currentScheduled]);

  // Unified arrival timeline: merges live ETAs + scheduled departures,
  // dedupes live/sched pairs that clearly represent the same trip, sorts
  // ascending. primaryArrival = [0], secondaryArrival = [1].
  //
  // Dedupe rule: a live entry "consumes" the scheduled entry whose tripId
  // matches, OR the scheduled entry whose epochMs is within ±TRIP_MATCH_MAX_MIN
  // of the live projected arrival (handles the case where the trip_id was
  // wrong but schedule/live are obviously the same run).
  const arrivalTimeline: ArrivalEntry[] = useMemo(() => {
    const liveEtaMs =
      current?.minutesToStop != null
        ? now + current.minutesToStop * 60_000
        : null;
    const nextLiveEtaMs =
      nextBus?.minutesToStop != null
        ? now + nextBus.minutesToStop * 60_000
        : null;

    // Decide which scheduled row (if any) the live `current` consumes.
    let consumedTripId: string | null = null;
    if (liveEtaMs != null) {
      // Prefer trip-id match when the time delta is plausible.
      if (currentTripId && currentScheduledEpochMs != null) {
        consumedTripId = currentTripId;
      } else {
        // Fallback: nearest scheduled within ±TRIP_MATCH_MAX_MIN.
        let bestDiff = TRIP_MATCH_MAX_MIN * 60_000 + 1;
        for (const dep of scheduled.upcoming) {
          const diff = Math.abs(dep.departureEpochMs - liveEtaMs);
          if (diff < bestDiff) {
            bestDiff = diff;
            consumedTripId = dep.tripId;
          }
        }
      }
    }
    // The second live bus, likewise, consumes the nearest schedule to *its* ETA.
    let consumedBySecondaryTripId: string | null = null;
    if (nextLiveEtaMs != null) {
      let bestDiff = TRIP_MATCH_MAX_MIN * 60_000 + 1;
      for (const dep of scheduled.upcoming) {
        if (dep.tripId === consumedTripId) continue;
        const diff = Math.abs(dep.departureEpochMs - nextLiveEtaMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          consumedBySecondaryTripId = dep.tripId;
        }
      }
    }

    const out: ArrivalEntry[] = [];
    if (liveEtaMs != null && current) {
      const matchedSched = consumedTripId
        ? scheduled.upcoming.find((d) => d.tripId === consumedTripId) ?? null
        : null;
      out.push({
        kind: "live",
        epochMs: liveEtaMs,
        live: current,
        sched: matchedSched,
        tripId: consumedTripId ?? currentTripId,
      });
    }
    if (nextLiveEtaMs != null && nextBus) {
      const matchedSched = consumedBySecondaryTripId
        ? scheduled.upcoming.find(
            (d) => d.tripId === consumedBySecondaryTripId,
          ) ?? null
        : null;
      out.push({
        kind: "live",
        epochMs: nextLiveEtaMs,
        live: nextBus,
        sched: matchedSched,
        tripId: consumedBySecondaryTripId,
      });
    }
    for (const dep of scheduled.upcoming) {
      if (dep.tripId === consumedTripId) continue;
      if (dep.tripId === consumedBySecondaryTripId) continue;
      out.push({
        kind: "sched",
        epochMs: dep.departureEpochMs,
        live: null,
        sched: dep,
        tripId: dep.tripId,
      });
    }

    out.sort((a, b) => a.epochMs - b.epochMs);
    return out;
  }, [
    current,
    nextBus,
    currentTripId,
    currentScheduledEpochMs,
    scheduled.upcoming,
    now,
  ]);

  const primaryArrival: ArrivalEntry | null = arrivalTimeline[0] ?? null;
  const secondaryArrival: ArrivalEntry | null = (() => {
    if (arrivalTimeline.length < 2) return null;
    const primary = arrivalTimeline[0];
    // Ensure the secondary is genuinely a different trip AND strictly later.
    for (let i = 1; i < arrivalTimeline.length; i++) {
      const e = arrivalTimeline[i];
      if (
        e.epochMs <= primary.epochMs ||
        (e.tripId && e.tripId === primary.tripId)
      ) {
        continue;
      }
      return e;
    }
    return arrivalTimeline[1] ?? null;
  })();

  const resolved: ResolvedEta = useMemo(() => {
    const liveProjectedArrivalEpochMs =
      roundedMinutes != null ? now + roundedMinutes * 60_000 : null;
    const todayMidnight = toMalaysiaParts(new Date(now)).midnightUtcMs;

    // Keep the hero in sync with primaryArrival. `resolveEta` unconditionally
    // prefers live when present, but arrivalTimeline can surface a scheduled
    // departure ahead of the live bus — e.g. the live vehicle is running very
    // late or mid-loop (so it's 57 min away via the long way around) while a
    // fresh scheduled trip starts in 2 min. In that state, the Current card
    // already shows the scheduled row; hand `resolveEta` the same row so the
    // hero counts down to the same arrival instead of the far-away live bus.
    const liveForResolve =
      primaryArrival?.kind === "live" &&
      primaryArrival.live?.vehicleId === current?.vehicleId
        ? current
        : null;
    const nextScheduledForResolve =
      !liveForResolve && primaryArrival?.kind === "sched" && primaryArrival.sched
        ? primaryArrival.sched
        : nextScheduledForHero;

    return resolveEta({
      live: liveForResolve,
      liveTripScheduledSeconds: liveForResolve ? currentScheduledSeconds : null,
      liveTripServiceDayMidnightUtcMs: todayMidnight,
      liveProjectedArrivalEpochMs: liveForResolve
        ? liveProjectedArrivalEpochMs
        : null,
      nextScheduled: nextScheduledForResolve,
      isLiveStale: isStale,
      now,
    });
  }, [
    current,
    currentScheduledSeconds,
    nextScheduledForHero,
    isStale,
    roundedMinutes,
    now,
    primaryArrival,
  ]);

  // Arrival status — derived from the primary arrival's live telemetry. Uses
  // the live entry even when `resolveEta` preferred schedule (so the classifier
  // still has forwardMeters/speed to work with), but gates on `resolved.mode`
  // inside the helper so schedule-only arrivals never report arriving/arrived.
  const primaryLive = primaryArrival?.live ?? null;
  const { status: arrivalStatus } = useArrivalStatus({
    vehicleId: primaryLive?.vehicleId ?? null,
    minutesToStop: resolved.minutesToStop,
    forwardMeters: primaryLive?.forwardMeters ?? null,
    speedKmh: primaryLive?.speedKmh ?? null,
    isStale,
    mode: resolved.mode,
  });

  return {
    minutesToStop: resolved.minutesToStop,
    isStale,
    source: composition?.source ?? null,
    trafficSource: composition?.source === "traffic" ? trafficSource : null,
    vehicleId: composition?.vehicleId ?? null,
    lastComputedAt,
    error,
    trafficError,
    current,
    next: nextBus,
    resolved,
    etaMode: resolved.mode,
    scheduledUpcoming: scheduled.upcoming,
    currentScheduled,
    currentScheduledEpochMs,
    nextScheduledExcludingCurrent,
    primaryArrival,
    secondaryArrival,
    firstBusToday: scheduled.firstEpochMs,
    lastBusToday: scheduled.lastEpochMs,
    serviceEnded: scheduled.serviceEnded,
    beforeServiceStart: scheduled.beforeServiceStart,
    polylineMeters,
    arrivalStatus,
  };
}
