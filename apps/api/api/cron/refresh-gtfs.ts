import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  GtfsBundleService,
  defaultService,
} from "../../src/gtfs-service.js";

export const config = { runtime: "edge" };

export function createRefreshGtfsApp(
  service: GtfsBundleService = defaultService,
  secret: string | undefined = process.env.CRON_SECRET,
): Hono {
  const app = new Hono();

  app.get("/api/cron/refresh-gtfs", async (c) => {
    if (secret) {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${secret}`) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
    }
    try {
      const bundle = await service.refresh();
      return c.json({
        ok: true,
        refreshedAt: bundle.generatedAt,
        stops: bundle.stops.length,
        trips: bundle.trips.length,
        routes: bundle.routes.length,
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 502);
    }
  });

  return app;
}

export default handle(createRefreshGtfsApp());
