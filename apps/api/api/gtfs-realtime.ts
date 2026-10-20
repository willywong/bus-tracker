import { Hono } from "hono";
import { handle } from "hono/vercel";
import { defaultKv, type Kv } from "../src/kv.js";
import {
  GtfsRealtimeService,
  GtfsRealtimeUpstreamError,
} from "../src/gtfs-realtime-service.js";
import {
  checkRateLimit,
  RATE_LIMIT_MAX_PER_MINUTE,
} from "../src/rate-limit.js";

export const config = { runtime: "edge" };

let defaultServiceInstance: GtfsRealtimeService | null = null;

function getDefaultService(kv: Kv): GtfsRealtimeService {
  if (!defaultServiceInstance) {
    defaultServiceInstance = new GtfsRealtimeService({ kv });
  }
  return defaultServiceInstance;
}

export interface GtfsRealtimeAppOptions {
  service?: GtfsRealtimeService;
  kv?: Kv;
  now?: () => number;
}

export function createGtfsRealtimeApp(
  options: GtfsRealtimeAppOptions = {},
): Hono {
  const app = new Hono();
  const rateKv = options.kv ?? defaultKv();
  const now = options.now ?? Date.now;

  app.get("/api/gtfs-realtime", async (c) => {
    const svc = options.service ?? getDefaultService(rateKv);

    // Abuse cap — normal clients only do 2 req/min.
    const fwd = c.req.header("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0]?.trim() || "unknown";
    const rl = await checkRateLimit(rateKv, `gtfs-rt:${ip}`, now());
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
      const { bytes, outcome, ageMs } = await svc.getFeed();
      // Copy into a plain ArrayBuffer so TS is happy with BodyInit and we
      // avoid any ambiguity with SharedArrayBuffer-backed views.
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/x-protobuf",
          "Cache-Control": "public, max-age=30, s-maxage=30",
          "X-Cache": outcome,
          "X-Cache-Age-Ms": String(ageMs),
        },
      });
    } catch (err) {
      if (err instanceof GtfsRealtimeUpstreamError) {
        return c.json({ error: err.message }, 502);
      }
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}

export default handle(createGtfsRealtimeApp());
