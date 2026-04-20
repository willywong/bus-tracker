import { Hono } from "hono";
import { handle } from "hono/vercel";
import { SHARED_PKG_VERSION } from "@bus-tracker/shared";

export const config = { runtime: "edge" };

const app = new Hono().basePath("/api");

app.get("/health", (c) =>
  c.json({
    ok: true,
    at: new Date().toISOString(),
    sharedVersion: SHARED_PKG_VERSION,
  }),
);

export default handle(app);
