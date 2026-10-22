import { count, createTestDb } from "./nodeDb";

import assert from "node:assert/strict";
import { test } from "node:test";

import { migrate } from "../database";
import { loadBlob, loadFeeds, pruneBlobs, saveBlob, saveFeed, touchFeed, type StoredFeed } from "../networkStore";
import { DDL, META_KEYS } from "../schema";

function columns(db: ReturnType<typeof createTestDb>, table: string): string[] {
  return (db.raw.prepare(`PRAGMA table_info(${table});`).all() as Array<{ name: string }>).map((c) => c.name);
}

test("migrates a v7 database to v8 and creates network_blobs/feed_meta", async () => {
  const db = createTestDb();
  db.raw.exec("DROP TABLE network_blobs; DROP TABLE feed_meta;");
  db.raw.exec(`INSERT OR REPLACE INTO meta(key, value) VALUES ('${META_KEYS.schemaVersion}', '7');`);
  db.raw.exec(`INSERT OR REPLACE INTO meta(key, value) VALUES ('${META_KEYS.fetchedAt}', '123');`);
  // As openDb does: DDL, then migrate.
  await db.execAsync(DDL.join("\n"));
  await migrate(db);
  assert.deepEqual(columns(db, "network_blobs"), ["service_date", "version", "built_at", "data"]);
  assert.deepEqual(columns(db, "feed_meta"), [
    "feed_id",
    "hash",
    "fetched_at",
    "valid_from",
    "valid_until",
    "zip",
  ]);
  // The route bundle stays valid.
  const row = db.raw.prepare("SELECT value FROM meta WHERE key = ?;").get(META_KEYS.fetchedAt) as { value: string };
  assert.equal(row.value, "123");
});

test("saveBlob replaces atomically and loadBlob returns identical bytes", async () => {
  const db = createTestDb();
  assert.equal(await loadBlob(db, "20261023"), null);
  await saveBlob(db, "20261023", 1, 1000, new Uint8Array([1, 2, 3]));
  const next = new Uint8Array(1024).map((_, i) => i % 251);
  await saveBlob(db, "20261023", 1, 2000, next);
  assert.equal(count(db, "network_blobs"), 1);
  const got = await loadBlob(db, "20261023");
  assert.ok(got);
  assert.equal(got.version, 1);
  assert.equal(got.builtAt, 2000);
  assert.ok(got.data instanceof Uint8Array);
  assert.deepEqual(Array.from(got.data), Array.from(next));
});

test("pruneBlobs keeps only the given dates", async () => {
  const db = createTestDb();
  for (const d of ["20261021", "20261022", "20261023", "20261024"]) {
    await saveBlob(db, d, 1, 1, new Uint8Array([1]));
  }
  await pruneBlobs(db, ["20261023", "20261024"]);
  const dates = (db.raw.prepare("SELECT service_date FROM network_blobs ORDER BY service_date;").all() as Array<{
    service_date: string;
  }>).map((r) => r.service_date);
  assert.deepEqual(dates, ["20261023", "20261024"]);
  await pruneBlobs(db, []);
  assert.equal(count(db, "network_blobs"), 0);
});

test("feeds round-trip, and touchFeed only bumps fetched_at", async () => {
  const db = createTestDb();
  const rail: StoredFeed = {
    feed: "rail",
    hash: "abc",
    fetchedAt: 10,
    validFrom: "20260101",
    validUntil: "20261231",
    zip: new Uint8Array([9, 8, 7]),
  };
  await saveFeed(db, rail);
  await saveFeed(db, { ...rail, feed: "ktm", hash: "k" });
  await touchFeed(db, "rail", 99);
  const feeds = await loadFeeds(db);
  assert.deepEqual(Object.keys(feeds).sort(), ["ktm", "rail"]);
  assert.equal(feeds.rail?.fetchedAt, 99);
  assert.equal(feeds.rail?.hash, "abc");
  assert.equal(feeds.rail?.validUntil, "20261231");
  assert.deepEqual(Array.from(feeds.rail?.zip ?? []), [9, 8, 7]);
  assert.equal(feeds.ktm?.hash, "k");
});
