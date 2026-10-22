import { readFeedSteps, simplifyPath, type NormalisedFeed, type runSteps } from "@bus-tracker/shared";
import type { Db } from "@/db/database";
import type { StoredFeed } from "@/db/networkStore";
import { loadRailShapesHash, saveRailShapes, type RailShapeRow } from "@/db/railShapesStore";

/**
 * Rail line geometry for the map's rail layer (plan 13/02): each rail
 * route's shape from the rail feed's shapes.txt, simplified and stored in
 * `rail_shapes`. Written during the network refresh, in slices.
 */

/** Douglas–Peucker tolerance: well under a line's drawn width at any zoom. */
export const RAIL_SHAPE_TOLERANCE_M = 5;
/** Shape rows grouped between yields; a few ms on Hermes. */
const GROUP_YIELD_EVERY = 2_048;

/**
 * Each rail route's simplified shape, as a generator that yields between
 * routes (drive it with `runSteps`). A route's shape is its first trip's,
 * the same rule `compileNetwork` uses for `routes.shapeId`, so the rows are
 * keyed exactly like the network's routes ('rail:KJ').
 */
export function* railShapesSteps(
  feed: NormalisedFeed,
  toleranceM = RAIL_SHAPE_TOLERANCE_M,
): Generator<void, RailShapeRow[], void> {
  const { trips, shapes, routes } = feed.parsed;
  const shapeOf = new Map<string, string>();
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    if (!shapeOf.has(t.route_id)) shapeOf.set(t.route_id, t.shape_id ?? "");
    if (i % GROUP_YIELD_EVERY === GROUP_YIELD_EVERY - 1) yield;
  }
  const wanted = new Set([...shapeOf.values()].filter((s) => s !== ""));
  const byShape = new Map<string, { seq: number; lat: number; lng: number }[]>();
  for (let i = 0; i < shapes.length; i++) {
    const p = shapes[i];
    if (wanted.has(p.shape_id)) {
      let pts = byShape.get(p.shape_id);
      if (!pts) byShape.set(p.shape_id, (pts = []));
      pts.push({ seq: p.shape_pt_sequence, lat: p.shape_pt_lat, lng: p.shape_pt_lon });
    }
    if (i % GROUP_YIELD_EVERY === GROUP_YIELD_EVERY - 1) yield;
  }
  yield;

  const rows: RailShapeRow[] = [];
  for (const r of routes) {
    const routeId = String(r.route_id);
    if (!feed.routeMeta.has(routeId)) continue;
    const shapeId = shapeOf.get(routeId);
    const pts = shapeId ? byShape.get(shapeId) : undefined;
    if (!shapeId || !pts || pts.length < 2) continue;
    pts.sort((a, b) => a.seq - b.seq);
    const kept = simplifyPath(pts, toleranceM);
    const coords = new Float32Array(kept.length * 2);
    kept.forEach((p, i) => {
      coords[2 * i] = p.lat;
      coords[2 * i + 1] = p.lng;
    });
    rows.push({ routeId, shapeId, coords });
    yield;
  }
  return rows;
}

export interface RailShapeDeps {
  db: Db;
  runSteps: typeof runSteps;
  log?: (msg: string) => void;
}

/**
 * Brings `rail_shapes` up to the stored rail feed. Skipped when it was
 * already written from this feed version (`meta.railShapesHash`), so a
 * daily rebuild doesn't redo it; an empty table (a fresh install, or the v9
 * upgrade) has no hash and is filled from the stored zip. `read` is the rail
 * feed if this refresh already read it with shapes. Returns the number of
 * lines written, or null when skipped.
 */
export async function refreshRailShapes(
  deps: RailShapeDeps,
  stored: StoredFeed | undefined,
  read: NormalisedFeed | undefined,
  sliceMs: number,
): Promise<number | null> {
  if (!stored) return null;
  if ((await loadRailShapesHash(deps.db)) === stored.hash) return null;
  const feed =
    read && read.parsed.shapes.length > 0
      ? read
      : await deps.runSteps(readFeedSteps(stored.zip, "rail", { shapes: true }), sliceMs);
  const rows = await deps.runSteps(railShapesSteps(feed), sliceMs);
  await saveRailShapes(deps.db, rows, stored.hash);
  const points = rows.reduce((n, r) => n + r.coords.length / 2, 0);
  deps.log?.(`rail shapes: ${rows.length} lines, ${points} points (from ${feed.parsed.shapes.length})`);
  return rows.length;
}
