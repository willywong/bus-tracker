import type { T816Bundle } from "@bus-tracker/shared";
import { API_BASE_URL } from "@/config/env";
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

export async function needsRefresh(
  db: Db,
  now: number = Date.now(),
  staleMs: number = STALE_AFTER_MS,
): Promise<boolean> {
  const fetchedAt = await getMeta(db, META_KEYS.fetchedAt);
  if (!fetchedAt) return true;
  const ts = Number.parseInt(fetchedAt, 10);
  if (!Number.isFinite(ts)) return true;
  return now - ts > staleMs;
}

export async function writeBundle(
  db: Db,
  bundle: T816Bundle,
  now: number = Date.now(),
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(
      "DELETE FROM routes; DELETE FROM stops; DELETE FROM trips; DELETE FROM shape_points;",
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
