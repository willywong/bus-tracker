import { FEED_IDS, type FeedId } from "@bus-tracker/shared";
import type { Db } from "./database";

/** One network feed's last download (`feed_meta`). */
export interface StoredFeed {
  feed: FeedId;
  /** The response ETag, else `fnv1a32Hex` of the zip. */
  hash: string;
  fetchedAt: number;
  /** 'YYYYMMDD' service range from `readFeedSteps`. */
  validFrom: string;
  validUntil: string;
  zip: Uint8Array;
}

/** A compiled network as stored (`network_blobs`); `data` is `encodeNetwork` output. */
export interface StoredBlob {
  version: number;
  builtAt: number;
  data: Uint8Array;
}

interface FeedRow {
  feed_id: string;
  hash: string;
  fetched_at: number;
  valid_from: string;
  valid_until: string;
  zip: Uint8Array;
}

function isFeedId(id: string): id is FeedId {
  return (FEED_IDS as readonly string[]).includes(id);
}

/**
 * A private copy of a BLOB column. `decodeNetwork` keeps zero-copy views over
 * its input, so it must not share a buffer the driver may reuse.
 */
function own(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export async function loadFeeds(db: Db): Promise<Partial<Record<FeedId, StoredFeed>>> {
  const rows = await db.getAllAsync<FeedRow>(
    "SELECT feed_id, hash, fetched_at, valid_from, valid_until, zip FROM feed_meta;",
  );
  const out: Partial<Record<FeedId, StoredFeed>> = {};
  for (const r of rows) {
    if (!isFeedId(r.feed_id)) continue;
    out[r.feed_id] = {
      feed: r.feed_id,
      hash: r.hash,
      fetchedAt: Number(r.fetched_at),
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      zip: own(r.zip),
    };
  }
  return out;
}

export async function saveFeed(db: Db, f: StoredFeed): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO feed_meta(feed_id, hash, fetched_at, valid_from, valid_until, zip)
       VALUES (?, ?, ?, ?, ?, ?);`,
    f.feed,
    f.hash,
    f.fetchedAt,
    f.validFrom,
    f.validUntil,
    f.zip,
  );
}

/** Records a re-download that turned out unchanged: only `fetched_at` moves. */
export async function touchFeed(db: Db, feed: FeedId, fetchedAt: number): Promise<void> {
  await db.runAsync("UPDATE feed_meta SET fetched_at = ? WHERE feed_id = ?;", fetchedAt, feed);
}

export async function loadBlob(db: Db, serviceDate: string): Promise<StoredBlob | null> {
  const row = await db.getFirstAsync<{ version: number; built_at: number; data: Uint8Array }>(
    "SELECT version, built_at, data FROM network_blobs WHERE service_date = ?;",
    serviceDate,
  );
  if (!row) return null;
  return { version: Number(row.version), builtAt: Number(row.built_at), data: own(row.data) };
}

/**
 * Stores a finished build. One `INSERT OR REPLACE`, so readers see either the
 * previous blob or this one, never neither.
 */
export async function saveBlob(
  db: Db,
  serviceDate: string,
  version: number,
  builtAt: number,
  data: Uint8Array,
): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO network_blobs(service_date, version, built_at, data) VALUES (?, ?, ?, ?);",
    serviceDate,
    version,
    builtAt,
    data,
  );
}

/** Drops every blob except the `keep` service dates. */
export async function pruneBlobs(db: Db, keep: readonly string[]): Promise<void> {
  if (keep.length === 0) {
    await db.runAsync("DELETE FROM network_blobs;");
    return;
  }
  await db.runAsync(
    `DELETE FROM network_blobs WHERE service_date NOT IN (${keep.map(() => "?").join(", ")});`,
    ...keep,
  );
}
