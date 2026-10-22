import { toMalaysiaParts } from "../utils/gtfs-time.js";
import { FEED_IDS, FEED_INFO, type FeedId } from "./network.js";

/**
 * Feed health (spec §3.6). Each downloaded feed is in exactly one state:
 * `expired` (past its last service day with nothing running today), left out
 * of routing; `expiring` (its last service day is at most
 * {@link EXPIRING_DAYS} away); or `ok`.
 */
export type FeedHealthState = "ok" | "expiring" | "expired";

export interface FeedHealth {
  feed: FeedId;
  state: FeedHealthState;
  /** 'YYYYMMDD' service range, from `readFeedSteps`. */
  validFrom: string;
  validUntil: string;
  /** Whole days from today to `validUntil`; 0 on the last valid day, negative after it. */
  daysLeft: number;
  /** Whether the feed is compiled into the network: `state !== 'expired'`. */
  included: boolean;
}

/** Per-feed health; a feed that was never downloaded is absent. */
export type NetworkHealth = Partial<Record<FeedId, FeedHealth>>;

export interface FeedHealthInput {
  feed: FeedId;
  validFrom: string;
  validUntil: string;
  /** Any service runs on the day being judged (`activeServiceIds(…).size > 0`). */
  hasActiveServicesToday: boolean;
}

/** A feed is `expiring` once its last service day is this many days away or fewer. */
export const EXPIRING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function ymdToUtcMs(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

/** Whole days from `fromYmd` to `toYmd` ('YYYYMMDD'); negative when `toYmd` is earlier. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((ymdToUtcMs(toYmd) - ymdToUtcMs(fromYmd)) / DAY_MS);
}

/**
 * One feed's health on `todayYmd`. A feed past `validUntil` that still runs
 * something today (a `calendar_dates` add) stays in, as `expiring`: it is
 * usable today and about to run out.
 */
export function feedHealth(f: FeedHealthInput, todayYmd: string): FeedHealth {
  const daysLeft = daysBetween(todayYmd, f.validUntil);
  const state: FeedHealthState =
    todayYmd > f.validUntil && !f.hasActiveServicesToday
      ? "expired"
      : daysLeft <= EXPIRING_DAYS
        ? "expiring"
        : "ok";
  return {
    feed: f.feed,
    state,
    validFrom: f.validFrom,
    validUntil: f.validUntil,
    daysLeft,
    included: state !== "expired",
  };
}

/** Health of every given feed on the MYT calendar date of `nowMs`. */
export function networkHealth(feeds: readonly FeedHealthInput[], nowMs: number): NetworkHealth {
  const today = toMalaysiaParts(new Date(nowMs)).ymd;
  const out: NetworkHealth = {};
  for (const f of feeds) out[f.feed] = feedHealth(f, today);
  return out;
}

/** The planner's one-line note about feeds left out of routing, or null when none are. */
export function healthNote(h: NetworkHealth): string | null {
  const excluded = FEED_IDS.filter((f) => h[f] && !h[f].included);
  if (excluded.length === 0) return null;
  if (excluded.length === 1) {
    if (excluded[0] === "rail") return "Rail timetable from data.gov.my has expired. Showing bus-only routes.";
    if (excluded[0] === "ktm") {
      return "KTM Komuter timetable from data.gov.my has expired. Showing routes without KTM.";
    }
  }
  const labels = excluded.map((f) => FEED_INFO[f].label).join(", ");
  return `Some timetables from data.gov.my have expired: ${labels}. Routes leave them out.`;
}
