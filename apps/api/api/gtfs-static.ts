import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  GtfsBundleService,
  defaultService,
} from "../src/gtfs-service.js";

export const config = { runtime: "edge" };

export function createGtfsStaticApp(
  service: GtfsBundleService = defaultService,
): Hono {
  const app = new Hono();

  app.get("/api/gtfs-static", async (c) => {
    try {
      const { bundle, cached } = await service.getBundle();
      c.header(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=86400",
      );
      c.header("X-Cache", cached ? "HIT" : "MISS");
      const age = service.ageMs();
      if (age != null) c.header("X-Cache-Age-Ms", String(age));
      return c.json(bundle);
    } catch (err) {
      return c.json(
        { error: "upstream unavailable", detail: String(err) },
        503,
      );
    }
  });

  return app;
}

export default handle(createGtfsStaticApp());
