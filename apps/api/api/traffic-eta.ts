import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  MissingHereKeyError,
  TrafficEtaService,
  UpstreamError,
  parseLatLngPair,
} from "../src/traffic-service.js";

export const config = { runtime: "edge" };

let defaultService: TrafficEtaService | null = null;

function getDefaultService(): TrafficEtaService {
  if (!defaultService) {
    defaultService = new TrafficEtaService(process.env.HERE_API_KEY);
  }
  return defaultService;
}

export function createTrafficEtaApp(service?: TrafficEtaService): Hono {
  const app = new Hono();

  app.get("/api/traffic-eta", async (c) => {
    const svc = service ?? getDefaultService();
    const origin = parseLatLngPair(c.req.query("origin"));
    const destination = parseLatLngPair(c.req.query("destination"));
    if (!origin || !destination) {
      return c.json(
        { error: "expected origin=lat,lng and destination=lat,lng" },
        400,
      );
    }
    try {
      const { result, cached } = await svc.getEta({
        originLat: origin[0],
        originLng: origin[1],
        destLat: destination[0],
        destLng: destination[1],
      });
      c.header("Cache-Control", "public, max-age=15");
      c.header("X-Cache", cached ? "HIT" : "MISS");
      return c.json(result);
    } catch (err) {
      if (err instanceof MissingHereKeyError) {
        return c.json({ error: "HERE_API_KEY not configured" }, 500);
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
