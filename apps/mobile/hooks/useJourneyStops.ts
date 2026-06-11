import { useEffect, useMemo, useState } from 'react';

import { openDb } from '@/db/database';
import {
  getStopsForRouteOrdered,
  resolveTripStops,
  type TripStopsSource,
} from '@/db/queries';

/**
 * Resolves the ordered list of stops along the bus's trip (with names) and
 * computes the "remaining approach" window — the stops between where the bus
 * currently is and the user's stop. Drives the Tracker's journey-line timeline.
 *
 * Live path: `resolveTripStops` walks the same drift-resolution ladder as the
 * ETA layer (exact → suffix → representative) so a stale static bundle still
 * yields named stops. Schedule fallback uses the route's representative stop
 * order. T816 is a loop, so a stop can appear twice in one trip — the user's
 * stop is matched to the first occurrence at or ahead of the bus.
 *
 * The bus is placed on the list by GTFS-RT `current_stop_id` / sequence when
 * present, and otherwise by the nearest stop to its GPS position — the
 * Prasarana feed frequently omits the current-stop fields.
 */

export interface JourneyStopNode {
  stopId: string;
  name: string;
  sequence: number;
  lat: number;
  lng: number;
}

export interface JourneyData {
  ready: boolean;
  source: TripStopsSource | 'route' | null;
  /** Stop the bus is at / heading toward. Null when its position is unknown. */
  busStop: JourneyStopNode | null;
  /** Stops strictly between the bus and the user's stop, in order. */
  upcoming: JourneyStopNode[];
  /** The user's stop (terminal node). Null until resolved. */
  userStop: JourneyStopNode | null;
  /** Number of stops from the bus to the user's stop. Null when unknown. */
  stopsAhead: number | null;
}

interface LoadedStops {
  stops: JourneyStopNode[];
  source: TripStopsSource | 'route';
}

const EMPTY: JourneyData = {
  ready: false,
  source: null,
  busStop: null,
  upcoming: [],
  userStop: null,
  stopsAhead: null,
};

export interface UseJourneyStopsInput {
  routeCode: string;
  stopId: string;
  /** Live trip id of the tracked bus (may be null when schedule-only). */
  tripId: string | null;
  /** GTFS-RT current_stop_sequence of the tracked bus. */
  currentStopSequence: number | null;
  /** GTFS-RT current stop id of the tracked bus. */
  currentStopId: string | null;
  /** Bus GPS position — used to locate it on the line when current-stop fields are absent. */
  busLat: number | null;
  busLng: number | null;
}

export function useJourneyStops({
  routeCode,
  stopId,
  tripId,
  currentStopSequence,
  currentStopId,
  busLat,
  busLng,
}: UseJourneyStopsInput): JourneyData {
  const [loaded, setLoaded] = useState<LoadedStops | null>(null);

  // Load + cache the full ordered stop list per (tripId | route, stop). The
  // window itself is derived cheaply below as the bus advances, so we only hit
  // the DB when the trip or route changes.
  useEffect(() => {
    if (!routeCode || !stopId) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await openDb();
        if (tripId) {
          const res = await resolveTripStops(db, tripId, routeCode);
          if (cancelled) return;
          if (res.stops.length > 0) {
            setLoaded({
              source: res.source,
              stops: res.stops.map((s) => ({
                stopId: s.stopId,
                name: s.stopName,
                sequence: s.stopSequence,
                lat: s.stopLat,
                lng: s.stopLon,
              })),
            });
            return;
          }
        }
        const ordered = await getStopsForRouteOrdered(db, routeCode);
        if (cancelled) return;
        setLoaded({
          source: 'route',
          stops: ordered.map((s, i) => ({
            stopId: s.stop_id,
            name: s.stop_name,
            sequence: i,
            lat: s.stop_lat,
            lng: s.stop_lon,
          })),
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[journey] failed to load trip stops', err);
        setLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, routeCode, stopId]);

  return useMemo<JourneyData>(() => {
    if (!loaded || loaded.stops.length === 0) return EMPTY;
    const stops = loaded.stops;

    // Locate the bus along the list — by current-stop fields first, else GPS.
    let busIndex = -1;
    if (currentStopId != null) {
      busIndex = stops.findIndex(
        (s) =>
          s.stopId === currentStopId &&
          (currentStopSequence == null || s.sequence === currentStopSequence),
      );
      if (busIndex < 0) {
        busIndex = stops.findIndex((s) => s.stopId === currentStopId);
      }
    }
    if (busIndex < 0 && currentStopSequence != null) {
      busIndex = stops.findIndex((s) => s.sequence === currentStopSequence);
    }
    if (busIndex < 0 && busLat != null && busLng != null) {
      busIndex = nearestStopIndex(stops, busLat, busLng);
    }
    const busSeq = busIndex >= 0 ? stops[busIndex].sequence : null;

    // Locate the user's stop — for a loop, the first occurrence at/ahead of the
    // bus; otherwise the last occurrence (bus has passed it this trip).
    const userMatches = stops
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.stopId === stopId);
    if (userMatches.length === 0) {
      return { ...EMPTY, ready: true, source: loaded.source };
    }
    let userIndex: number;
    if (busSeq != null) {
      const ahead = userMatches.find(({ s }) => s.sequence >= busSeq);
      userIndex = (ahead ?? userMatches[userMatches.length - 1]).i;
    } else {
      userIndex = userMatches[userMatches.length - 1].i;
    }

    const userStop = stops[userIndex];

    // No usable bus position, or bus already past the user's stop → show the
    // user's stop plus a little leading context.
    if (busIndex < 0 || busIndex >= userIndex) {
      const ctxStart = Math.max(0, userIndex - 4);
      return {
        ready: true,
        source: loaded.source,
        busStop: null,
        upcoming: stops.slice(ctxStart, userIndex),
        userStop,
        stopsAhead: busIndex >= 0 ? Math.max(0, userIndex - busIndex) : null,
      };
    }

    return {
      ready: true,
      source: loaded.source,
      busStop: stops[busIndex],
      upcoming: stops.slice(busIndex + 1, userIndex),
      userStop,
      stopsAhead: userIndex - busIndex,
    };
  }, [loaded, stopId, currentStopId, currentStopSequence, busLat, busLng]);
}

function nearestStopIndex(
  stops: JourneyStopNode[],
  lat: number,
  lng: number,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = haversineMeters(lat, lng, stops[i].lat, stops[i].lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
