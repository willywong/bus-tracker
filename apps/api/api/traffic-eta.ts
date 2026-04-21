import { Hono } from "hono";
import { handle } from "hono/vercel";
import { defaultKv, type Kv } from "../src/kv.js";
import {
  checkRateLimit,
  RATE_LIMIT_MAX_PER_MINUTE,
} from "../src/rate-limit.js";
import {
  MissingProviderKeyError,
  TrafficEtaService,
  UpstreamError,
  parseLatLngPair,
  parseTrafficProvider,
} from "../src/traffic-service.js";

export const config = { runtime: "edge" };

let defaultService: TrafficEtaService | null = null;

function getDefaultService(): TrafficEtaService {
  if (!defaultService) {
    defaultService = new TrafficEtaService(
      {
        here: process.env.HERE_API_KEY,
        tomtom: process.env.TOMTOM_API_KEY,
      },
      fetch,
      Date.now,
      undefined,
      { kv: defaultKv() },
    );
  }
  return defaultService;
}

export interface TrafficEtaAppOptions {
  service?: TrafficEtaService;
  kv?: Kv;
  now?: () => number;
}

export function createTrafficEtaApp(
  serviceOrOptions?: TrafficEtaService | TrafficEtaAppOptions,
): Hono {
  const app = new Hono();
  const opts: TrafficEtaAppOptions =
    serviceOrOptions instanceof TrafficEtaService
      ? { service: serviceOrOptions }
      : serviceOrOptions ?? {};
  const rateKv = opts.kv ?? defaultKv();
  const now = opts.now ?? Date.now;

  app.get("/api/traffic-eta", async (c) => {
    const svc = opts.service ?? getDefaultService();
    const origin = parseLatLngPair(c.req.query("origin"));
    const destination = parseLatLngPair(c.req.query("destination"));
    const provider = parseTrafficProvider(c.req.query("provider"));
    if (!origin || !destination) {
      return c.json(
        { error: "expected origin=lat,lng and destination=lat,lng" },
        400,
      );
    }
    if (!provider) {
      return c.json({ error: "provider must be 'here' or 'tomtom'" }, 400);
    }

    // Upstream `x-forwarded-for` is "client, proxy1, proxy2..." — take the
    // leftmost entry as the client IP. Fall back to a fixed bucket so bad/
    // missing headers still get limited (prevents bypass via header stripping).
    const fwd = c.req.header("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0]?.trim() || "unknown";
    const rl = await checkRateLimit(rateKv, `traffic-eta:${ip}`, now());
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json(
        {
          error: `rate limit exceeded (${RATE_LIMIT_MAX_PER_MINUTE}/min per IP)`,
        },
        429,
      );
    }

    try {
      const { result, cached, layer } = await svc.getEta({
        originLat: origin[0],
        originLng: origin[1],
        destLat: destination[0],
        destLng: destination[1],
        provider,
      });
      // max-age=30 aligns with the mobile hook's 30s refresh floor so any
      // intermediate CDN/proxy cache collapses duplicate requests.
      c.header("Cache-Control", "public, max-age=30");
      c.header("X-Cache", cached ? "HIT" : "MISS");
      c.header("X-Cache-Layer", layer);
      return c.json(result);
    } catch (err) {
      if (err instanceof MissingProviderKeyError) {
        return c.json({ error: err.message }, 500);
      }
      if (err instanceof UpstreamError) {
        return c.json({ error: err.message }, 502);
      }
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}

export default handle(createTrafficEtaApp());
