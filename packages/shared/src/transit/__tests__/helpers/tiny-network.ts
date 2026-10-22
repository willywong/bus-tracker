import { gridKey, GRID_CELL_DEG } from "../../compile.js";
import { TRANSFER_KIND, type FeedId, type Mode, type TransitNetwork } from "../../network.js";
import { buildNetwork } from "../fixtures/syntheticNetwork.js";

export interface TinyPattern {
  route: string;
  mode?: Mode;
  stops: string[];
  /** Departure from each stop, one row per trip, sorted by first departure (`arr` = `dep`). */
  trips?: number[][];
  /** Turn-up-and-go windows; every window of a pattern shares one template, so `offsets` must agree. */
  freq?: { start: number; end: number; headway: number; offsets: number[] }[];
}

const FEED_OF_MODE: Record<Mode, FeedId> = {
  bus: "bus-kl",
  feeder: "feeder",
  lrt: "rail",
  mrt: "rail",
  monorail: "rail",
  brt: "rail",
  ktm: "ktm",
};

/**
 * A small {@link TransitNetwork} for engine tests: stops by id, patterns by
 * stop ids (one route per distinct `route`, `bus` unless `mode` says
 * otherwise) and transfers both ways, sorted per stop by seconds then `to`
 * like `buildTransfers`. `kind` defaults to a proximity walk. No stations.
 */
export function tinyNetwork(spec: {
  stops: { id: string; lat: number; lon: number }[];
  patterns: TinyPattern[];
  transfers?: { a: string; b: string; seconds: number; kind?: number }[];
}): TransitNetwork {
  const stopIndex = new Map(spec.stops.map((s, i) => [s.id, i]));
  const at = (id: string) => {
    const i = stopIndex.get(id);
    if (i === undefined) throw new Error(`tinyNetwork: unknown stop ${id}`);
    return i;
  };
  const routeIds: string[] = [];
  const routeModes: Mode[] = [];
  for (const p of spec.patterns) {
    if (!routeIds.includes(p.route)) {
      routeIds.push(p.route);
      routeModes.push(p.mode ?? "bus");
    }
  }
  const net = buildNetwork({
    stops: spec.stops.map((s) => ({ id: s.id, name: s.id, station: -1 })),
    stations: [],
    routes: routeIds.map((id, i) => ({ id, label: id, mode: routeModes[i], feed: FEED_OF_MODE[routeModes[i]] })),
    patterns: spec.patterns.map((p) => {
      const offsets = p.freq?.[0]?.offsets;
      for (const f of p.freq ?? []) {
        if (f.offsets.length !== p.stops.length || f.offsets.some((o, i) => o !== offsets![i])) {
          throw new Error(`tinyNetwork: ${p.route} windows need one set of ${p.stops.length} offsets`);
        }
      }
      return {
        route: routeIds.indexOf(p.route),
        headsign: p.stops[p.stops.length - 1],
        stops: p.stops.map(at),
        trips: p.trips,
        windows: p.freq?.map((f) => [f.start, f.end, f.headway] as [number, number, number]),
        runOffset: offsets,
      };
    }),
  });

  const n = spec.stops.length;
  spec.stops.forEach((s, i) => {
    net.stops.lat[i] = s.lat;
    net.stops.lon[i] = s.lon;
  });
  const cells = new Map<number, number[]>();
  spec.stops.forEach((s, i) => {
    const key = gridKey(net.stops.lat[i], net.stops.lon[i], GRID_CELL_DEG);
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  net.grid = { cellDeg: GRID_CELL_DEG, cells: new Map([...cells].map(([k, v]) => [k, Int32Array.from(v)])) };

  const pairs: { from: number; to: number; seconds: number; kind: number }[] = [];
  for (const t of spec.transfers ?? []) {
    const kind = t.kind ?? TRANSFER_KIND.walk;
    pairs.push({ from: at(t.a), to: at(t.b), seconds: t.seconds, kind }, { from: at(t.b), to: at(t.a), seconds: t.seconds, kind });
  }
  pairs.sort((x, y) => x.from - y.from || x.seconds - y.seconds || x.to - y.to);
  const start = new Int32Array(n);
  const len = new Int32Array(n);
  for (const p of pairs) len[p.from]++;
  for (let i = 1; i < n; i++) start[i] = start[i - 1] + len[i - 1];
  net.transfers = {
    start,
    len,
    to: Int32Array.from(pairs.map((p) => p.to)),
    seconds: Int32Array.from(pairs.map((p) => p.seconds)),
    kind: Uint8Array.from(pairs.map((p) => p.kind)),
  };
  return net;
}
