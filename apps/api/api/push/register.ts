import { Hono } from "hono";
import { handle } from "hono/vercel";
import type { Kv } from "../../src/kv.js";
import {
  InvalidPayloadError,
  parseRegisterBody,
  savePushRegistration,
} from "../../src/push-service.js";

export const config = { runtime: "edge" };

export function createPushRegisterApp(kv?: Kv): Hono {
  const app = new Hono();

  app.post("/api/push/register", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }

    try {
      const registration = parseRegisterBody(body);
      await savePushRegistration(registration, kv);
      return c.json({
        ok: true,
        deviceId: registration.deviceId,
        registeredAt: registration.registeredAt,
      });
    } catch (err) {
      if (err instanceof InvalidPayloadError) {
        return c.json({ ok: false, error: err.message }, 400);
      }
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  return app;
}

export default handle(createPushRegisterApp());
