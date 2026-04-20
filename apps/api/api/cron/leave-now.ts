import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  LeaveNowService,
  type LeaveNowRunResult,
} from "../../src/leave-now-service.js";

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
