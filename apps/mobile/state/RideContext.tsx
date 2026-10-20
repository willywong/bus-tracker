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
import {
  advanceRide,
  isLoopRoute,
  rideDestinations,
  rideMinutes,
  rideSequence,
  type RideProgress,
  type RideStop,
} from '@/components/ride/model';
import {
  cancelGetOffAlert,
  ensureNotificationPermission,
  scheduleGetOffAlert,
  speakGetOff,
} from '@/services/reminders/notifications';
import { useTrip } from '@/state/TripContext';
import { haptics } from '@/utils/haptics';

interface ActiveRide {
  routeCode: string;
  boardStopId: string;
  destStopId: string;
  /** The live bus you boarded, when we knew it. Its fixes stand in for your GPS. */
  vehicleId: string | null;
}

export interface RideContextValue {
  /** Stops you can ride to from your boarding stop, in order. */
  destinations: RideStop[];
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
  end: () => void;
}

const RideContext = createContext<RideContextValue | null>(null);

/** Arrived rides close themselves after this. */
const AUTO_END_MS = 2 * 60_000;
/** Reschedule the background alert only when the estimate moves this much. */
const RESCHEDULE_DRIFT_MS = 60_000;

/**
 * On-board mode: pick where you get off and BusBuddy counts the stops down,
 * buzzes (and optionally speaks) when yours is next, and schedules a
 * notification for the estimated time in case the screen is off. Uses your
 * phone's location while the app is open (When In Use only), falling back to
 * the bus's own position from the feed.
 */
export function RideProvider({ children }: { children: ReactNode }) {
  const trip = useTrip();
  const [ride, setRide] = useState<ActiveRide | null>(null);
  const [speak, setSpeak] = useState(false);
  const [phone, setPhone] = useState<{ lat: number; lng: number } | null>(null);
  const [progress, setProgress] = useState<RideProgress | null>(null);

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
    () => (ride ? rideSequence(ordered, ride.boardStopId, ride.destStopId, isLoop) : []),
    [ride, ordered, isLoop],
  );

  // Switching route or stop ends the ride; it no longer describes your trip.
  useEffect(() => {
    if (ride && (ride.routeCode !== trip.routeCode || ride.boardStopId !== trip.stopId)) {
      setRide(null);
    }
  }, [ride, trip.routeCode, trip.stopId]);

  // Phone GPS while riding, if location is already allowed. Never prompts here.
  useEffect(() => {
    if (!ride) {
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
  }, [ride]);

  const busFix = ride?.vehicleId
    ? trip.bus.positions.find((p) => p.vehicleId === ride.vehicleId) ?? null
    : null;
  const position = phone ?? (busFix ? { lat: busFix.lat, lng: busFix.lng } : null);
  const positionSource = phone ? 'phone' : busFix ? 'bus' : null;

  useEffect(() => {
    if (!ride || seq.length < 2) {
      setProgress(null);
      return;
    }
    setProgress((prev) => advanceRide(seq, position, prev?.passedIndex ?? 0));
    // position is a fresh object each render; key on its coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride, seq, position?.lat, position?.lng]);

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
    if (!ride || !progress || progress.phase !== 'riding') return;
    const dest = seq[seq.length - 1];
    if (!dest) return;
    // A minute or so before the estimated arrival, about one stop early.
    const atMs = Date.now() + Math.max(0, rideMinutes(progress.remainingMeters) - 1) * 60_000;
    if (scheduledAt.current != null && Math.abs(scheduledAt.current - atMs) < RESCHEDULE_DRIFT_MS) return;
    scheduledAt.current = atMs;
    void scheduleGetOffAlert({ stopName: dest.name, atMs }).catch(() => {});
  }, [ride, progress, seq]);

  useEffect(() => {
    if (progress?.phase !== 'arrived') return;
    const t = setTimeout(() => setRide(null), AUTO_END_MS);
    return () => clearTimeout(t);
  }, [progress?.phase]);

  // Ending (or auto-ending) clears the pending alert.
  useEffect(() => {
    if (ride) return;
    scheduledAt.current = null;
    prevPhase.current = null;
    void cancelGetOffAlert().catch(() => {});
  }, [ride]);

  const start = useCallback(
    (destStopId: string) => {
      if (!trip.routeCode || !trip.stopId) return;
      setProgress(null);
      setRide({
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

  const destination = ride ? seq[seq.length - 1] ?? null : null;

  const value = useMemo<RideContextValue>(
    () => ({
      destinations,
      active: ride != null && seq.length >= 2,
      destination,
      progress,
      minutesLeft: progress ? rideMinutes(progress.remainingMeters) : null,
      positionSource,
      speak,
      setSpeak,
      start,
      end,
    }),
    [destinations, ride, seq.length, destination, progress, positionSource, speak, start, end],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used inside <RideProvider>');
  return ctx;
}
