import assert from "node:assert/strict";
import test from "node:test";
import { createTrafficEtaApp } from "../../api/traffic-eta.js";
import {
  MissingHereKeyError,
  TrafficEtaService,
  UpstreamError,
  parseLatLngPair,
} from "../traffic-service.js";

interface HereFake {
  sections: Array<{ summary: { duration: number } }>;
}

function fakeResponse(seconds: number): Response {
  const body: { routes: HereFake[] } = {
    routes: [{ sections: [{ summary: { duration: seconds } }] }],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("parseLatLngPair: rejects malformed and out-of-range input", () => {
  assert.equal(parseLatLngPair(undefined), null);
  assert.equal(parseLatLngPair("nope"), null);
  assert.equal(parseLatLngPair("3.1"), null);
  assert.equal(parseLatLngPair("91,0"), null);
  assert.equal(parseLatLngPair("0,181"), null);
  assert.deepEqual(parseLatLngPair("3.1,101.6"), [3.1, 101.6]);
});

test("TrafficEtaService: converts HERE seconds to minutes and caches within TTL", async () => {
  let calls = 0;
  let nowMs = 1_000;
  const fetchMock: typeof fetch = async () => {
    calls++;
    return fakeResponse(420); // 7 min
  };
  const svc = new TrafficEtaService("KEY", fetchMock, () => nowMs);

  const first = await svc.getEta({
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  });
  assert.equal(first.cached, false);
  assert.equal(first.result.source, "here");
  assert.equal(first.result.trafficMinutes, 7);
  assert.equal(first.result.generatedAt, 1_000);
  assert.equal(calls, 1);

  nowMs += 10_000; // within 15s TTL
  const second = await svc.getEta({
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);

  nowMs += 20_000; // past TTL
  const third = await svc.getEta({
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  });
  assert.equal(third.cached, false);
  assert.equal(calls, 2);
});

test("TrafficEtaService: different coordinates use separate cache keys", async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls++;
    return fakeResponse(300);
  };
  const svc = new TrafficEtaService("KEY", fetchMock, () => 1_000);

  await svc.getEta({ originLat: 3.1, originLng: 101.6, destLat: 3.12, destLng: 101.62 });
  await svc.getEta({ originLat: 3.1, originLng: 101.6, destLat: 3.13, destLng: 101.62 });
  assert.equal(calls, 2);
});

test("TrafficEtaService: throws MissingHereKeyError when no key", async () => {
  const svc = new TrafficEtaService(undefined);
  await assert.rejects(
    svc.getEta({ originLat: 3.1, originLng: 101.6, destLat: 3.12, destLng: 101.62 }),
    MissingHereKeyError,
  );
});

test("TrafficEtaService: wraps upstream non-200 as UpstreamError", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response("nope", { status: 503 });
  const svc = new TrafficEtaService("KEY", fetchMock);
  await assert.rejects(
    svc.getEta({ originLat: 3.1, originLng: 101.6, destLat: 3.12, destLng: 101.62 }),
    (err: unknown) =>
      err instanceof UpstreamError && err.status === 503,
  );
});

test("TrafficEtaService: surfaces missing summary as UpstreamError", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ routes: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const svc = new TrafficEtaService("KEY", fetchMock);
  await assert.rejects(
    svc.getEta({ originLat: 3.1, originLng: 101.6, destLat: 3.12, destLng: 101.62 }),
    UpstreamError,
  );
});

test("traffic-eta endpoint: 400 on invalid origin/destination", async () => {
  const svc = new TrafficEtaService("KEY", async () => fakeResponse(120));
  const app = createTrafficEtaApp(svc);
  const res = await app.fetch(new Request("https://local/api/traffic-eta"));
  assert.equal(res.status, 400);
});

test("traffic-eta endpoint: 200 with cache headers, HIT on second call", async () => {
  let calls = 0;
  const svc = new TrafficEtaService(
    "KEY",
    async () => {
      calls++;
      return fakeResponse(180);
    },
    () => 1_000,
  );
  const app = createTrafficEtaApp(svc);

  const req = new Request(
    "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
  );
  const res1 = await app.fetch(req);
  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("x-cache"), "MISS");
  assert.match(res1.headers.get("cache-control") ?? "", /max-age=15/);
  const body = (await res1.json()) as { trafficMinutes: number; source: string };
  assert.equal(body.trafficMinutes, 3);
  assert.equal(body.source, "here");

  const res2 = await app.fetch(req);
  assert.equal(res2.status, 200);
  assert.equal(res2.headers.get("x-cache"), "HIT");
  assert.equal(calls, 1);
});

test("traffic-eta endpoint: 502 on upstream failure", async () => {
  const svc = new TrafficEtaService(
    "KEY",
    async () => new Response("err", { status: 500 }),
  );
  const app = createTrafficEtaApp(svc);
  const res = await app.fetch(
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
    ),
  );
  assert.equal(res.status, 502);
});

test("traffic-eta endpoint: 500 when HERE_API_KEY missing", async () => {
  const svc = new TrafficEtaService(undefined);
  const app = createTrafficEtaApp(svc);
  const res = await app.fetch(
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
    ),
  );
  assert.equal(res.status, 500);
});
