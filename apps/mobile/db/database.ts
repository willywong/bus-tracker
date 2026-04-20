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

export function resetDbForTests(): void {
  dbPromise = null;
}
