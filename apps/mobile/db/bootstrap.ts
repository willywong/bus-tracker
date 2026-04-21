import type { RouteId, T816Bundle } from "@bus-tracker/shared";
import { gtfsTimeToSeconds } from "@bus-tracker/shared";
import { API_BASE_URL } from "@/config/env";
import { AVAILABLE_ROUTE_CODES } from "@/hooks/useSettings";
import { openDb, type Db } from "./database";
import { META_KEYS } from "./schema";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

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

async function cacheHasAllRoutes(
  db: Db,
  expected: readonly RouteId[],
): Promise<boolean> {
  if (expected.length === 0) return true;
  const placeholders = expected.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ code: string }>(
    `SELECT code FROM routes WHERE code IN (${placeholders});`,
    ...expected,
  );
  const have = new Set(rows.map((r) => r.code));
  return expected.every((c) => have.has(c));
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

async function hasRouteWithoutTrips(
  db: Db,
  expected: readonly RouteId[],
): Promise<boolean> {
  if (expected.length === 0) return false;
  const placeholders = expected.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ code: string; n: number }>(
    `SELECT r.code AS code, COUNT(t.trip_id) AS n
       FROM routes r
       LEFT JOIN trips t ON t.route_id = r.route_id
      WHERE r.code IN (${placeholders})
      GROUP BY r.code;`,
    ...expected,
  );
  // A code present in the routes table with zero trips means a stale or
  // half-written bundle. Force a refresh to recover.
  return rows.some((row) => (row.n ?? 0) === 0);
}

export async function needsRefresh(
  db: Db,
  now: number = Date.now(),
  staleMs: number = STALE_AFTER_MS,
): Promise<boolean> {
  const fetchedAt = await getMeta(db, META_KEYS.fetchedAt);
  if (!fetchedAt) return true;
  const ts = Number.parseInt(fetchedAt, 10);
  if (!Number.isFinite(ts)) return true;
  if (now - ts > staleMs) return true;
  // A new route code was shipped — cache is stale regardless of TTL.
  if (!(await cacheHasAllRoutes(db, AVAILABLE_ROUTE_CODES))) return true;
  // Cache has the routes row but no trips for it — a partial bundle from an
  // older API/JS combo or an interrupted writeBundle. Without this check, the
  // cache silently serves an empty schedule for that route forever.
  if (await hasRouteWithoutTrips(db, AVAILABLE_ROUTE_CODES)) return true;
  // Defence against a half-written bundle (e.g. app killed mid-write, or a v1
  // install upgrading to v2 where stop_times is a new table).
  if (await hasOrphanTrips(db)) return true;
  return false;
}

export async function writeBundle(
  db: Db,
  bundle: T816Bundle,
  now: number = Date.now(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(
      "DELETE FROM routes; DELETE FROM stops; DELETE FROM trips; DELETE FROM shape_points; DELETE FROM stop_times; DELETE FROM calendar; DELETE FROM traffic_signals;",
    );

    for (const r of bundle.routes) {
      await db.runAsync(
        "INSERT INTO routes(route_id, code, long_name) VALUES (?, ?, ?);",
        r.route_id,
        r.code,
        r.long_name ?? null,
      );
    }

    for (const s of bundle.stops) {
      await db.runAsync(
        "INSERT INTO stops(stop_id, stop_name, stop_lat, stop_lon) VALUES (?, ?, ?, ?);",
        s.stop_id,
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
      );
    }

    for (const t of bundle.trips) {
      await db.runAsync(
        "INSERT INTO trips(trip_id, route_id, service_id, shape_id, direction_id) VALUES (?, ?, ?, ?, ?);",
        t.trip_id,
        t.route_id,
        t.service_id,
        t.shape_id ?? null,
        t.direction_id ?? null,
      );
    }

    for (const [shapeId, points] of Object.entries(bundle.shapes)) {
      for (const p of points) {
        await db.runAsync(
          "INSERT INTO shape_points(shape_id, seq, lat, lng) VALUES (?, ?, ?, ?);",
          shapeId,
          p.seq,
          p.lat,
          p.lng,
        );
      }
    }

    if (bundle.stopTimes.length > 0) {
      const stopTimeStmt = await db.prepareAsync(
        "INSERT INTO stop_times(trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds) VALUES (?, ?, ?, ?, ?);",
      );
      try {
        for (const st of bundle.stopTimes) {
          await stopTimeStmt.executeAsync([
            st.trip_id,
            st.stop_sequence,
            st.stop_id,
            gtfsTimeToSeconds(st.arrival_time),
            gtfsTimeToSeconds(st.departure_time),
          ]);
        }
      } finally {
        await stopTimeStmt.finalizeAsync();
      }
    }

    if (bundle.calendar.length > 0) {
      const calStmt = await db.prepareAsync(
        "INSERT INTO calendar(service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
        "INSERT OR IGNORE INTO traffic_signals(route_code, osm_id, lat, lng) VALUES (?, ?, ?, ?);",
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

    await setMeta(db, META_KEYS.fetchedAt, String(now));
    await setMeta(db, META_KEYS.generatedAt, String(bundle.generatedAt));
  });
}

export async function fetchBundleFromApi(
  baseUrl: string = API_BASE_URL,
  signal?: AbortSignal,
): Promise<T816Bundle> {
  const res = await fetch(`${baseUrl}/api/gtfs-static`, { signal });
  if (!res.ok) {
    throw new Error(`gtfs-static ${res.status}`);
  }
  return (await res.json()) as T816Bundle;
}

export interface BootstrapResult {
  refreshed: boolean;
  generatedAt: number | null;
}

let inflight: Promise<BootstrapResult> | null = null;

export async function bootstrapStaticGtfs(opts?: {
  db?: Db;
  fetchBundle?: (signal?: AbortSignal) => Promise<T816Bundle>;
  now?: () => number;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<BootstrapResult> {
  if (inflight && !opts?.force) return inflight;

  const run = (async (): Promise<BootstrapResult> => {
    const db = opts?.db ?? (await openDb());
    const now = (opts?.now ?? Date.now)();
    const fetchBundle =
      opts?.fetchBundle ?? ((s) => fetchBundleFromApi(undefined, s));

    const mustRefresh = opts?.force || (await needsRefresh(db, now));
    if (!mustRefresh) {
      const gen = await getMeta(db, META_KEYS.generatedAt);
      return { refreshed: false, generatedAt: gen ? Number(gen) : null };
    }

    const bundle = await fetchBundle(opts?.signal);
    await writeBundle(db, bundle, now);
    return { refreshed: true, generatedAt: bundle.generatedAt };
  })();

  inflight = run;
  try {
    return await run;
  } catch (err) {
    inflight = null;
    throw err;
  }
}

export function resetBootstrapCacheForTests(): void {
  inflight = null;
}
