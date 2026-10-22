import * as SQLite from "expo-sqlite";
import { DDL, META_KEYS, SCHEMA_VERSION } from "./schema";

export type Db = SQLite.SQLiteDatabase;

const DB_NAME = "t816.db";

let dbPromise: Promise<Db> | null = null;

export function openDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(DDL.join("\n"));
      await migrate(db);
      await db.runAsync(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?);",
        META_KEYS.schemaVersion,
        String(SCHEMA_VERSION),
      );
      return db;
    })();
  }
  return dbPromise;
}

export async function migrate(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?;",
    META_KEYS.schemaVersion,
  );
  const current = row ? Number(row.value) : 0;
  if (current >= SCHEMA_VERSION) return;

  // v1 -> v2: stop_times + calendar added. The DDL `IF NOT EXISTS` already
  // created them; we just need to invalidate the cached bundle so the next
  // bootstrap refetches and populates the new tables.
  if (current < 2) {
    await db.runAsync("DELETE FROM meta WHERE key = ?;", META_KEYS.fetchedAt);
  }

  // v2 -> v3: traffic_signals added. Same pattern — invalidate the cached
  // bundle so the next bootstrap repopulates the new table.
  if (current < 3) {
    await db.runAsync("DELETE FROM meta WHERE key = ?;", META_KEYS.fetchedAt);
  }

  // v3 -> v4: clean up orphan rows that earlier partial-write bugs could leave
  // behind (observed in the wild as a UNIQUE constraint on stop_times.trip_id
  // when retrying a route whose previous merge failed halfway). Re-invalidate
  // fetchedAt so the next bootstrap re-pulls anything the cleanup affected.
  if (current < 4) {
    await db.runAsync(
      "DELETE FROM stop_times WHERE trip_id NOT IN (SELECT trip_id FROM trips);",
    );
    await db.runAsync(
      "DELETE FROM trips WHERE route_id NOT IN (SELECT route_id FROM routes);",
    );
    await db.runAsync(
      `DELETE FROM shape_points
         WHERE shape_id NOT IN (
           SELECT DISTINCT shape_id FROM trips WHERE shape_id IS NOT NULL
         );`,
    );
    await db.runAsync("DELETE FROM meta WHERE key = ?;", META_KEYS.fetchedAt);
  }

  // v4 -> v5: add wheelchair_boarding to stops and trip_headsign to trips.
  // calendar_dates / fare / transfers tables are created by CREATE TABLE IF NOT
  // EXISTS already. Re-invalidate fetchedAt so the next bootstrap repopulates.
  if (current < 5) {
    await addColumnIfMissing(db, "stops", "wheelchair_boarding", "INTEGER");
    await addColumnIfMissing(db, "trips", "trip_headsign", "TEXT");
    await db.runAsync("DELETE FROM meta WHERE key = ?;", META_KEYS.fetchedAt);
  }

  // v5 -> v6: routes from every Prasarana bus category, not just the MRT
  // feeder. Each route records the category it came from; existing rows are
  // all feeder rows. Refetch so they're re-cut by the category-aware filter.
  if (current < 6) {
    await addColumnIfMissing(db, "routes", "category", "TEXT");
    await db.runAsync(
      "UPDATE routes SET category = 'rapid-bus-mrtfeeder' WHERE category IS NULL;",
    );
    await db.runAsync("DELETE FROM meta WHERE key = ?;", META_KEYS.fetchedAt);
  }

  // v6 -> v7: removing a route used to leave its stops behind. deleteRouteRows
  // now prunes them; this clears the ones left earlier. Nothing else changes,
  // so the cached bundle stays valid.
  if (current < 7) {
    await db.runAsync(
      "DELETE FROM stops WHERE NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.stop_id = stops.stop_id);",
    );
  }

  if (current < 8) {
    // v7 -> v8: network_blobs + feed_meta for the transit network, and
    // static_requests for the static-request limiter. The DDL
    // `IF NOT EXISTS` already created them and there is nothing to backfill;
    // the route bundle stays valid.
  }

  if (current < 9) {
    // v8 -> v9: rail_shapes for the map's rail layer. Created by the DDL;
    // the next network refresh fills it from the stored rail zip (it writes
    // whenever the table is empty), so there is nothing to do here.
  }
}

async function addColumnIfMissing(
  db: Db,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`,
  );
  if (cols.some((c) => c.name === column)) return;
  await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
}

export function resetDbForTests(): void {
  dbPromise = null;
}
