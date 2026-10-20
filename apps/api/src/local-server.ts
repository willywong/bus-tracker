import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLeaveNowApp } from "../api/cron/leave-now.js";
import { createRefreshGtfsApp } from "../api/cron/refresh-gtfs.js";
import { createGtfsRealtimeApp } from "../api/gtfs-realtime.js";
import { createGtfsStaticApp } from "../api/gtfs-static.js";
import { createPushRegisterApp } from "../api/push/register.js";
import { createRouteDetailApp } from "../api/route/[code].js";
import { createRoutesSearchApp } from "../api/routes/search.js";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ ok: true, at: new Date().toISOString() }),
);

app.route("/", createGtfsStaticApp());
app.route("/", createGtfsRealtimeApp());
app.route("/", createRoutesSearchApp());
app.route("/", createRouteDetailApp());
app.route("/", createRefreshGtfsApp());
app.route("/", createPushRegisterApp());
app.route("/", createLeaveNowApp());

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] ready on http://localhost:${info.port}`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/gtfs-static`);
  console.log(`  GET /api/gtfs-realtime`);
  console.log(`  GET /api/routes/search?q=<query>`);
  console.log(`  GET /api/route/:code`);
  console.log(`  GET /api/cron/refresh-gtfs`);
  console.log(`  GET /api/cron/leave-now`);
  console.log(`  POST /api/push/register`);
});
