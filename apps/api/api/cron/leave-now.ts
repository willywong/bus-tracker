import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  LeaveNowService,
  type LeaveNowRunResult,
} from "../../src/leave-now-service.js";

// NOTE: This route is intentionally NOT scheduled in `vercel.json` — each
// invocation can trigger a HERE transaction, so we gate activation behind an
// external trigger (cron-job.org, GitHub Actions, or Vercel cron added later)
// rather than have it fire automatically. If you re-enable a Vercel schedule,
// pair it with a service-hours guard and expect roughly `(service_minutes) *
// (active_registrations)` HERE calls/day in the worst case.
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
