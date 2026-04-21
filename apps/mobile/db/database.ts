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
}

export function resetDbForTests(): void {
  dbPromise = null;
}
