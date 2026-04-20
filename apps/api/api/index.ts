import { Hono } from "hono";
import { handle } from "hono/vercel";

export const config = { runtime: "edge" };

const app = new Hono().basePath("/api");

app.get("/health", (c) =>
  c.json({ ok: true, at: new Date().toISOString() }),
);

export default handle(app);
