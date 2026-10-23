import { useEffect, useMemo, useState } from 'react';

import { nextStopsOf, type NextStops, type TimedStop } from '@/components/detail/nextStops';
import { openDb } from '@/db/database';
import { resolveTripStops } from '@/db/queries';

/**
 * Where a live bus goes next: its trip's stops, loaded once per trip (with
 * the same drift ladder as the ETA layer), placed against its position as it
 * moves. Null until loaded, without a position, or at the trip's end.
 */
export function useNextStops({
  tripId,
  routeCode,
  lat,
  lng,
  yourStopId,
}: {
  tripId: string | null;
  routeCode: string;
  lat: number | null;
  lng: number | null;
  yourStopId: string | null;
}): NextStops | null {
  const [stops, setStops] = useState<TimedStop[] | null>(null);

  useEffect(() => {
    setStops(null);
    if (!tripId || !routeCode) return;
    let cancelled = false;
    openDb()
      .then((db) => resolveTripStops(db, tripId, routeCode))
      .then((res) => {
        if (cancelled) return;
        setStops(
          res.stops.map((s) => ({
            stopId: s.stopId,
            name: s.stopName,
            sequence: s.stopSequence,
            lat: s.stopLat,
            lng: s.stopLon,
            seconds: s.arrivalSeconds ?? s.departureSeconds,
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId, routeCode]);

  return useMemo(
    () =>
      stops && lat != null && lng != null ? nextStopsOf(stops, { lat, lng }, yourStopId) : null,
    [stops, lat, lng, yourStopId],
  );
}
