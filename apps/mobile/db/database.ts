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

async function migrate(db: Db): Promise<void> {
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
