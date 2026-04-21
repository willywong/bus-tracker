import { toMalaysiaParts } from "@bus-tracker/shared";
import type { Db } from "./database";

export interface StopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface RouteRow {
  route_id: string;
  code: string;
  long_name: string | null;
}

export interface TripRow {
  trip_id: string;
  route_id: string;
  service_id: string;
  shape_id: string | null;
  direction_id: number | null;
}

export interface PolylinePoint {
  lat: number;
  lng: number;
  seq: number;
}

export interface ScheduledDeparture {
  tripId: string;
  serviceId: string;
  routeId: string;
  routeCode: string;
  stopId: string;
  stopSequence: number;
  /** Seconds since today's Malaysia-local midnight (may exceed 86400 for yesterday-spillover trips rolled into today). */
  departureSeconds: number;
  /** Absolute UTC epoch ms. */
  departureEpochMs: number;
  /** Service day Malaysia-local midnight for this row, as UTC epoch ms. */
  serviceDayMidnightUtcMs: number;
}

export interface ServiceDayBounds {
  firstEpochMs: number | null;
  lastEpochMs: number | null;
}

export async function getStops(db: Db): Promise<StopRow[]> {
  return db.getAllAsync<StopRow>(
    "SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops ORDER BY stop_name;",
  );
}

export async function getStopsForRoute(
  db: Db,
  routeCode: string,
): Promise<StopRow[]> {
  return db.getAllAsync<StopRow>(
    `SELECT DISTINCT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
       FROM stops s
       JOIN stop_times st ON st.stop_id = s.stop_id
       JOIN trips t       ON t.trip_id  = st.trip_id
       JOIN routes r      ON r.route_id = t.route_id
      WHERE r.code = ?
      ORDER BY s.stop_name;`,
    routeCode,
  );
}

export async function getRoutes(db: Db): Promise<RouteRow[]> {
  return db.getAllAsync<RouteRow>(
    "SELECT route_id, code, long_name FROM routes ORDER BY code;",
  );
}

export async function getTripsForRoute(
  db: Db,
  routeId: string,
): Promise<TripRow[]> {
  return db.getAllAsync<TripRow>(
    "SELECT trip_id, route_id, service_id, shape_id, direction_id FROM trips WHERE route_id = ?;",
    routeId,
  );
}

export async function getTripToRouteMap(
  db: Db,
  routeCodes: readonly string[],
): Promise<Map<string, string>> {
  if (routeCodes.length === 0) return new Map();
  const placeholders = routeCodes.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ trip_id: string; code: string }>(
    `SELECT t.trip_id AS trip_id, r.code AS code
       FROM trips t
       JOIN routes r ON r.route_id = t.route_id
      WHERE r.code IN (${placeholders});`,
    ...routeCodes,
  );
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.trip_id, row.code);
  return out;
}

export interface TrafficSignalRow {
  osm_id: number;
  lat: number;
  lng: number;
}

export async function getTrafficSignals(
  db: Db,
  routeCode: string,
): Promise<TrafficSignalRow[]> {
  return db.getAllAsync<TrafficSignalRow>(
    "SELECT osm_id, lat, lng FROM traffic_signals WHERE route_code = ?;",
    routeCode,
  );
}

export async function getRoutePolyline(
  db: Db,
  routeId: string,
): Promise<PolylinePoint[]> {
  const shape = await db.getFirstAsync<{ shape_id: string }>(
    `SELECT shape_id FROM trips
     WHERE route_id = ? AND shape_id IS NOT NULL
     GROUP BY shape_id
     ORDER BY COUNT(*) DESC
     LIMIT 1;`,
    routeId,
  );
  if (!shape) return [];
  return db.getAllAsync<PolylinePoint>(
    "SELECT lat, lng, seq FROM shape_points WHERE shape_id = ? ORDER BY seq;",
    shape.shape_id,
  );
}

// ---------------------------------------------------------------------------
// Schedule queries
//
// Known limitation: calendar_dates.txt (public-holiday exceptions) is not in
// the bundle today, so a weekday-service bus will still show as scheduled on a
// Malaysian public holiday. Out of scope for v1.
// ---------------------------------------------------------------------------

const DOW_COLUMN = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export async function getActiveServiceIdsForDate(
  db: Db,
  date: Date,
): Promise<string[]> {
  const { ymd, dow } = toMalaysiaParts(date);
  // DOW is always 0..6 and never user-influenced, so interpolation is safe.
  const dowCol = DOW_COLUMN[dow];
  const rows = await db.getAllAsync<{ service_id: string }>(
    `SELECT service_id FROM calendar
      WHERE ${dowCol} = 1
        AND start_date <= ?
        AND end_date >= ?;`,
    ymd,
    ymd,
  );
  return rows.map((r) => r.service_id);
}

interface StopTimeJoinRow {
  trip_id: string;
  service_id: string;
  route_id: string;
  route_code: string;
  stop_id: string;
  stop_sequence: number;
  departure_seconds: number;
}

async function queryDeparturesForServices(
  db: Db,
  routeCode: string,
  stopId: string,
  services: string[],
  minDepartureSeconds: number,
  limit: number,
): Promise<StopTimeJoinRow[]> {
  if (services.length === 0) return [];
  const ph = services.map(() => "?").join(",");
  return db.getAllAsync<StopTimeJoinRow>(
    `SELECT st.trip_id AS trip_id,
            t.service_id AS service_id,
            t.route_id AS route_id,
            r.code AS route_code,
            st.stop_id AS stop_id,
            st.stop_sequence AS stop_sequence,
            st.departure_seconds AS departure_seconds
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id
       JOIN routes r ON r.route_id = t.route_id
      WHERE r.code = ?
        AND st.stop_id = ?
        AND st.departure_seconds IS NOT NULL
        AND st.departure_seconds >= ?
        AND t.service_id IN (${ph})
      ORDER BY st.departure_seconds ASC
      LIMIT ?;`,
    routeCode,
    stopId,
    minDepartureSeconds,
    ...services,
    limit,
  );
}

/**
 * Returns the next N scheduled departures of `routeCode` at `stopId`,
 * incorporating today's active services AND yesterday's services where
 * the `HH:MM:SS` value exceeded 24:00:00 (GTFS spillover). Results are sorted
 * by absolute epoch ms ascending.
 */
export async function getNextScheduledDepartures(
  db: Db,
  routeCode: string,
  stopId: string,
  now: Date,
  limit: number,
): Promise<ScheduledDeparture[]> {
  const today = toMalaysiaParts(now);
  const yesterday = toMalaysiaParts(new Date(now.getTime() - 86_400_000));

  const [todayServices, yesterdayServices] = await Promise.all([
    getActiveServiceIdsForDate(db, now),
    getActiveServiceIdsForDate(db, new Date(now.getTime() - 86_400_000)),
  ]);

  const results: ScheduledDeparture[] = [];

  // Today's active services — departures at or after current time.
  const todayRows = await queryDeparturesForServices(
    db,
    routeCode,
    stopId,
    todayServices,
    today.secSinceMidnight,
    limit * 2,
  );
  for (const r of todayRows) {
    results.push({
      tripId: r.trip_id,
      serviceId: r.service_id,
      routeId: r.route_id,
      routeCode: r.route_code,
      stopId: r.stop_id,
      stopSequence: r.stop_sequence,
      departureSeconds: r.departure_seconds,
      departureEpochMs: today.midnightUtcMs + r.departure_seconds * 1000,
      serviceDayMidnightUtcMs: today.midnightUtcMs,
    });
  }

  // Yesterday's active services — only trips whose seconds >= 86400
  // (spilling into today). Feeders like T816 almost certainly don't, but the
  // branch is cheap and future-proofs night routes.
  if (yesterdayServices.length > 0) {
    const thresholdFromYesterday =
      Math.max(86400, today.secSinceMidnight + 86400);
    const spillRows = await queryDeparturesForServices(
      db,
      routeCode,
      stopId,
      yesterdayServices,
      thresholdFromYesterday,
      limit,
    );
    for (const r of spillRows) {
      const todaySec = r.departure_seconds - 86400;
      results.push({
        tripId: r.trip_id,
        serviceId: r.service_id,
        routeId: r.route_id,
        routeCode: r.route_code,
        stopId: r.stop_id,
        stopSequence: r.stop_sequence,
        departureSeconds: todaySec,
        departureEpochMs: yesterday.midnightUtcMs + r.departure_seconds * 1000,
        serviceDayMidnightUtcMs: yesterday.midnightUtcMs,
      });
    }
  }

  results.sort((a, b) => a.departureEpochMs - b.departureEpochMs);
  return results.slice(0, limit);
}

export interface TripStopTimeRow {
  stopId: string;
  stopSequence: number;
  arrivalSeconds: number | null;
  departureSeconds: number | null;
}

/**
 * Returns every stop_times row for `tripId`, ordered by stop_sequence ascending.
 * Drives schedule-based position interpolation.
 */
export async function getStopTimesForTrip(
  db: Db,
  tripId: string,
): Promise<TripStopTimeRow[]> {
  const rows = await db.getAllAsync<{
    stop_id: string;
    stop_sequence: number;
    arrival_seconds: number | null;
    departure_seconds: number | null;
  }>(
    `SELECT stop_id, stop_sequence, arrival_seconds, departure_seconds
       FROM stop_times
      WHERE trip_id = ?
      ORDER BY stop_sequence ASC;`,
    tripId,
  );
  return rows.map((r) => ({
    stopId: r.stop_id,
    stopSequence: r.stop_sequence,
    arrivalSeconds: r.arrival_seconds,
    departureSeconds: r.departure_seconds,
  }));
}

/**
 * Returns the scheduled departure seconds (since service-day midnight) for the
 * first visit of `stopId` on `tripId`, or null if missing. For loop routes
 * (e.g. T816) that visit the same stop twice per trip, this returns the first
 * (lower `stop_sequence`) visit.
 */
export async function getScheduledStopTimeForTrip(
  db: Db,
  tripId: string,
  stopId: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<{ departure_seconds: number | null }>(
    `SELECT departure_seconds FROM stop_times
      WHERE trip_id = ? AND stop_id = ?
      ORDER BY stop_sequence ASC
      LIMIT 1;`,
    tripId,
    stopId,
  );
  return row?.departure_seconds ?? null;
}

/**
 * Returns the first and last scheduled departures of the service day that
 * `now` falls on, for `(routeCode, stopId)`. Drives "First bus at HH:MM" /
 * "Service ended" copy.
 */
export async function getServiceDayBounds(
  db: Db,
  routeCode: string,
  stopId: string,
  now: Date,
): Promise<ServiceDayBounds> {
  const today = toMalaysiaParts(now);
  const services = await getActiveServiceIdsForDate(db, now);
  if (services.length === 0) {
    return { firstEpochMs: null, lastEpochMs: null };
  }
  const ph = services.map(() => "?").join(",");
  const row = await db.getFirstAsync<{
    first_sec: number | null;
    last_sec: number | null;
  }>(
    `SELECT MIN(st.departure_seconds) AS first_sec,
            MAX(st.departure_seconds) AS last_sec
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id
       JOIN routes r ON r.route_id = t.route_id
      WHERE r.code = ?
        AND st.stop_id = ?
        AND st.departure_seconds IS NOT NULL
        AND t.service_id IN (${ph});`,
    routeCode,
    stopId,
    ...services,
  );
  if (!row) return { firstEpochMs: null, lastEpochMs: null };
  return {
    firstEpochMs:
      row.first_sec != null
        ? today.midnightUtcMs + row.first_sec * 1000
        : null,
    lastEpochMs:
      row.last_sec != null
        ? today.midnightUtcMs + row.last_sec * 1000
        : null,
  };
}
