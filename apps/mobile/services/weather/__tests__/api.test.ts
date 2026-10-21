import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { WARNINGS_URL, createWeatherClient, forecastUrl, type WeatherClient } from "../api";
import { getRainNudge } from "../index";
import type { ForecastRow, WarningRow } from "../types";

// Real payloads (see nudge.test.ts for provenance).
const allForecast = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "forecast-klang-valley-2026-10-20.json"), "utf8"),
) as ForecastRow[];
const warnings = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "warning-2026-10-20T1646.json"), "utf8"),
) as WarningRow[];

interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(responder: (url: string) => FakeResponse | Promise<FakeResponse>) {
  const calls: string[] = [];
  const impl = async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const r = await responder(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      json: async () => r.body,
    };
  };
  return { impl, calls };
}

/** Serves the fixture rows the way `contains=<id>@location__location_id` does. */
function serveFixtures(url: string): FakeResponse {
  if (url === WARNINGS_URL) return { status: 200, body: warnings };
  const id = new URL(url).searchParams.get("contains")?.split("@")[0];
  return { status: 200, body: allForecast.filter((r) => r.location.location_id === id) };
}

describe("URLs", () => {
  test("narrow forecast query and trailing slashes", () => {
    assert.equal(
      forecastUrl("Ds057"),
      "https://api.data.gov.my/weather/forecast/?contains=Ds057%40location__location_id",
    );
    assert.equal(WARNINGS_URL, "https://api.data.gov.my/weather/warning/");
  });
});

describe("createWeatherClient", () => {
  test("caches for 30 minutes, then refetches", async () => {
    let t = 0;
    const f = fakeFetch(serveFixtures);
    const c = createWeatherClient({ fetchImpl: f.impl, now: () => t });
    const rows = await c.fetchForecast("Ds057");
    assert.equal(rows?.length, 7);
    t = 29 * 60_000;
    await c.fetchForecast("Ds057");
    assert.equal(f.calls.length, 1);
    t = 31 * 60_000;
    await c.fetchForecast("Ds057");
    assert.equal(f.calls.length, 2);
  });

  test("429 returns stale cache, backs off and never throws", async () => {
    let t = 0;
    let mode: "ok" | "429" = "ok";
    const f = fakeFetch((url) =>
      mode === "ok" ? serveFixtures(url) : { status: 429, body: { status: 429, errors: ["Too Many Requests"] } },
    );
    const c = createWeatherClient({ fetchImpl: f.impl, now: () => t });
    const first = await c.fetchWarnings();
    assert.equal(first?.length, 4);

    t = 31 * 60_000;
    mode = "429";
    const stale = await c.fetchWarnings();
    assert.deepEqual(stale, first);
    assert.equal(f.calls.length, 2);

    // Within the 60 s back-off there are no requests, even for other URLs.
    t += 30_000;
    assert.equal(await c.fetchForecast("Ds058"), null);
    assert.equal(f.calls.length, 2);

    t += 31_000;
    mode = "ok";
    assert.equal((await c.fetchForecast("Ds058"))?.length, 7);
    assert.equal(f.calls.length, 3);
  });

  test("Retry-After header is honoured", async () => {
    let t = 0;
    const f = fakeFetch(() => ({ status: 429, headers: { "retry-after": "120" } }));
    const c = createWeatherClient({ fetchImpl: f.impl, now: () => t });
    assert.equal(await c.fetchWarnings(), null);
    t = 90_000;
    await c.fetchWarnings();
    assert.equal(f.calls.length, 1);
    t = 121_000;
    await c.fetchWarnings();
    assert.equal(f.calls.length, 2);
  });

  test("network errors, error bodies and bad rows give null or are dropped", async () => {
    const throwing = createWeatherClient({
      fetchImpl: async () => {
        throw new TypeError("Network request failed");
      },
    });
    assert.equal(await throwing.fetchWarnings(), null);

    const errBody = createWeatherClient({ fetchImpl: fakeFetch(() => ({ status: 400, body: { status: 400, errors: ["bad"] } })).impl });
    assert.equal(await errBody.fetchForecast("Ds057"), null);

    const notArray = createWeatherClient({ fetchImpl: fakeFetch(() => ({ status: 200, body: { data: [] } })).impl });
    assert.equal(await notArray.fetchForecast("Ds057"), null);

    const mixed = createWeatherClient({
      fetchImpl: fakeFetch(() => ({ status: 200, body: [allForecast[0], { nope: 1 }, null] })).impl,
    });
    assert.equal((await mixed.fetchForecast("Ds057"))?.length, 1);
  });

  test("abort returns null without caching", async () => {
    const f = fakeFetch(serveFixtures);
    const c = createWeatherClient({ fetchImpl: f.impl });
    const ac = new AbortController();
    ac.abort();
    assert.equal(await c.fetchWarnings(ac.signal), null);
    assert.equal(f.calls.length, 0);
  });

  test("concurrent calls share one request; invalid ids are rejected", async () => {
    const f = fakeFetch(serveFixtures);
    const c = createWeatherClient({ fetchImpl: f.impl });
    const [a, b] = await Promise.all([c.fetchForecast("Ds057"), c.fetchForecast("Ds057")]);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(a, b);
    assert.equal(await c.fetchForecast("Ds057@x,St008"), null);
    assert.equal(f.calls.length, 1);
  });
});

describe("getRainNudge facade", () => {
  const at1646 = Date.parse("2026-10-20T16:46:00+08:00");

  test("Petaling Jaya stop gets the real thunderstorm warning", async () => {
    const f = fakeFetch(serveFixtures);
    const client = createWeatherClient({ fetchImpl: f.impl });
    const nudge = await getRainNudge({ lat: 3.1073, lng: 101.6067, now: at1646, client });
    assert.equal(nudge?.title, "Thunderstorm warning");
    assert.equal(nudge?.message, "In effect for Petaling until 18:00. Leave a few minutes early.");
    assert.deepEqual([...f.calls].sort(), [forecastUrl("Ds057"), WARNINGS_URL].sort());
  });

  test("Klang stop falls back to the forecast", async () => {
    const client = createWeatherClient({ fetchImpl: fakeFetch(serveFixtures).impl });
    const nudge = await getRainNudge({ lat: 3.0449, lng: 101.4456, now: at1646, client });
    assert.equal(nudge?.kind, "forecast");
    assert.equal(nudge?.title, "Thunderstorms likely this afternoon");
  });

  test("an empty district result falls back to the state id", async () => {
    const f = fakeFetch((url) => (url === forecastUrl("Ds054") ? { status: 200, body: [] } : serveFixtures(url)));
    const client = createWeatherClient({ fetchImpl: f.impl });
    const nudge = await getRainNudge({ lat: 3.0449, lng: 101.4456, now: at1646, client });
    assert.ok(f.calls.includes(forecastUrl("St008")));
    assert.equal(nudge?.message, "Expected in parts of Selangor, mostly inland. Leave a few minutes early.");
  });

  test("outside the Klang Valley: null and no requests", async () => {
    const f = fakeFetch(serveFixtures);
    const client = createWeatherClient({ fetchImpl: f.impl });
    assert.equal(await getRainNudge({ lat: 5.4141, lng: 100.3288, now: at1646, client }), null);
    assert.equal(f.calls.length, 0);
  });

  test("never throws, even if the client does", async () => {
    const broken: WeatherClient = {
      fetchForecast: async () => {
        throw new Error("boom");
      },
      fetchWarnings: async () => {
        throw new Error("boom");
      },
      clear: () => {},
    };
    assert.equal(await getRainNudge({ lat: 3.1073, lng: 101.6067, now: at1646, client: broken }), null);
  });

  test("all requests rate-limited -> null", async () => {
    const client = createWeatherClient({ fetchImpl: fakeFetch(() => ({ status: 429 })).impl });
    assert.equal(await getRainNudge({ lat: 3.1073, lng: 101.6067, now: at1646, client }), null);
  });
});
