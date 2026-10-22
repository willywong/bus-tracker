import type { RailStation } from "../../../utils/rail.js";
import { FEED_IDS, MODES, NETWORK_VERSION, type FeedId, type Mode, type TransitNetwork } from "../../network.js";

/** The service date of {@link syntheticNetwork}, a Wednesday. */
export const SYNTH_DATE = "20261028";

const at = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

interface SynthStop { id: string; name: string; station: number }
interface SynthRoute { id: string; label: string; mode: Mode; feed: FeedId }
interface SynthPattern {
  route: number;
  headsign: string;
  stops: number[];
  /** Departure from each stop, one row per trip, sorted by first departure. */
  trips?: number[][];
  windows?: Array<[start: number, end: number, headway: number]>;
  runOffset?: number[];
}

/** A {@link TransitNetwork} from plain lists; `arr` = `dep`, empty transfers and grid. */
export function buildNetwork(spec: {
  serviceDate?: string;
  stops: SynthStop[];
  stations: RailStation[];
  routes: SynthRoute[];
  patterns: SynthPattern[];
}): TransitNetwork {
  const { stops, routes, patterns } = spec;
  const p = patterns;
  const slots = p.reduce((n, x) => n + x.stops.length, 0);
  const events = p.reduce((n, x) => n + (x.trips?.length ?? 0) * x.stops.length, 0);
  const windows = p.reduce((n, x) => n + (x.windows?.length ?? 0), 0);
  const out: TransitNetwork["patterns"] = {
    count: p.length,
    route: Int32Array.from(p.map((x) => x.route)),
    headsign: p.map((x) => x.headsign),
    stopStart: new Int32Array(p.length),
    stopLen: Int32Array.from(p.map((x) => x.stops.length)),
    stops: new Int32Array(slots),
    tripStart: new Int32Array(p.length),
    tripLen: Int32Array.from(p.map((x) => x.trips?.length ?? 0)),
    timeStart: new Int32Array(p.length),
    arr: new Int32Array(events),
    dep: new Int32Array(events),
    tripKey: [],
    freqStart: new Int32Array(p.length),
    freqLen: Int32Array.from(p.map((x) => x.windows?.length ?? 0)),
    fStart: new Int32Array(windows),
    fEnd: new Int32Array(windows),
    fHeadway: new Int32Array(windows),
    runOffset: new Int32Array(slots),
  };
  let slot = 0;
  let trip = 0;
  let event = 0;
  let w = 0;
  p.forEach((x, i) => {
    out.stopStart[i] = slot;
    out.stops.set(x.stops, slot);
    if (x.runOffset) out.runOffset.set(x.runOffset, slot);
    slot += x.stops.length;
    out.tripStart[i] = trip;
    out.timeStart[i] = event;
    for (const [t, deps] of (x.trips ?? []).entries()) {
      out.tripKey.push(`${x.headsign}#${t}`);
      out.arr.set(deps, event);
      out.dep.set(deps, event);
      event += x.stops.length;
      trip++;
    }
    out.freqStart[i] = w;
    for (const [start, end, headway] of x.windows ?? []) {
      out.fStart[w] = start;
      out.fEnd[w] = end;
      out.fHeadway[w] = headway;
      w++;
    }
  });

  // stopRoutes: CSR by stop of every (pattern, pos).
  const len = new Int32Array(stops.length);
  for (const s of out.stops) len[s]++;
  const start = new Int32Array(stops.length);
  for (let i = 1; i < stops.length; i++) start[i] = start[i - 1] + len[i - 1];
  const fill = new Int32Array(stops.length);
  const srPattern = new Int32Array(slots);
  const srPos = new Int32Array(slots);
  p.forEach((x, i) =>
    x.stops.forEach((s, pos) => {
      const k = start[s] + fill[s]++;
      srPattern[k] = i;
      srPos[k] = pos;
    }),
  );

  const feeds = {} as TransitNetwork["meta"]["feeds"];
  for (const f of FEED_IDS) feeds[f] = { fetchedAt: 0, hash: "", validUntil: "20261231", included: true };
  return {
    meta: { version: NETWORK_VERSION, serviceDate: spec.serviceDate ?? SYNTH_DATE, builtAt: 0, feeds },
    stops: {
      count: stops.length,
      id: stops.map((s) => s.id),
      name: stops.map((s) => s.name),
      lat: new Float32Array(stops.length),
      lon: new Float32Array(stops.length),
      feed: Uint8Array.from(stops.map((s) => FEED_IDS.indexOf(s.id.startsWith("ktm:") ? "ktm" : "rail"))),
      station: Int32Array.from(stops.map((s) => s.station)),
    },
    stations: spec.stations,
    routes: {
      count: routes.length,
      id: routes.map((r) => r.id),
      label: routes.map((r) => r.label),
      longName: routes.map((r) => r.label),
      mode: Uint8Array.from(routes.map((r) => MODES.indexOf(r.mode))),
      color: routes.map(() => "#000000"),
      textColor: routes.map(() => "#FFFFFF"),
      feed: Uint8Array.from(routes.map((r) => FEED_IDS.indexOf(r.feed))),
      shapeId: routes.map(() => ""),
    },
    patterns: out,
    stopRoutes: { start, len, pattern: srPattern, pos: srPos },
    transfers: {
      start: new Int32Array(stops.length),
      len: new Int32Array(stops.length),
      to: new Int32Array(0),
      seconds: new Int32Array(0),
      kind: new Uint8Array(0),
    },
    grid: { cellDeg: 0.005, cells: new Map() },
  };
}

const station = (id: string, name: string, stopIds: string[]): RailStation => ({ id, name, lat: 0, lng: 0, stopIds, lines: [] });

/** Rail windows at each pattern's first stop: 06:00–09:00 every 3 min, then 09:00–23:30 every 7 min. */
export const SYNTH_WINDOWS: Array<[number, number, number]> = [
  [at(6), at(9), 180],
  [at(9), at(23, 30), 420],
];
/** Rail run time from the first stop: 0, 2 and 5 min. */
export const SYNTH_RUN_OFFSET = [0, 120, 300];
/** KTM departures from Kilo One; each next stop is 10 min on. */
export const SYNTH_KTM_STARTS = [at(6, 30), at(7, 30), at(8, 30)];

/**
 * One 3-stop rail line (KJ1 Alpha – KJ2 Bravo – KJ3 Charlie) as a headway
 * pattern each way, and one 3-trip KTM pattern (Kilo One → Kilo Two → Kilo
 * Three). Bravo is an interchange holding both KJ2 and Kilo Two.
 *
 * Stops: 0 Alpha, 1 Bravo, 2 Charlie, 3 Kilo One, 4 Kilo Two, 5 Kilo Three.
 * Patterns: 0 KJ3 → KJ1 (listed first on purpose), 1 KJ1 → KJ3, 2 KTM.
 */
export function syntheticNetwork(): TransitNetwork {
  return buildNetwork({
    stops: [
      { id: "rail:KJ1", name: "Alpha", station: 0 },
      { id: "rail:KJ2", name: "Bravo", station: 1 },
      { id: "rail:KJ3", name: "Charlie", station: 2 },
      { id: "ktm:100", name: "Kilo One", station: 3 },
      { id: "ktm:200", name: "Kilo Two", station: 1 },
      { id: "ktm:300", name: "Kilo Three", station: 4 },
    ],
    stations: [
      station("alpha", "Alpha", ["rail:KJ1"]),
      station("bravo", "Bravo", ["rail:KJ2", "ktm:200"]),
      station("charlie", "Charlie", ["rail:KJ3"]),
      station("ktm-kilo-one", "Kilo One", ["ktm:100"]),
      station("ktm-kilo-three", "Kilo Three", ["ktm:300"]),
    ],
    routes: [
      { id: "rail:KJ", label: "KJ", mode: "lrt", feed: "rail" },
      { id: "ktm:SB", label: "KTM Seremban", mode: "ktm", feed: "ktm" },
    ],
    patterns: [
      { route: 0, headsign: "To Alpha", stops: [2, 1, 0], windows: SYNTH_WINDOWS, runOffset: SYNTH_RUN_OFFSET },
      { route: 0, headsign: "To Charlie", stops: [0, 1, 2], windows: SYNTH_WINDOWS, runOffset: SYNTH_RUN_OFFSET },
      {
        route: 1,
        headsign: "Kilo Three",
        stops: [3, 4, 5],
        trips: SYNTH_KTM_STARTS.map((t) => [t, t + 600, t + 1200]),
      },
    ],
  });
}
