import { filterToRoutes } from "@bus-tracker/shared";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  GtfsBundleService,
  defaultService,
  withTrafficSignals,
} from "../../src/gtfs-service.js";

export const config = { runtime: "edge" };

export function createRouteDetailApp(
  service: GtfsBundleService = defaultService,
): Hono {
  const app = new Hono();

  app.get("/api/route/:code", async (c) => {
    const raw = c.req.param("code");
    const code = String(raw ?? "").trim().toUpperCase();
    if (!code || code.length > 16) return c.text("invalid code", 400);

    try {
      const { parsed } = await service.getParsed();
      const bundle = withTrafficSignals(filterToRoutes(parsed, [code]));
      if (bundle.routes.length === 0) return c.text("not found", 404);

      if (bundle.trafficSignals) {
        const signalsForRoute = bundle.trafficSignals[code];
        bundle.trafficSignals = signalsForRoute
          ? { [code]: signalsForRoute }
          : {};
      }

      c.header(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=86400",
      );
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

export default handle(createRouteDetailApp());
