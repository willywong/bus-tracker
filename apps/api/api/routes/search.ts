import { searchRoutes } from "@bus-tracker/shared";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  GtfsBundleService,
  defaultService,
} from "../../src/gtfs-service.js";

export const config = { runtime: "edge" };

export function createRoutesSearchApp(
  service: GtfsBundleService = defaultService,
): Hono {
  const app = new Hono();

  app.get("/api/routes/search", async (c) => {
    const qRaw = c.req.query("q");
    if (!qRaw) return c.text("q required", 400);
    const q = qRaw.trim().slice(0, 32);
    if (q.length === 0) return c.text("q required", 400);

    try {
      const { parsed } = await service.getParsed();
      const hits = searchRoutes(parsed, q, 25);
      c.header(
        "Cache-Control",
        "public, max-age=300, stale-while-revalidate=86400",
      );
      return c.json(hits);
    } catch (err) {
      return c.json(
        { error: "upstream unavailable", detail: String(err) },
        503,
      );
    }
  });

  return app;
}

export default handle(createRoutesSearchApp());
