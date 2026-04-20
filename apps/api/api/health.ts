import { SHARED_PKG_VERSION } from "@bus-tracker/shared";

export const config = { runtime: "edge" };

export default function handler(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      at: new Date().toISOString(),
      sharedVersion: SHARED_PKG_VERSION,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
