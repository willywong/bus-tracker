import type { Db } from "./database";
import { META_KEYS } from "./schema";

/** One rail line's drawn geometry (`rail_shapes`). */
export interface RailShapeRow {
  /** Network `routes.id`: 'rail:KJ', … */
  routeId: string;
  shapeId: string;
  /** [lat0, lng0, lat1, lng1, …] */
  coords: Float32Array;
}

/** The BLOB form of `coords`: its bytes, in the platform's (little-endian) order. */
export function encodeRailCoords(coords: Float32Array): Uint8Array {
  const view = new Uint8Array(coords.buffer, coords.byteOffset, coords.byteLength);
  // A driver may bind the whole underlying buffer, so hand it one that is exactly this.
  return coords.byteOffset === 0 && coords.byteLength === coords.buffer.byteLength ? view : view.slice();
}

/**
 * Reads a `coords` BLOB back. The bytes are copied first: the driver's buffer
 * may be reused, and a Float32Array view needs a 4-byte-aligned offset.
 */
export function decodeRailCoords(bytes: Uint8Array): Float32Array {
  const usable = bytes.byteLength - (bytes.byteLength % 8);
  const copy = new Uint8Array(usable);
  copy.set(bytes.subarray(0, usable));
  return new Float32Array(copy.buffer);
}

/** Every stored rail line, by route id. */
export async function loadRailShapes(db: Db): Promise<Map<string, Float32Array>> {
  const rows = await db.getAllAsync<{ route_id: string; coords: Uint8Array }>(
    "SELECT route_id, coords FROM rail_shapes;",
  );
  const out = new Map<string, Float32Array>();
  for (const r of rows) out.set(r.route_id, decodeRailCoords(r.coords));
  return out;
}

export async function countRailShapes(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM rail_shapes;");
  return Number(row?.n ?? 0);
}

/** The rail feed hash the table was last written from, or null. */
export async function loadRailShapesHash(db: Db): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?;",
    META_KEYS.railShapesHash,
  );
  return row?.value ?? null;
}

/**
 * Writes `rows` (`INSERT OR REPLACE`) and records `hash`, in one transaction.
 * Nothing is ever deleted: a line missing from a newer feed keeps its last
 * good geometry.
 */
export async function saveRailShapes(db: Db, rows: readonly RailShapeRow[], hash: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(
        "INSERT OR REPLACE INTO rail_shapes(route_id, shape_id, coords) VALUES (?, ?, ?);",
        r.routeId,
        r.shapeId,
        encodeRailCoords(r.coords),
      );
    }
    await db.runAsync(
      "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?);",
      META_KEYS.railShapesHash,
      hash,
    );
  });
}
