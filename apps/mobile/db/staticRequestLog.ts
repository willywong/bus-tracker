import type { StaticRequestLog } from "@/services/gtfsFeed";
import { openDb, type Db } from "./database";

/**
 * The static-request limiter's grants, kept in SQLite (`static_requests`) so
 * a relaunch within the minute, or a second JS runtime in the same process,
 * still counts the requests already sent.
 */
export function sqliteStaticRequestLog(getDb: () => Promise<Db> = openDb): StaticRequestLog {
  return {
    async claim(at, windowMs, limit) {
      const db = await getDb();
      // Out of the window either way (the far side only after a clock change).
      await db.runAsync("DELETE FROM static_requests WHERE at <= ? OR at > ?;", at - windowMs, at + windowMs);
      // Count and insert in one statement: SQLite runs it as one write
      // transaction, so two connections can't both take the last slot.
      const res = await db.runAsync(
        `INSERT INTO static_requests(at)
         SELECT ? WHERE (SELECT COUNT(*) FROM static_requests WHERE at > ? AND at <= ?) < ?;`,
        at,
        at - windowMs,
        at,
        limit,
      );
      return res.changes > 0;
    },
    async between(since, until) {
      const db = await getDb();
      const rows = await db.getAllAsync<{ at: number }>(
        "SELECT at FROM static_requests WHERE at > ? AND at <= ? ORDER BY at;",
        since,
        until,
      );
      return rows.map((r) => r.at);
    },
  };
}
