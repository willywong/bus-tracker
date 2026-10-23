import type { JourneyStopNode } from '@/hooks/useJourneyStops';

/** A stop on the bus's trip and when it's due there, in seconds into the service day. */
export interface TimedStop extends JourneyStopNode {
  seconds: number | null;
}

export interface StopAhead {
  stop: JourneyStopNode;
  /** From the stop the bus is at now, by the timetable; null without times. */
  minutes: number | null;
  yours: boolean;
}

/** Where a live bus goes next along its trip. */
export interface NextStops {
  /** The stop the bus is nearest now. */
  near: JourneyStopNode;
  /** The next few stops after it, in order. */
  ahead: StopAhead[];
  /** Your stop, when it's further along this trip than `ahead` reaches. */
  yours: StopAhead | null;
  /** Stops between the last of `ahead` and `yours`. */
  skipped: number;
}

/** How many stops ahead to list. */
export const NEXT_STOPS = 4;

/**
 * The bus is placed at the trip's stop nearest its position (the feed sends
 * no current stop) and each stop ahead is timed by the timetable's gap from
 * there, so a late bus is still timed right. Null at the end of the trip.
 */
export function nextStopsOf(
  stops: readonly TimedStop[],
  bus: { lat: number; lng: number },
  yourStopId: string | null,
  count: number = NEXT_STOPS,
): NextStops | null {
  const at = nearestIndex(stops, bus);
  if (at < 0 || at >= stops.length - 1) return null;
  const from = stops[at].seconds;
  const ahead = (i: number): StopAhead => ({
    stop: node(stops[i]),
    minutes: minutesBetween(from, stops[i].seconds),
    yours: stops[i].stopId === yourStopId,
  });

  const end = Math.min(stops.length, at + 1 + count);
  const shown: StopAhead[] = [];
  for (let i = at + 1; i < end; i++) shown.push(ahead(i));

  let yours: StopAhead | null = null;
  let skipped = 0;
  if (yourStopId != null && !shown.some((s) => s.yours)) {
    // A loop passes a stop twice: the first time from here.
    const i = stops.findIndex((s, k) => k >= end && s.stopId === yourStopId);
    if (i >= 0) {
      yours = ahead(i);
      skipped = i - end;
    }
  }
  return { near: node(stops[at]), ahead: shown, yours, skipped };
}

/** "3 min", "1 h 5 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** At least a minute: a stop ahead is never "0 min" away. */
function minutesBetween(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null;
  return Math.max(1, Math.round((to - from) / 60));
}

/** The first of the nearest, so a loop's start wins over its end. */
function nearestIndex(stops: readonly TimedStop[], bus: { lat: number; lng: number }): number {
  const k = Math.cos((bus.lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  stops.forEach((s, i) => {
    const d = (s.lat - bus.lat) ** 2 + ((s.lng - bus.lng) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function node({ stopId, name, sequence, lat, lng }: TimedStop): JourneyStopNode {
  return { stopId, name, sequence, lat, lng };
}
