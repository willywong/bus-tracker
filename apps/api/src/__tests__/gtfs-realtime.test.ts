import assert from "node:assert/strict";
import test from "node:test";
import { createGtfsRealtimeApp } from "../../api/gtfs-realtime.js";
import {
  GtfsRealtimeService,
  GtfsRealtimeUpstreamError,
} from "../gtfs-realtime-service.js";
import { createInMemoryKv } from "../kv.js";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function readBody(res: Response): Promise<Uint8Array> {
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

test("GtfsRealtimeService: cache miss fetches upstream and stores bytes", async () => {
  const kv = createInMemoryKv();
  let upstreamCalls = 0;
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      upstreamCalls++;
      return bytes("feed-v1");
    },
    now: () => nowMs,
  });

  const first = await svc.getFeed();
  assert.equal(first.outcome, "MISS");
  assert.deepEqual(first.bytes, bytes("feed-v1"));
  assert.equal(upstreamCalls, 1);
});

test("GtfsRealtimeService: second request within TTL is HIT, no upstream call", async () => {
  const kv = createInMemoryKv();
  let upstreamCalls = 0;
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      upstreamCalls++;
      return bytes("feed-v1");
    },
    now: () => nowMs,
  });

  await svc.getFeed();
  nowMs += 15_000; // still within 30s TTL
  const hit = await svc.getFeed();
  assert.equal(hit.outcome, "HIT");
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(hit.bytes, bytes("feed-v1"));
});

test("GtfsRealtimeService: request past TTL refetches upstream", async () => {
  const kv = createInMemoryKv();
  let upstreamCalls = 0;
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      upstreamCalls++;
      return bytes(`feed-${upstreamCalls}`);
    },
    now: () => nowMs,
  });

  await svc.getFeed();
  nowMs += 31_000;
  const second = await svc.getFeed();
  assert.equal(second.outcome, "MISS");
  assert.equal(upstreamCalls, 2);
  assert.deepEqual(second.bytes, bytes("feed-2"));
});

test("GtfsRealtimeService: upstream failure within grace serves STALE", async () => {
  const kv = createInMemoryKv();
  let callIdx = 0;
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      callIdx++;
      if (callIdx === 1) return bytes("feed-v1");
      throw new GtfsRealtimeUpstreamError("upstream 503");
    },
    now: () => nowMs,
  });

  await svc.getFeed(); // seed cache
  nowMs += 45_000; // past fresh TTL, within stale grace
  const stale = await svc.getFeed();
  assert.equal(stale.outcome, "STALE");
  assert.deepEqual(stale.bytes, bytes("feed-v1"));
});

test("GtfsRealtimeService: upstream failure beyond grace throws", async () => {
  const kv = createInMemoryKv();
  let callIdx = 0;
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      callIdx++;
      if (callIdx === 1) return bytes("feed-v1");
      throw new GtfsRealtimeUpstreamError("upstream 503");
    },
    now: () => nowMs,
  });

  await svc.getFeed();
  nowMs += 3 * 60_000; // past stale grace
  await assert.rejects(
    () => svc.getFeed(),
    (err) => err instanceof GtfsRealtimeUpstreamError,
  );
});

test("endpoint: serves protobuf bytes with cache headers on MISS", async () => {
  const kv = createInMemoryKv();
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => bytes("hello-proto"),
    now: () => nowMs,
  });
  const app = createGtfsRealtimeApp({ kv, service: svc, now: () => nowMs });

  const res = await app.request("/api/gtfs-realtime");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Cache"), "MISS");
  assert.equal(res.headers.get("Content-Type"), "application/x-protobuf");
  assert.match(res.headers.get("Cache-Control") ?? "", /max-age=30/);
  const body = await readBody(res);
  assert.deepEqual(body, bytes("hello-proto"));
});

test("endpoint: rate limits after 10 requests from the same IP", async () => {
  const kv = createInMemoryKv();
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => bytes("x"),
    now: () => nowMs,
  });
  const app = createGtfsRealtimeApp({ kv, service: svc, now: () => nowMs });

  const headers = { "x-forwarded-for": "203.0.113.5" };
  for (let i = 0; i < 10; i++) {
    const r = await app.request("/api/gtfs-realtime", { headers });
    assert.equal(r.status, 200, `request ${i + 1} should succeed`);
  }
  const limited = await app.request("/api/gtfs-realtime", { headers });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("Retry-After"));
});

test("endpoint: returns 502 when upstream fails with no cache", async () => {
  const kv = createInMemoryKv();
  let nowMs = 1_000;
  const svc = new GtfsRealtimeService({
    kv,
    fetchUpstream: async () => {
      throw new GtfsRealtimeUpstreamError("upstream 500");
    },
    now: () => nowMs,
  });
  const app = createGtfsRealtimeApp({ kv, service: svc, now: () => nowMs });

  const res = await app.request("/api/gtfs-realtime");
  assert.equal(res.status, 502);
});
