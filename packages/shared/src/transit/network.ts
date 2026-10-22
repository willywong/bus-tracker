import {
  BUS_CATEGORY_INFO,
  DATA_GOV_MY_API,
  type BusCategory,
} from "../utils/categories.js";
import type { RailMode, RailStation } from "../utils/rail.js";

/**
 * The four feeds the routed network is compiled from. Its numeric index in
 * `stops.feed` / `routes.feed` is its position in {@link FEED_IDS}.
 */
export type FeedId = "rail" | "bus-kl" | "feeder" | "ktm";
/** How a route runs. Its numeric index in `routes.mode` is its position in {@link MODES}. */
export type Mode = "bus" | "feeder" | "lrt" | "mrt" | "monorail" | "brt" | "ktm";

export interface TransitNetwork {
  meta: {
    version: 1;
    serviceDate: string;                 // "YYYYMMDD"
    builtAt: number;                     // epoch ms
    feeds: Record<FeedId, { fetchedAt: number; hash: string; validUntil: string; included: boolean }>;
  };
  stops: {
    count: number;
    id: string[];                        // namespaced: "rail:KJ15", "kl:1005840", "ktm:19100", feeder raw
    name: string[];                      // display case (title-cased for rail/KTM)
    lat: Float32Array; lon: Float32Array;
    feed: Uint8Array;                    // FeedId index
    station: Int32Array;                 // index into stations, or -1
  };
  stations: RailStation[];               // merged physical stations (existing type + KTM)
  routes: {
    count: number;
    id: string[]; label: string[];       // "T816", "300", "KJ", "KTM Seremban"
    longName: string[]; mode: Uint8Array; color: string[]; textColor: string[];
    feed: Uint8Array;
    shapeId: string[];                   // for drawing legs; geometry stays in SQLite
  };
  patterns: {                            // one per (route, direction, exact stop sequence)
    count: number;
    route: Int32Array; headsign: string[];
    stopStart: Int32Array; stopLen: Int32Array; stops: Int32Array;   // flattened stop indices
    // Timetabled trips (feeder, KTM, and bus-kl expanded from headway templates)
    tripStart: Int32Array; tripLen: Int32Array;                      // sorted by first departure
    timeStart: Int32Array;               // per-pattern base into arr/dep
    arr: Int32Array; dep: Int32Array;    // arr[timeStart[p] + t * stopLen[p] + s]
    tripKey: string[];                   // GTFS trip_id or "<template>@HH:MM"
    // Turn-up-and-go windows (rail and any headway ≤ 12 min)
    freqStart: Int32Array; freqLen: Int32Array;
    fStart: Int32Array; fEnd: Int32Array; fHeadway: Int32Array;
    runOffset: Int32Array;               // [stopStart + s] seconds from first stop (template)
  };
  stopRoutes: { start: Int32Array; len: Int32Array; pattern: Int32Array; pos: Int32Array };
  transfers:  { start: Int32Array; len: Int32Array; to: Int32Array; seconds: Int32Array; kind: Uint8Array };
  grid: { cellDeg: number; cells: Map<number, Int32Array> };   // nearest-stop lookups
}

/**
 * Every feed, in index order. A feed's position here is the number stored in
 * `stops.feed` and `routes.feed`, and is part of the binary network format:
 * append only, never reorder.
 */
export const FEED_IDS = ["rail", "bus-kl", "feeder", "ktm"] as const satisfies readonly FeedId[];

/**
 * Every mode, in index order. A mode's position here is the number stored in
 * `routes.mode`, and is part of the binary network format: append only,
 * never reorder.
 */
export const MODES = ["bus", "feeder", "lrt", "mrt", "monorail", "brt", "ktm"] as const satisfies readonly Mode[];

/** `TransitNetwork.meta.version` written by this code. */
export const NETWORK_VERSION = 1 as const;

export interface FeedInfo {
  /** Shown in Settings → Data sources. */
  label: string;
  /** Publisher, for the CC BY 4.0 credit. */
  credit: string;
  /**
   * Prefix for every GTFS id from this feed (`rail:KJ15`). Empty for the
   * feeder, whose ids stay raw (see `BusCategoryInfo.idPrefix`).
   */
  idPrefix: string;
  staticUrl: string;
  /** The bus category this feed is, for the bus feeds. */
  category?: BusCategory;
}

export const FEED_INFO: Record<FeedId, FeedInfo> = {
  rail: {
    label: "Rapid KL rail",
    credit: "Prasarana",
    idPrefix: "rail:",
    staticUrl: `${DATA_GOV_MY_API}/gtfs-static/prasarana?category=rapid-rail-kl`,
  },
  "bus-kl": {
    label: "Rapid KL bus",
    credit: "Prasarana",
    idPrefix: BUS_CATEGORY_INFO["rapid-bus-kl"].idPrefix,
    staticUrl: BUS_CATEGORY_INFO["rapid-bus-kl"].staticUrls[0],
    category: "rapid-bus-kl",
  },
  feeder: {
    label: "MRT feeder bus",
    credit: "Prasarana",
    idPrefix: BUS_CATEGORY_INFO["rapid-bus-mrtfeeder"].idPrefix,
    staticUrl: BUS_CATEGORY_INFO["rapid-bus-mrtfeeder"].staticUrls[0],
    category: "rapid-bus-mrtfeeder",
  },
  ktm: {
    label: "KTM Komuter",
    credit: "KTMB",
    idPrefix: "ktm:",
    staticUrl: `${DATA_GOV_MY_API}/gtfs-static/ktmb`,
  },
};

export function feedIdPrefix(feed: FeedId): string {
  return FEED_INFO[feed].idPrefix;
}

/** Applies the feed's id namespace to a raw GTFS id. `''` stays `''`. */
export function namespaceFeedId(feed: FeedId, id: string): string {
  return id === "" ? id : FEED_INFO[feed].idPrefix + id;
}

/** The feed a namespaced stop id comes from; an unprefixed id is the feeder's. */
export function feedOfStopId(id: string): FeedId {
  for (const feed of FEED_IDS) {
    const p = FEED_INFO[feed].idPrefix;
    if (p && id.startsWith(p)) return feed;
  }
  return "feeder";
}

export const RAIL_MODE_TO_MODE: Record<RailMode, Mode> = {
  LRT: "lrt",
  MRT: "mrt",
  Monorail: "monorail",
  BRT: "brt",
  KTM: "ktm",
};

/**
 * `transfers.kind`, most specific last: a proximity walk, a platform change
 * within one merged station, a curated interchange, and a curated one whose
 * time has been walked.
 */
export const TRANSFER_KIND = { walk: 0, station: 1, interchange: 2, interchangeVerified: 3 } as const;
