import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createTrafficEtaApp } from "../../api/traffic-eta.js";
import { createInMemoryKv, resetDefaultKvForTests } from "../kv.js";
import {
  MissingHereKeyError,
  MissingProviderKeyError,
  TrafficEtaService,
  UpstreamError,
  parseLatLngPair,
  parseTrafficProvider,
} from "../traffic-service.js";

beforeEach(() => {
  // The endpoint tests share a process-wide default KV singleton for rate
  // limiting — reset so the per-IP bucket doesn't carry across tests.
  resetDefaultKvForTests();
});

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
  // Explicit 15s TTL so the timing asserts are self-documenting even if the
  // default (60s) changes again later.
  const svc = new TrafficEtaService("KEY", fetchMock, () => nowMs, 15_000);

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

  nowMs += 20_000; // past 15s TTL
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
  assert.match(res1.headers.get("cache-control") ?? "", /max-age=30/);
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

test("parseTrafficProvider: defaults to here and validates values", () => {
  assert.equal(parseTrafficProvider(undefined), "here");
  assert.equal(parseTrafficProvider(""), "here");
  assert.equal(parseTrafficProvider("here"), "here");
  assert.equal(parseTrafficProvider("HERE"), "here");
  assert.equal(parseTrafficProvider("tomtom"), "tomtom");
  assert.equal(parseTrafficProvider("google"), null);
});

test("TrafficEtaService: tomtom provider parses travelTimeInSeconds", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        routes: [{ summary: { travelTimeInSeconds: 600 } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const svc = new TrafficEtaService({ tomtom: "TT" }, fetchMock, () => 1_000);
  const res = await svc.getEta({
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
    provider: "tomtom",
  });
  assert.equal(res.result.source, "tomtom");
  assert.equal(res.result.trafficMinutes, 10);
});

test("TrafficEtaService: missing tomtom key throws MissingProviderKeyError", async () => {
  const svc = new TrafficEtaService({ here: "H" });
  await assert.rejects(
    svc.getEta({
      originLat: 3.1,
      originLng: 101.6,
      destLat: 3.12,
      destLng: 101.62,
      provider: "tomtom",
    }),
    (err: unknown) =>
      err instanceof MissingProviderKeyError && err.provider === "tomtom",
  );
});

test("TrafficEtaService: cache separates providers", async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async (input) => {
    calls++;
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("hereapi.com")) return fakeResponse(300);
    return new Response(
      JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 600 } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const svc = new TrafficEtaService(
    { here: "H", tomtom: "T" },
    fetchMock,
    () => 1_000,
  );
  const q = {
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  };
  const here = await svc.getEta({ ...q, provider: "here" });
  const tomtom = await svc.getEta({ ...q, provider: "tomtom" });
  assert.equal(here.result.source, "here");
  assert.equal(tomtom.result.source, "tomtom");
  assert.equal(calls, 2);
});

test("traffic-eta endpoint: honours provider=tomtom query param", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    assert.ok(url.startsWith("https://api.tomtom.com/routing/"));
    return new Response(
      JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 480 } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const svc = new TrafficEtaService({ tomtom: "TT" }, fetchMock, () => 1_000);
  const app = createTrafficEtaApp(svc);
  const res = await app.fetch(
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62&provider=tomtom",
    ),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { trafficMinutes: number; source: string };
  assert.equal(body.source, "tomtom");
  assert.equal(body.trafficMinutes, 8);
});

test("traffic-eta endpoint: rejects unknown provider", async () => {
  const svc = new TrafficEtaService({ here: "H" });
  const app = createTrafficEtaApp(svc);
  const res = await app.fetch(
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62&provider=google",
    ),
  );
  assert.equal(res.status, 400);
});

test("TrafficEtaService: L2 KV cache is shared across service instances", async () => {
  // Simulates two separate serverless-function instances both backed by the
  // same Upstash Redis — the second one should serve from L2 without a fresh
  // HERE call.
  const kv = createInMemoryKv();
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls++;
    return fakeResponse(300);
  };
  const nowFn = () => 1_000;
  const svcA = new TrafficEtaService("KEY", fetchMock, nowFn, undefined, {
    kv,
    log: () => {},
  });
  const svcB = new TrafficEtaService("KEY", fetchMock, nowFn, undefined, {
    kv,
    log: () => {},
  });
  const q = {
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  };
  const a = await svcA.getEta(q);
  assert.equal(a.layer, "miss");
  assert.equal(calls, 1);

  const b = await svcB.getEta(q);
  assert.equal(b.cached, true);
  assert.equal(b.layer, "l2");
  assert.equal(calls, 1);
});

test("TrafficEtaService: falls back to upstream when KV read fails", async () => {
  const failingKv = {
    async get() {
      throw new Error("kv down");
    },
    async set() {
      throw new Error("kv down");
    },
  };
  const fetchMock: typeof fetch = async () => fakeResponse(240);
  const svc = new TrafficEtaService("KEY", fetchMock, () => 1_000, undefined, {
    kv: failingKv,
    log: () => {},
  });
  const res = await svc.getEta({
    originLat: 3.1,
    originLng: 101.6,
    destLat: 3.12,
    destLng: 101.62,
  });
  assert.equal(res.result.trafficMinutes, 4);
});

test("traffic-eta endpoint: rate limits per IP to 10 req/min", async () => {
  const fetchMock: typeof fetch = async () => fakeResponse(120);
  const svc = new TrafficEtaService("KEY", fetchMock, () => 1_000);
  const kv = createInMemoryKv();
  const app = createTrafficEtaApp({ service: svc, kv, now: () => 1_000 });
  const makeReq = () =>
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
      { headers: { "x-forwarded-for": "9.9.9.9" } },
    );

  for (let i = 0; i < 10; i++) {
    const res = await app.fetch(makeReq());
    assert.equal(res.status, 200, `req ${i + 1} should pass`);
  }
  const blocked = await app.fetch(makeReq());
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
});

test("traffic-eta endpoint: separate IPs get separate rate-limit buckets", async () => {
  const fetchMock: typeof fetch = async () => fakeResponse(120);
  const svc = new TrafficEtaService("KEY", fetchMock, () => 1_000);
  const kv = createInMemoryKv();
  const app = createTrafficEtaApp({ service: svc, kv, now: () => 1_000 });

  for (let i = 0; i < 10; i++) {
    const res = await app.fetch(
      new Request(
        "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
        { headers: { "x-forwarded-for": "1.1.1.1" } },
      ),
    );
    assert.equal(res.status, 200);
  }
  // Different IP should still have its full budget.
  const other = await app.fetch(
    new Request(
      "https://local/api/traffic-eta?origin=3.1,101.6&destination=3.12,101.62",
      { headers: { "x-forwarded-for": "2.2.2.2" } },
    ),
  );
  assert.equal(other.status, 200);
});
