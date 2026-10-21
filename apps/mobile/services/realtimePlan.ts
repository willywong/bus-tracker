import {
  BUS_CATEGORY_INFO,
  categoriesForKey,
  dropImplausibleFixes,
  entitiesToPositions,
  frequencyInstanceId,
  gtfsTimeToSeconds,
  isBusCategory,
  namespaceId,
  parseRouteKey,
  rawGtfsId,
  resolveRouteAlias,
  type BusCategory,
  type DecodedEntity,
  type DecodedFeed,
  type RouteId,
  type VehiclePosition,
} from "@bus-tracker/shared";

/** What the poller needs to read one category's vehicle-position feed. */
export interface RealtimeFeedPlan {
  category: BusCategory;
  /** Namespaced static trip_id → route key. */
  tripToRoute: Map<string, RouteId>;
  /**
   * Realtime `trip.route_id` → route key. The feeder and Penang feeds send
   * the route code ("T816", "401"); Rapid KL sends its GTFS route_id ("U4000").
   */
  aliases: Map<string, RouteId>;
  /** Followed route keys this feed is polled for. */
  routes: Set<RouteId>;
}

export interface RealtimePlan {
  /** Only categories that have a realtime feed, one entry each. */
  feeds: RealtimeFeedPlan[];
  /**
   * False while some followed route isn't in SQLite yet (just added, still
   * bootstrapping). The plan then guesses its category from the key and
   * should be rebuilt on the next poll.
   */
  complete: boolean;
}

export interface StoredRoute {
  code: string;
  route_id: string;
  category: string | null;
}

/**
 * Works out which vehicle-position feeds to poll for the followed routes —
 * one per category actually followed, never all of them — and how to map
 * each feed's vehicles back to route keys.
 */
export function buildRealtimePlan(
  routeCodes: readonly string[],
  stored: readonly StoredRoute[],
  tripToRoute: ReadonlyMap<string, string>,
): RealtimePlan {
  const byCategory = new Map<BusCategory, RealtimeFeedPlan>();
  const entry = (category: BusCategory) => {
    let e = byCategory.get(category);
    if (!e) {
      e = { category, tripToRoute: new Map(), aliases: new Map(), routes: new Set() };
      byCategory.set(category, e);
    }
    return e;
  };

  const followed = new Set(routeCodes);
  const categoryOf = new Map<string, BusCategory>();
  for (const row of stored) {
    if (!followed.has(row.code)) continue;
    const category = storedCategory(row);
    categoryOf.set(row.code, category);
    const e = entry(category);
    e.aliases.set(rawGtfsId(row.route_id), row.code);
    e.aliases.set(parseRouteKey(row.code).code, row.code);
    e.routes.add(row.code);
  }
  for (const [tripId, code] of tripToRoute) {
    const category = categoryOf.get(code);
    if (category) entry(category).tripToRoute.set(tripId, code);
  }

  let complete = true;
  for (const code of routeCodes) {
    if (categoryOf.has(code)) continue;
    complete = false;
    for (const category of categoriesForKey(code)) {
      const e = entry(category);
      e.aliases.set(parseRouteKey(code).code, code);
      e.routes.add(code);
    }
  }

  return {
    feeds: [...byCategory.values()].filter((f) => BUS_CATEGORY_INFO[f.category].hasRealtime),
    complete,
  };
}

/** Rows written before categories existed are all feeder rows. */
function storedCategory(row: StoredRoute): BusCategory {
  return isBusCategory(row.category) ? row.category : "rapid-bus-mrtfeeder";
}

/**
 * Followed routes whose live vehicles are matched by static trip_id, so the
 * only ones whose trip ids are worth loading. Headway networks (Rapid KL,
 * Kuantan) report a template trip plus a start time that doesn't line up
 * with a stored run, so their vehicles resolve by `trip.route_id` instead;
 * Kuantan has no live feed at all.
 */
export function tripMapRouteCodes(stored: readonly StoredRoute[]): string[] {
  const codes = new Set<string>();
  for (const row of stored) {
    const info = BUS_CATEGORY_INFO[storedCategory(row)];
    if (info.hasRealtime && !info.headwayTrips) codes.add(row.code);
  }
  return [...codes];
}

type FeedTrip = NonNullable<NonNullable<DecodedEntity["vehicle"]>["trip"]>;

/**
 * A feed trip id in SQLite's namespace. On headway-based networks it also
 * gets the run's start time (`kl:<template>@12:52:10`), so each bus maps to
 * its own run rather than to the shared template.
 */
function namespacedTripId(category: BusCategory, trip: FeedTrip): string | undefined {
  const id = namespaceId(category, trip.trip_id);
  const start = BUS_CATEGORY_INFO[category].headwayTrips ? gtfsTimeToSeconds(trip.start_time) : null;
  return id && start != null ? frequencyInstanceId(id, start) : id;
}

/** Puts a feed's trip and stop ids into the same namespace as SQLite's. */
export function namespaceFeed(category: BusCategory, feed: DecodedFeed): DecodedFeed {
  if (!BUS_CATEGORY_INFO[category].idPrefix) return feed;
  return {
    ...feed,
    entity: feed.entity.map((e): DecodedEntity => {
      const v = e.vehicle;
      if (!v) return e;
      return {
        ...e,
        vehicle: {
          ...v,
          stop_id: namespaceId(category, v.stop_id),
          trip: v.trip ? { ...v.trip, trip_id: namespacedTripId(category, v.trip) } : v.trip,
        },
      };
    }),
  };
}

/**
 * Whether a feed entity is a bus on a followed route, resolved the same way
 * as `entitiesToPositions`: static trip_id first, then `trip.route_id`.
 */
function isFollowed(plan: RealtimeFeedPlan, entity: DecodedEntity): boolean {
  const trip = entity.vehicle?.trip;
  if (!trip?.trip_id) return false;
  const tripId = plan.tripToRoute.size > 0 ? namespacedTripId(plan.category, trip) : undefined;
  if (tripId && plan.tripToRoute.has(tripId)) return true;
  return !!trip.route_id && resolveRouteAlias(trip.route_id, plan.aliases) !== undefined;
}

/** Plausible positions on followed routes from one category's feed. */
export function positionsFromFeed(
  plan: RealtimeFeedPlan,
  feed: DecodedFeed,
  now: number,
): VehiclePosition[] {
  // Most of a feed is other routes' buses: drop them before copying each
  // entity into SQLite's namespace.
  const followed: DecodedFeed = { ...feed, entity: feed.entity.filter((e) => isFollowed(plan, e)) };
  return dropImplausibleFixes(
    entitiesToPositions(namespaceFeed(plan.category, followed), plan.tripToRoute, now, plan.aliases),
    now,
  );
}

/** How the live feed behind one followed route is doing. */
export interface RouteFeedHealth {
  /**
   * Plausible vehicles across the feed(s) this route is polled from, from the
   * last poll. 0 during service hours means that feed is down; null when the
   * route has no realtime feed (Kuantan) or nothing has been fetched yet.
   */
  vehicleCount: number | null;
  /** Set when every feed this route depends on failed on the last poll. */
  error: Error | null;
}

export interface FeedHealth {
  vehicleCount: number | null;
  error: Error | null;
}

/**
 * Per-route view of per-feed health, so one network's outage (or a route on
 * a network with no live feed) isn't masked by another network's buses.
 */
export function routeFeedHealth(
  routeCodes: readonly string[],
  plan: RealtimePlan,
  byCategory: ReadonlyMap<BusCategory, FeedHealth>,
): Record<string, RouteFeedHealth> {
  const out: Record<string, RouteFeedHealth> = {};
  for (const code of routeCodes) {
    const feeds = plan.feeds.filter((f) => f.routes.has(code));
    let vehicleCount: number | null = null;
    let error: Error | null = null;
    let allFailed = feeds.length > 0;
    for (const f of feeds) {
      const h = byCategory.get(f.category);
      if (h?.vehicleCount != null) vehicleCount = (vehicleCount ?? 0) + h.vehicleCount;
      if (h?.error) error ??= h.error;
      else allFailed = false;
    }
    out[code] = { vehicleCount, error: allFailed ? error : null };
  }
  return out;
}
