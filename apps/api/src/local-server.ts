import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRefreshGtfsApp } from "../api/cron/refresh-gtfs.js";
import { createGtfsStaticApp } from "../api/gtfs-static.js";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ ok: true, at: new Date().toISOString() }),
);

app.route("/", createGtfsStaticApp());
app.route("/", createRefreshGtfsApp());

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] ready on http://localhost:${info.port}`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/gtfs-static`);
  console.log(`  GET /api/cron/refresh-gtfs`);
});
