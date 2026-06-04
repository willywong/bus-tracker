import { toMalaysiaParts } from "@bus-tracker/shared";
import type { Db } from "./database";

export interface StopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  /** 0/null = no info, 1 = accessible, 2 = not accessible. */
  wheelchair_boarding: number | null;
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
  trip_headsign: string | null;
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
    "SELECT stop_id, stop_name, stop_lat, stop_lon, wheelchair_boarding FROM stops ORDER BY stop_name;",
  );
}

export async function getStopsForRoute(
  db: Db,
  routeCode: string,
): Promise<StopRow[]> {
  return db.getAllAsync<StopRow>(
    `SELECT DISTINCT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.wheelchair_boarding
       FROM stops s
       JOIN stop_times st ON st.stop_id = s.stop_id
       JOIN trips t       ON t.trip_id  = st.trip_id
       JOIN routes r      ON r.route_id = t.route_id
      WHERE r.code = ?
      ORDER BY s.stop_name;`,
    routeCode,
  );
}

/**
 * Returns the stops of `routeCode` in route-sequence order as observed on a
 * representative trip. Representative trip is chosen by the same heuristic as
 * `getRoutePolyline`: group the route's trips by `shape_id`, pick the most
 * common shape; within ties, prefer `direction_id = 0`. Loop revisits of the
 * same stop collapse via `MIN(stop_sequence)`. Stops that somehow aren't on
 * the representative trip fall back to the tail, alphabetical.
 */
export async function getStopsForRouteOrdered(
  db: Db,
  routeCode: string,
): Promise<StopRow[]> {
  return db.getAllAsync<StopRow>(
    `WITH rep_shape AS (
       SELECT t.shape_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE r.code = ? AND t.shape_id IS NOT NULL
        GROUP BY t.shape_id
        ORDER BY COUNT(*) DESC,
                 MIN(CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END) ASC,
                 t.shape_id ASC
        LIMIT 1
     ),
     rep_trip AS (
       SELECT t.trip_id
         FROM trips t
         JOIN rep_shape rs ON rs.shape_id = t.shape_id
         ORDER BY CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END,
                  t.trip_id
         LIMIT 1
     ),
     ordered_stops AS (
       SELECT st.stop_id, MIN(st.stop_sequence) AS seq
         FROM stop_times st
         JOIN rep_trip rt ON rt.trip_id = st.trip_id
        GROUP BY st.stop_id
     )
     SELECT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.wheelchair_boarding
       FROM stops s
       JOIN (
         SELECT DISTINCT st.stop_id
           FROM stop_times st
           JOIN trips t  ON t.trip_id  = st.trip_id
           JOIN routes r ON r.route_id = t.route_id
          WHERE r.code = ?
       ) route_stops ON route_stops.stop_id = s.stop_id
       LEFT JOIN ordered_stops os ON os.stop_id = s.stop_id
      ORDER BY CASE WHEN os.seq IS NULL THEN 1 ELSE 0 END,
               os.seq ASC,
               s.stop_name ASC;`,
    routeCode,
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
    "SELECT trip_id, route_id, service_id, shape_id, direction_id, trip_headsign FROM trips WHERE route_id = ?;",
    routeId,
  );
}

/**
 * Returns the most common trip_headsign for a route, or null if none. Used to
 * label the route with its destination (e.g. "Loop via KL Sentral").
 */
export async function getPrimaryTripHeadsign(
  db: Db,
  routeCode: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ headsign: string | null }>(
    `SELECT t.trip_headsign AS headsign
       FROM trips t
       JOIN routes r ON r.route_id = t.route_id
      WHERE r.code = ? AND t.trip_headsign IS NOT NULL AND t.trip_headsign <> ''
      GROUP BY t.trip_headsign
      ORDER BY COUNT(*) DESC
      LIMIT 1;`,
    routeCode,
  );
  return row?.headsign ?? null;
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
// Service activation = (calendar row matches DOW + date range) unless
// calendar_dates overrides for this date (exception_type=2 removes service,
// exception_type=1 adds service). Honors GTFS v2 semantics.
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
  const [calendarRows, exceptionRows] = await Promise.all([
    db.getAllAsync<{ service_id: string }>(
      `SELECT service_id FROM calendar
        WHERE ${dowCol} = 1
          AND start_date <= ?
          AND end_date >= ?;`,
      ymd,
      ymd,
    ),
    db.getAllAsync<{ service_id: string; exception_type: number }>(
      `SELECT service_id, exception_type FROM calendar_dates WHERE date = ?;`,
      ymd,
    ),
  ]);
  const active = new Set(calendarRows.map((r) => r.service_id));
  for (const ex of exceptionRows) {
    if (ex.exception_type === 2) active.delete(ex.service_id);
    else if (ex.exception_type === 1) active.add(ex.service_id);
  }
  return Array.from(active);
}

// ---------------------------------------------------------------------------
// Fare queries
// ---------------------------------------------------------------------------

export interface FareInfo {
  fareId: string;
  price: number;
  currency: string;
}

/**
 * Returns the cheapest applicable fare for `routeCode`. Applies the simple
 * "route-scoped rule" pattern: fare_rules rows where route_id matches.
 * Returns null if no fare data is available for this route.
 */
export async function getFareForRoute(
  db: Db,
  routeCode: string,
): Promise<FareInfo | null> {
  const row = await db.getFirstAsync<{
    fare_id: string;
    price: number;
    currency_type: string;
  }>(
    `SELECT fa.fare_id AS fare_id, fa.price AS price, fa.currency_type AS currency_type
       FROM fare_attributes fa
       JOIN fare_rules fr ON fr.fare_id = fa.fare_id
       JOIN routes r ON r.route_id = fr.route_id
      WHERE r.code = ?
      ORDER BY fa.price ASC
      LIMIT 1;`,
    routeCode,
  );
  if (!row) return null;
  return { fareId: row.fare_id, price: row.price, currency: row.currency_type };
}

// ---------------------------------------------------------------------------
// Transfer queries
// ---------------------------------------------------------------------------

export interface TransferRow {
  fromStopId: string;
  toStopId: string;
  transferType: number;
  minTransferTime: number | null;
}

/**
 * Returns outbound transfers from `stopId`. Empty when the feed has no
 * transfers entries for this stop.
 */
export async function getTransfersFromStop(
  db: Db,
  stopId: string,
): Promise<TransferRow[]> {
  const rows = await db.getAllAsync<{
    from_stop_id: string;
    to_stop_id: string;
    transfer_type: number;
    min_transfer_time: number | null;
  }>(
    `SELECT from_stop_id, to_stop_id, transfer_type, min_transfer_time
       FROM transfers WHERE from_stop_id = ?;`,
    stopId,
  );
  return rows.map((r) => ({
    fromStopId: r.from_stop_id,
    toStopId: r.to_stop_id,
    transferType: r.transfer_type,
    minTransferTime: r.min_transfer_time,
  }));
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

export interface TripStopWithName extends TripStopTimeRow {
  stopName: string;
  stopLat: number;
  stopLon: number;
  wheelchairBoarding: number | null;
}

/**
 * Like `getStopTimesForTrip` but joins `stops` for display data (name, coords,
 * wheelchair flag). Drives the stop-by-stop ETA board.
 */
export async function getTripStopsWithNames(
  db: Db,
  tripId: string,
): Promise<TripStopWithName[]> {
  const rows = await db.getAllAsync<{
    stop_id: string;
    stop_sequence: number;
    arrival_seconds: number | null;
    departure_seconds: number | null;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
    wheelchair_boarding: number | null;
  }>(
    `SELECT st.stop_id, st.stop_sequence, st.arrival_seconds, st.departure_seconds,
            s.stop_name, s.stop_lat, s.stop_lon, s.wheelchair_boarding
       FROM stop_times st
       JOIN stops s ON s.stop_id = st.stop_id
      WHERE st.trip_id = ?
      ORDER BY st.stop_sequence ASC;`,
    tripId,
  );
  return rows.map((r) => ({
    stopId: r.stop_id,
    stopSequence: r.stop_sequence,
    arrivalSeconds: r.arrival_seconds,
    departureSeconds: r.departure_seconds,
    stopName: r.stop_name,
    stopLat: r.stop_lat,
    stopLon: r.stop_lon,
    wheelchairBoarding: r.wheelchair_boarding,
  }));
}

export type TripStopsSource = "exact" | "suffix" | "representative";

export interface ResolvedStaticTripId {
  tripId: string;
  source: TripStopsSource;
}

export interface ResolvedTripStops {
  stops: TripStopWithName[];
  source: TripStopsSource;
  /** The static trip_id whose stop_times we actually loaded. Null when no static trip matched and we returned []. */
  resolvedTripId: string | null;
}

/**
 * Resolves a live `trip_id` (from a realtime VehiclePosition / TripUpdate) to
 * a `trip_id` that exists in our on-device static GTFS bundle. Necessary
 * whenever the static feed and the realtime feed drift apart — Prasarana's
 * static `prasarana.zip` is regenerated infrequently while the realtime feed
 * rotates a `YYMMDD` date prefix daily, so any direct `WHERE trip_id = ?`
 * lookup against static silently misses on stale-static days.
 *
 * Three-tier resolution, returns the first match:
 *   1. **exact**     — the live trip_id is already in `trips`. Happy path.
 *   2. **suffix**    — strip leading `YYMMDD` and find a static trip on the
 *                      same route whose trip_id ends with the same suffix.
 *                      Handles "only the date prefix changed" drift.
 *   3. **representative** — pick a representative trip for the route (most
 *                      common shape, prefer direction_id=0). Handles "trip
 *                      patterns themselves rotated upstream" drift. Per-stop
 *                      schedules will be from a different trip and may be off
 *                      by a few minutes; live TripUpdates (matched on stop_id)
 *                      still flow through accurately.
 *
 * Returns `null` when even tier 3 finds no trip for the route — i.e. the route
 * isn't in the static bundle at all (route was just favorited and the bundle
 * hasn't bootstrapped yet, or upstream genuinely dropped the route).
 */
export async function resolveStaticTripId(
  db: Db,
  liveTripId: string,
  routeCode: string,
): Promise<ResolvedStaticTripId | null> {
  // Tier 1: exact (primary-key lookup, near-free).
  const exact = await db.getFirstAsync<{ trip_id: string }>(
    `SELECT trip_id FROM trips WHERE trip_id = ? LIMIT 1;`,
    liveTripId,
  );
  if (exact?.trip_id) {
    return { tripId: exact.trip_id, source: "exact" };
  }

  // Tier 2: strip leading YYMMDD if present and look for any static trip on
  // this route whose trip_id ends with the same suffix.
  const suffix = stripTripIdDatePrefix(liveTripId);
  if (suffix && suffix !== liveTripId) {
    const row = await db.getFirstAsync<{ trip_id: string }>(
      `SELECT t.trip_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE r.code = ?
          AND substr(t.trip_id, -length(?)) = ?
        LIMIT 1;`,
      routeCode,
      suffix,
      suffix,
    );
    if (row?.trip_id) {
      warnDriftOnce(routeCode, "suffix", liveTripId, row.trip_id);
      return { tripId: row.trip_id, source: "suffix" };
    }
  }

  // Tier 3: representative trip for the route.
  // Mirrors the rep-trip selection in `getStopsForRouteOrdered`: most-common
  // shape; within ties, prefer direction_id=0; then any trip_id deterministically.
  const repTrip = await db.getFirstAsync<{ trip_id: string }>(
    `WITH rep_shape AS (
       SELECT t.shape_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE r.code = ? AND t.shape_id IS NOT NULL
        GROUP BY t.shape_id
        ORDER BY COUNT(*) DESC,
                 MIN(CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END) ASC,
                 t.shape_id ASC
        LIMIT 1
     )
     SELECT t.trip_id
       FROM trips t
       JOIN routes r ON r.route_id = t.route_id
       LEFT JOIN rep_shape rs ON 1=1
      WHERE r.code = ?
        AND (rs.shape_id IS NULL OR t.shape_id = rs.shape_id)
      ORDER BY CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END,
               t.trip_id
      LIMIT 1;`,
    routeCode,
    routeCode,
  );
  if (repTrip?.trip_id) {
    warnDriftOnce(routeCode, "representative", liveTripId, repTrip.trip_id);
    return { tripId: repTrip.trip_id, source: "representative" };
  }

  return null;
}

/**
 * Loads stop_times for a live `tripId`, with the same drift-resolution ladder
 * as `resolveStaticTripId` plus a stop-count guard at each tier — if a tier
 * resolves to a trip whose `stop_times` happen to be empty (orphan-trip row,
 * partial bundle import) we fall through to the next tier rather than
 * showing the user an empty list.
 *
 * Caller signals fallback usage to the user via the returned `source`.
 */
export async function resolveTripStops(
  db: Db,
  liveTripId: string,
  routeCode: string,
): Promise<ResolvedTripStops> {
  const exact = await getTripStopsWithNames(db, liveTripId);
  if (exact.length > 0) {
    return { stops: exact, source: "exact", resolvedTripId: liveTripId };
  }

  // Tier 2: strip leading YYMMDD if present and look for any static trip
  // (constrained to this route) whose trip_id ends with the same suffix.
  const suffix = stripTripIdDatePrefix(liveTripId);
  if (suffix && suffix !== liveTripId) {
    const row = await db.getFirstAsync<{ trip_id: string }>(
      `SELECT t.trip_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE r.code = ?
          AND substr(t.trip_id, -length(?)) = ?
        LIMIT 1;`,
      routeCode,
      suffix,
      suffix,
    );
    if (row?.trip_id) {
      const stops = await getTripStopsWithNames(db, row.trip_id);
      if (stops.length > 0) {
        warnDriftOnce(routeCode, "suffix", liveTripId, row.trip_id);
        return { stops, source: "suffix", resolvedTripId: row.trip_id };
      }
    }
  }

  // Tier 3: representative trip for the route.
  // Mirrors the rep-trip selection in `getStopsForRouteOrdered`: most-common
  // shape; within ties, prefer direction_id=0; then any trip_id deterministically.
  const repTrip = await db.getFirstAsync<{ trip_id: string }>(
    `WITH rep_shape AS (
       SELECT t.shape_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE r.code = ? AND t.shape_id IS NOT NULL
        GROUP BY t.shape_id
        ORDER BY COUNT(*) DESC,
                 MIN(CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END) ASC,
                 t.shape_id ASC
        LIMIT 1
     )
     SELECT t.trip_id
       FROM trips t
       JOIN routes r ON r.route_id = t.route_id
       LEFT JOIN rep_shape rs ON 1=1
      WHERE r.code = ?
        AND (rs.shape_id IS NULL OR t.shape_id = rs.shape_id)
      ORDER BY CASE WHEN t.direction_id = 0 THEN 0 ELSE 1 END,
               t.trip_id
      LIMIT 1;`,
    routeCode,
    routeCode,
  );
  if (repTrip?.trip_id) {
    const stops = await getTripStopsWithNames(db, repTrip.trip_id);
    if (stops.length > 0) {
      warnDriftOnce(routeCode, "representative", liveTripId, repTrip.trip_id);
      return {
        stops,
        source: "representative",
        resolvedTripId: repTrip.trip_id,
      };
    }
  }

  return { stops: [], source: "exact", resolvedTripId: null };
}

/** Returns the stable suffix of a Prasarana-style trip_id with a leading
 *  6-digit date (YYMMDD), or null when the input doesn't match that shape. */
function stripTripIdDatePrefix(tripId: string): string | null {
  const m = /^\d{6}(.+)$/.exec(tripId);
  return m ? m[1] : null;
}

// Per-route+tier dedup so we log drift at most once per session per route.
// The static bundle is upstream-controlled and out of our hands; we only need
// the breadcrumb when investigating an actual report.
const driftWarned = new Set<string>();
function warnDriftOnce(
  routeCode: string,
  tier: "suffix" | "representative",
  liveTripId: string,
  resolvedTripId: string,
): void {
  const key = `${routeCode}:${tier}`;
  if (driftWarned.has(key)) return;
  driftWarned.add(key);
  console.warn(
    `[gtfs-drift] route ${routeCode}: live trip_id "${liveTripId}" not in static bundle; ` +
      `resolved via ${tier} → "${resolvedTripId}". Static bundle likely stale.`,
  );
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
