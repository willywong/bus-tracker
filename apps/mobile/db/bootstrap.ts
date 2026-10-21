import type { T816Bundle } from "@bus-tracker/shared";
import { gtfsTimeToSeconds, isBusCategory } from "@bus-tracker/shared";
import { getRouteBundle, RouteNotFoundError } from "@/services/gtfsFeed";
import { openDb, type Db } from "./database";
import { getRouteCategory } from "./queries";
import { META_KEYS } from "./schema";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function isDev(): boolean {
  const g = globalThis as unknown as { __DEV__?: boolean };
  return g.__DEV__ ?? false;
}

export { RouteNotFoundError };

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?;",
    key,
  );
  return row?.value ?? null;
}

async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?);",
    key,
    value,
  );
}

async function hasOrphanTrips(db: Db): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM trips
      WHERE NOT EXISTS (
        SELECT 1 FROM stop_times st WHERE st.trip_id = trips.trip_id
      );`,
  );
  return (row?.n ?? 0) > 0;
}

async function getCachedRouteCodes(db: Db): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ code: string }>(
    "SELECT code FROM routes;",
  );
  return new Set(rows.map((r) => r.code));
}

async function getEmptyRouteCodes(db: Db): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ code: string; n: number }>(
    `SELECT r.code AS code, COUNT(t.trip_id) AS n
       FROM routes r
       LEFT JOIN trips t ON t.route_id = r.route_id
      GROUP BY r.code;`,
  );
  const out = new Set<string>();
  for (const row of rows) {
    if ((row.n ?? 0) === 0) out.add(row.code);
  }
  return out;
}

/**
 * Returns the subset of `favorites` that need to be (re)fetched from the API.
 * Checks: overall TTL (>24h → all), missing routes, routes without trips, and
 * orphan trips (stale half-write recovery — marks every favorite stale).
 */
export async function needsRefresh(
  db: Db,
  favorites: readonly string[],
  now: number = Date.now(),
  staleMs: number = STALE_AFTER_MS,
): Promise<string[]> {
  if (favorites.length === 0) return [];

  const fetchedAt = await getMeta(db, META_KEYS.fetchedAt);
  const ts = fetchedAt ? Number.parseInt(fetchedAt, 10) : NaN;
  const ttlExpired =
    !Number.isFinite(ts) || now - ts > staleMs;
  if (ttlExpired) return Array.from(new Set(favorites));

  if (await hasOrphanTrips(db)) return Array.from(new Set(favorites));

  const cached = await getCachedRouteCodes(db);
  const empty = await getEmptyRouteCodes(db);
  const out = new Set<string>();
  for (const code of favorites) {
    if (!cached.has(code)) out.add(code);
    else if (empty.has(code)) out.add(code);
  }
  return Array.from(out);
}

async function deleteRouteRows(db: Db, code: string): Promise<void> {
  // Cascade-cleanup (SQLite has no ON DELETE CASCADE in this schema). Order
  // matters: children before parents. The route's stops and shapes go last,
  // and only those no other route still calls at or draws. Calendar rows are
  // kept: other routes may share a service_id.
  await db.execAsync(
    "CREATE TEMP TABLE IF NOT EXISTS pruned_stops(stop_id TEXT PRIMARY KEY NOT NULL); DELETE FROM temp.pruned_stops;" +
      "CREATE TEMP TABLE IF NOT EXISTS pruned_shapes(shape_id TEXT PRIMARY KEY NOT NULL); DELETE FROM temp.pruned_shapes;",
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO temp.pruned_stops(stop_id)
       SELECT st.stop_id FROM stop_times st
       JOIN trips t  ON t.trip_id  = st.trip_id
       JOIN routes r ON r.route_id = t.route_id
       WHERE r.code = ?;`,
    code,
  );
  await db.runAsync(
    `DELETE FROM stop_times
       WHERE trip_id IN (
         SELECT t.trip_id FROM trips t
         JOIN routes r ON r.route_id = t.route_id
         WHERE r.code = ?
       );`,
    code,
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO temp.pruned_shapes(shape_id)
       SELECT t.shape_id FROM trips t
       JOIN routes r ON r.route_id = t.route_id
       WHERE r.code = ? AND t.shape_id IS NOT NULL;`,
    code,
  );
  await db.runAsync(
    `DELETE FROM trips
       WHERE route_id IN (SELECT route_id FROM routes WHERE code = ?);`,
    code,
  );
  await db.runAsync("DELETE FROM traffic_signals WHERE route_code = ?;", code);
  await db.runAsync("DELETE FROM routes WHERE code = ?;", code);
  await db.runAsync(
    `DELETE FROM stops
       WHERE stop_id IN (
         SELECT p.stop_id FROM temp.pruned_stops p
         WHERE NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.stop_id = p.stop_id)
       );`,
  );
  await db.runAsync(
    `DELETE FROM shape_points
       WHERE shape_id IN (
         SELECT p.shape_id FROM temp.pruned_shapes p
         WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.shape_id = p.shape_id)
       );`,
  );
}

/** Removes all rows belonging exclusively to `code`. Safe to call outside a txn. */
export async function pruneRoute(db: Db, code: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await deleteRouteRows(db, code);
  });
}

/**
 * Merges a single-route `bundle` into SQLite: deletes any existing rows for
 * the route (cascade), then inserts routes/trips/shape_points/stop_times.
 * Stops and calendar entries are upserted (shared across routes).
 */
export async function mergeBundle(
  db: Db,
  bundle: T816Bundle,
  now: number = Date.now(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Clear each route key once: a key can span several route_ids.
    for (const code of new Set(bundle.routes.map((r) => r.code))) {
      await deleteRouteRows(db, code);
    }
    for (const route of bundle.routes) {
      await db.runAsync(
        "INSERT INTO routes(route_id, code, long_name, category) VALUES (?, ?, ?, ?);",
        route.route_id,
        route.code,
        route.long_name ?? null,
        bundle.category ?? null,
      );
    }

    for (const s of bundle.stops) {
      // Stops are shared across routes. Upsert so newer bundles can fill in
      // wheelchair_boarding on stops inserted by earlier route bootstraps.
      await db.runAsync(
        `INSERT INTO stops(stop_id, stop_name, stop_lat, stop_lon, wheelchair_boarding)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(stop_id) DO UPDATE SET
           stop_name = excluded.stop_name,
           stop_lat = excluded.stop_lat,
           stop_lon = excluded.stop_lon,
           wheelchair_boarding = COALESCE(excluded.wheelchair_boarding, stops.wheelchair_boarding);`,
        s.stop_id,
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
        s.wheelchair_boarding ?? null,
      );
    }

    for (const t of bundle.trips) {
      await db.runAsync(
        `INSERT OR REPLACE INTO trips(trip_id, route_id, service_id, shape_id, direction_id, trip_headsign)
         VALUES (?, ?, ?, ?, ?, ?);`,
        t.trip_id,
        t.route_id,
        t.service_id,
        t.shape_id ?? null,
        t.direction_id ?? null,
        t.trip_headsign ?? null,
      );
    }

    // Shapes and stop_times are the bulk of a bundle (a busy Rapid KL or
    // Penang route has 20–40k stop_times), so they go in as multi-row
    // INSERTs rather than one bridge call per row.
    const shapeRows: unknown[][] = [];
    for (const [shapeId, points] of Object.entries(bundle.shapes)) {
      for (const p of points) shapeRows.push([shapeId, p.seq, p.lat, p.lng]);
    }
    await insertRows(db, "INSERT OR REPLACE INTO shape_points(shape_id, seq, lat, lng)", shapeRows);

    await insertRows(
      db,
      "INSERT OR REPLACE INTO stop_times(trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds)",
      bundle.stopTimes.map((st) => [
        st.trip_id,
        st.stop_sequence,
        st.stop_id,
        gtfsTimeToSeconds(st.arrival_time),
        gtfsTimeToSeconds(st.departure_time),
      ]),
    );

    if (bundle.calendar.length > 0) {
      const calStmt = await db.prepareAsync(
        `INSERT OR REPLACE INTO calendar(service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      );
      try {
        for (const c of bundle.calendar) {
          await calStmt.executeAsync([
            c.service_id,
            c.monday ? 1 : 0,
            c.tuesday ? 1 : 0,
            c.wednesday ? 1 : 0,
            c.thursday ? 1 : 0,
            c.friday ? 1 : 0,
            c.saturday ? 1 : 0,
            c.sunday ? 1 : 0,
            c.start_date,
            c.end_date,
          ]);
        }
      } finally {
        await calStmt.finalizeAsync();
      }
    }

    if (bundle.trafficSignals) {
      const sigStmt = await db.prepareAsync(
        `INSERT OR IGNORE INTO traffic_signals(route_code, osm_id, lat, lng)
         VALUES (?, ?, ?, ?);`,
      );
      try {
        for (const [code, signals] of Object.entries(bundle.trafficSignals)) {
          for (const s of signals) {
            await sigStmt.executeAsync([code, s.id, s.lat, s.lng]);
          }
        }
      } finally {
        await sigStmt.finalizeAsync();
      }
    }

    if (bundle.calendarDates && bundle.calendarDates.length > 0) {
      const stmt = await db.prepareAsync(
        `INSERT OR REPLACE INTO calendar_dates(service_id, date, exception_type)
         VALUES (?, ?, ?);`,
      );
      try {
        for (const c of bundle.calendarDates) {
          await stmt.executeAsync([c.service_id, c.date, c.exception_type]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    }

    if (bundle.fareAttributes && bundle.fareAttributes.length > 0) {
      const stmt = await db.prepareAsync(
        `INSERT OR REPLACE INTO fare_attributes(fare_id, price, currency_type, payment_method, transfers, transfer_duration)
         VALUES (?, ?, ?, ?, ?, ?);`,
      );
      try {
        for (const a of bundle.fareAttributes) {
          await stmt.executeAsync([
            a.fare_id,
            a.price,
            a.currency_type,
            a.payment_method ?? null,
            a.transfers ?? null,
            a.transfer_duration ?? null,
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    }

    if (bundle.fareRules && bundle.fareRules.length > 0) {
      // Rules have no natural PK in GTFS; wipe & reinsert for the scoped
      // fare_ids to avoid stale rules from earlier bundles.
      const fareIds = Array.from(
        new Set(bundle.fareRules.map((r) => r.fare_id)),
      );
      if (fareIds.length > 0) {
        const ph = fareIds.map(() => "?").join(",");
        await db.runAsync(
          `DELETE FROM fare_rules WHERE fare_id IN (${ph});`,
          ...fareIds,
        );
      }
      const stmt = await db.prepareAsync(
        `INSERT INTO fare_rules(fare_id, route_id, origin_id, destination_id, contains_id)
         VALUES (?, ?, ?, ?, ?);`,
      );
      try {
        for (const r of bundle.fareRules) {
          await stmt.executeAsync([
            r.fare_id,
            r.route_id ?? null,
            r.origin_id ?? null,
            r.destination_id ?? null,
            r.contains_id ?? null,
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    }

    if (bundle.transfers && bundle.transfers.length > 0) {
      const stmt = await db.prepareAsync(
        `INSERT OR REPLACE INTO transfers(from_stop_id, to_stop_id, transfer_type, min_transfer_time)
         VALUES (?, ?, ?, ?);`,
      );
      try {
        for (const t of bundle.transfers) {
          await stmt.executeAsync([
            t.from_stop_id,
            t.to_stop_id,
            t.transfer_type,
            t.min_transfer_time ?? null,
          ]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    }

    await setMeta(db, META_KEYS.generatedAt, String(bundle.generatedAt));
  });
}

/** Rows per multi-row INSERT; 150 × 5 columns stays under the 999-parameter limit of older SQLite builds. */
const INSERT_CHUNK_ROWS = 150;

async function insertRows(db: Db, head: string, rows: readonly unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const width = rows[0].length;
  const tuple = `(${Array(width).fill("?").join(", ")})`;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    await db.runAsync(
      `${head} VALUES ${chunk.map(() => tuple).join(", ")};`,
      ...(chunk.flat() as (string | number | null)[]),
    );
  }
}

/**
 * One route's static data, cut from the data.gov.my GTFS feed on device. A
 * route already in SQLite is looked up in the feed it came from.
 */
export async function fetchRouteBundle(
  code: string,
  signal?: AbortSignal,
  db?: Db,
): Promise<T816Bundle> {
  const stored = await getRouteCategory(db ?? (await openDb()), code).catch(() => null);
  return getRouteBundle(code, signal, isBusCategory(stored) ? stored : null);
}

export interface BootstrapResult {
  /** Route codes whose bundles were (re)fetched this run. */
  refreshed: string[];
  /** Route codes whose fetch failed — does not include routes that were already fresh. */
  failed: string[];
  /** Absolute epoch ms of the newest `generatedAt` across refreshed bundles, else the cached value. */
  generatedAt: number | null;
}

const inflightByKey = new Map<string, Promise<BootstrapResult>>();

function normalizeRoutes(routes: readonly string[]): string[] {
  return Array.from(new Set(routes)).sort();
}

export async function bootstrapStaticGtfs(opts: {
  routes: readonly string[];
  db?: Db;
  fetchBundle?: (code: string, signal?: AbortSignal) => Promise<T816Bundle>;
  now?: () => number;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<BootstrapResult> {
  const key = normalizeRoutes(opts.routes).join(",");
  if (!opts.force) {
    const existing = inflightByKey.get(key);
    if (existing) return existing;
  }

  const run = (async (): Promise<BootstrapResult> => {
    const db = opts.db ?? (await openDb());
    const now = (opts.now ?? Date.now)();
    const fetchBundle =
      opts.fetchBundle ?? ((code, signal) => fetchRouteBundle(code, signal, db));

    if (opts.routes.length === 0) {
      const gen = await getMeta(db, META_KEYS.generatedAt);
      return {
        refreshed: [],
        failed: [],
        generatedAt: gen ? Number(gen) : null,
      };
    }

    const toFetch = opts.force
      ? Array.from(new Set(opts.routes))
      : await needsRefresh(db, opts.routes, now);

    const refreshed: string[] = [];
    const failed: string[] = [];
    let maxGeneratedAt = 0;

    for (const code of toFetch) {
      try {
        const bundle = await fetchBundle(code, opts.signal);
        await mergeBundle(db, bundle, now);
        refreshed.push(code);
        if (bundle.generatedAt > maxGeneratedAt) {
          maxGeneratedAt = bundle.generatedAt;
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        if (isDev()) {
          const e = err as {
            name?: string;
            message?: string;
            stack?: string;
            status?: number;
          };
          console.warn(
            `[gtfs] fetch ${code} failed`,
            "name=",
            e?.name,
            "message=",
            e?.message,
            "status=",
            e?.status,
            "stack=",
            e?.stack,
          );
        } else {
          const msg = (err as { message?: string })?.message ?? String(err);
          console.warn(`[gtfs] fetch ${code} failed: ${msg}`);
        }
        failed.push(code);
      }
    }

    // Only bump fetchedAt if every needed route succeeded. Partial success
    // leaves the stamp stale so the next launch retries the failures.
    if (failed.length === 0 && toFetch.length > 0) {
      await setMeta(db, META_KEYS.fetchedAt, String(now));
    }

    const gen = await getMeta(db, META_KEYS.generatedAt);
    return {
      refreshed,
      failed,
      generatedAt: maxGeneratedAt > 0 ? maxGeneratedAt : gen ? Number(gen) : null,
    };
  })();

  inflightByKey.set(key, run);
  try {
    return await run;
  } finally {
    if (inflightByKey.get(key) === run) inflightByKey.delete(key);
  }
}

export function resetBootstrapCacheForTests(): void {
  inflightByKey.clear();
}
