import type { ParsedGtfs } from "./gtfs-parser.js";

/**
 * Prasarana's bus networks as data.gov.my publishes them: one static GTFS zip
 * and one GTFS-realtime vehicle-position feed per category. Rail
 * (`rapid-rail-kl`) is handled separately and is not listed here.
 * See https://developer.data.gov.my/realtime-api/gtfs-static.
 */
export const BUS_CATEGORIES = [
  "rapid-bus-mrtfeeder",
  "rapid-bus-kl",
  "rapid-bus-penang",
  "rapid-bus-kuantan",
] as const;
export type BusCategory = (typeof BUS_CATEGORIES)[number];

export interface BusCategoryInfo {
  /** Shown next to a route in search results. */
  label: string;
  /**
   * Prefix for every GTFS id from this feed (`kl:U4000`). The feeds reuse ids
   * across categories (feeder and Penang share stop and route ids; KL and
   * Kuantan share service ids), so everything but the feeder — which keeps
   * its raw ids so existing on-device data and saved stops stay valid — is
   * namespaced before it reaches SQLite.
   */
  idPrefix: string;
  /**
   * Appended to the route code to form the route key (`401 Penang`). Klang
   * Valley routes (feeder and Rapid KL) keep the bare code — their codes don't
   * overlap — while Penang and Kuantan reuse codes such as 201 or 303 that
   * Rapid KL also runs.
   */
  keySuffix: string | null;
  /** False when data.gov.my has no vehicle-position feed for the category. */
  hasRealtime: boolean;
  /**
   * Timetable published as headways (frequencies.txt). Live vehicles then
   * report the template trip_id plus their run's `start_time`.
   */
  headwayTrips: boolean;
  /**
   * Where to fetch the static zip, in order. The API redirects to an S3
   * object; for Kuantan the API currently 404s while the S3 object is still
   * published, so it's listed as a fallback.
   */
  staticUrls: readonly string[];
}

/** data.gov.my API host, shared by every static and realtime feed URL. */
export const DATA_GOV_MY_API = "https://api.data.gov.my";
const API = DATA_GOV_MY_API;
const S3 = "https://openapi-malaysia-transport.s3.ap-southeast-1.amazonaws.com/prasarana";

export const BUS_CATEGORY_INFO: Record<BusCategory, BusCategoryInfo> = {
  "rapid-bus-mrtfeeder": {
    label: "MRT Feeder",
    idPrefix: "",
    keySuffix: null,
    hasRealtime: true,
    headwayTrips: false,
    staticUrls: [`${API}/gtfs-static/prasarana?category=rapid-bus-mrtfeeder`],
  },
  "rapid-bus-kl": {
    label: "Rapid KL",
    idPrefix: "kl:",
    keySuffix: null,
    hasRealtime: true,
    headwayTrips: true,
    staticUrls: [`${API}/gtfs-static/prasarana?category=rapid-bus-kl`],
  },
  "rapid-bus-penang": {
    label: "Rapid Penang",
    idPrefix: "pg:",
    keySuffix: "Penang",
    hasRealtime: true,
    headwayTrips: false,
    staticUrls: [`${API}/gtfs-static/prasarana?category=rapid-bus-penang`],
  },
  "rapid-bus-kuantan": {
    label: "Rapid Kuantan",
    idPrefix: "kt:",
    keySuffix: "Kuantan",
    hasRealtime: false,
    headwayTrips: true,
    staticUrls: [
      `${API}/gtfs-static/prasarana?category=rapid-bus-kuantan`,
      `${S3}/gtfs_rapid_bus_kuantan.zip`,
    ],
  },
};

/** Klang Valley categories a bare route key may belong to, in lookup order. */
export const BARE_KEY_CATEGORIES: readonly BusCategory[] = [
  "rapid-bus-mrtfeeder",
  "rapid-bus-kl",
];

export function isBusCategory(v: unknown): v is BusCategory {
  return typeof v === "string" && (BUS_CATEGORIES as readonly string[]).includes(v);
}

export function vehiclePositionsUrl(category: BusCategory): string {
  return `${API}/gtfs-realtime/vehicle-position/prasarana?category=${category}`;
}

/**
 * The route's code as riders know it. The feeder feed leaves
 * `route_short_name` blank and puts the code in `route_long_name`; the other
 * feeds use `route_short_name` (and a descriptive long name).
 */
export function routeCodeOf(route: {
  route_short_name?: string;
  route_long_name?: string;
}): string {
  return (route.route_short_name || route.route_long_name || "").trim().toUpperCase();
}

/**
 * The identifier the app stores for a followed route (favourites, SQLite
 * `routes.code`, widgets). It doubles as the display label, so Penang and
 * Kuantan keys read naturally: "Next 401 Penang in 4 min".
 */
export function routeKeyFor(category: BusCategory, code: string): string {
  const c = code.trim().toUpperCase();
  const suffix = BUS_CATEGORY_INFO[category].keySuffix;
  return suffix ? `${c} ${suffix}` : c;
}

export interface ParsedRouteKey {
  code: string;
  /** Null for a bare key: one of {@link BARE_KEY_CATEGORIES}. */
  category: BusCategory | null;
}

export function parseRouteKey(key: string): ParsedRouteKey {
  const k = key.trim();
  for (const category of BUS_CATEGORIES) {
    const suffix = BUS_CATEGORY_INFO[category].keySuffix;
    if (!suffix) continue;
    const tail = ` ${suffix}`;
    if (k.length > tail.length && k.toLowerCase().endsWith(tail.toLowerCase())) {
      return { code: k.slice(0, -tail.length).trim().toUpperCase(), category };
    }
  }
  return { code: k.toUpperCase(), category: null };
}

/** Candidate categories for a route key, in the order to look it up. */
export function categoriesForKey(key: string): readonly BusCategory[] {
  const { category } = parseRouteKey(key);
  return category ? [category] : BARE_KEY_CATEGORIES;
}

/** Applies the category's id namespace to a raw GTFS / GTFS-realtime id. */
export function namespaceId(category: BusCategory, id: string): string;
export function namespaceId(category: BusCategory, id: string | undefined): string | undefined;
export function namespaceId(category: BusCategory, id: string | undefined): string | undefined {
  if (id === undefined || id === "") return id;
  return BUS_CATEGORY_INFO[category].idPrefix + id;
}

/** Strips any category namespace, giving the id as the upstream feed spells it. */
export function rawGtfsId(id: string): string {
  for (const category of BUS_CATEGORIES) {
    const p = BUS_CATEGORY_INFO[category].idPrefix;
    if (p && id.startsWith(p)) return id.slice(p.length);
  }
  return id;
}

/**
 * Namespaces every id in `parsed` for `category` (see
 * {@link BusCategoryInfo.idPrefix}) **in place** and returns it. Route codes
 * and names are untouched. Rewriting in place avoids a second copy of a
 * feed's ~300k stop_times; pass a freshly parsed feed. No-op for the feeder,
 * whose ids are stored raw.
 */
export function namespaceParsedGtfs(parsed: ParsedGtfs, category: BusCategory): ParsedGtfs {
  if (!BUS_CATEGORY_INFO[category].idPrefix) return parsed;
  const ns = (id: string) => namespaceId(category, id);
  const nsOpt = (id: string | undefined) => namespaceId(category, id);
  for (const r of parsed.routes) r.route_id = ns(String(r.route_id));
  for (const s of parsed.stops) {
    s.stop_id = ns(s.stop_id);
    s.parent_station = nsOpt(s.parent_station);
  }
  for (const t of parsed.trips) {
    t.route_id = ns(t.route_id);
    t.service_id = ns(t.service_id);
    t.trip_id = ns(t.trip_id);
    t.shape_id = nsOpt(t.shape_id);
  }
  for (const st of parsed.stopTimes) {
    st.trip_id = ns(st.trip_id);
    st.stop_id = ns(st.stop_id);
  }
  for (const p of parsed.shapes) p.shape_id = ns(p.shape_id);
  for (const c of parsed.calendar) c.service_id = ns(c.service_id);
  for (const c of parsed.calendarDates) c.service_id = ns(c.service_id);
  for (const a of parsed.fareAttributes) a.fare_id = ns(a.fare_id);
  for (const r of parsed.fareRules) {
    r.fare_id = ns(r.fare_id);
    r.route_id = nsOpt(r.route_id);
    r.origin_id = nsOpt(r.origin_id);
    r.destination_id = nsOpt(r.destination_id);
    r.contains_id = nsOpt(r.contains_id);
  }
  for (const t of parsed.transfers) {
    t.from_stop_id = ns(t.from_stop_id);
    t.to_stop_id = ns(t.to_stop_id);
  }
  for (const f of parsed.frequencies) f.trip_id = ns(f.trip_id);
  return parsed;
}
