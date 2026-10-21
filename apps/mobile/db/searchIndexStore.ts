import type { BusCategory } from "@bus-tracker/shared";
import type { SearchIndexStore } from "@/services/gtfsFeed";
import { openDb } from "./database";

const key = (category: BusCategory) => `searchIndex:${category}`;

/**
 * Route search indexes saved in the meta table, one JSON row per feed
 * (50–350 KB each), so a search after relaunch answers without downloading
 * or reading a feed zip.
 */
export const sqliteSearchIndexStore: SearchIndexStore = {
  async load(category) {
    const db = await openDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?;",
      key(category),
    );
    if (!row) return null;
    const saved = JSON.parse(row.value) as { fetchedAt?: unknown; data?: unknown };
    return typeof saved.fetchedAt === "number" ? { fetchedAt: saved.fetchedAt, data: saved.data } : null;
  },
  async save(category, fetchedAt, data) {
    const db = await openDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?);",
      key(category),
      JSON.stringify({ fetchedAt, data }),
    );
  },
};
