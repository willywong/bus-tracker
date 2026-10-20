import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  LeaveNowService,
  type LeaveNowRunResult,
} from "../../src/leave-now-service.js";

// NOTE: This route is intentionally NOT scheduled in `vercel.json` — trigger
// it externally (cron-job.org, GitHub Actions, or a Vercel cron added later).
// It reads vehicle positions through the same KV-cached proxy as
// /api/gtfs-realtime, so it doesn't add to the upstream request budget.
export const config = { runtime: "edge" };

export function createLeaveNowApp(
  service: LeaveNowService = new LeaveNowService(),
  secret: string | undefined = process.env.CRON_SECRET,
): Hono {
  const app = new Hono();

  app.get("/api/cron/leave-now", async (c) => {
    if (secret) {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${secret}`) {
        return c.json({ ok: false, error: "unauthorized" }, 401);
      }
    }
    try {
      const result: LeaveNowRunResult = await service.runOnce();
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  return app;
}

export default handle(createLeaveNowApp());
