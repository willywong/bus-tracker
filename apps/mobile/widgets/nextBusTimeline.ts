/**
 * Pure timeline builder for the "Next bus" Home / Lock Screen widget.
 *
 * WidgetKit can't fetch data and the widget's JS only lays out views, so the
 * app writes a whole timeline ahead of time: one entry for "now", then one
 * entry at each upcoming departure (the moment that bus leaves, the next one
 * becomes the hero). The widget therefore advances to the next bus on its
 * own, without the app running.
 *
 * No React Native / Expo imports here — this runs under `tsx --test`.
 */

export type NextBusDeparture = { epochMs: number; live: boolean };

/** What the app knows right now. `null` = no route chosen yet. */
export type NextBusSnapshot = {
  routeCode: string;
  stopName: string;
  /** Upcoming departures at the boarding stop (any order; past ones are ignored). */
  departures: NextBusDeparture[];
  /** When the app last refreshed this data (drives "Updated 08:41"). */
  updatedAtMs: number;
  /** First departure tomorrow, for the end-of-service state. */
  firstBusTomorrowMs?: number | null;
  /**
   * Last departure today, if known. When `departures` stops short of it (the
   * app only passed the next few), the timeline ends with "Open BusBuddy for
   * later buses" instead of wrongly claiming service has ended.
   */
  lastBusTodayMs?: number | null;
} | null;

/**
 * Props for one timeline entry. They're stored in the App Group's
 * UserDefaults, so they must be property-list safe: never `null`/`undefined`
 * (use 0 / '' for "none").
 */
export type NextBusWidgetProps = {
  /**
   * - `empty`   no route chosen → "Open BusBuddy to choose a route"
   * - `service` at least one departure ahead
   * - `ended`   no more buses today (optionally "First bus 05:30")
   * - `stale`   the app's list ran out but more buses run today → open the app
   */
  state: 'empty' | 'service' | 'ended' | 'stale';
  routeCode: string;
  stopName: string;
  /** Departures still ahead at this entry's date, soonest first. */
  departures: NextBusDeparture[];
  updatedAtMs: number;
  /** First bus tomorrow (epoch ms), 0 when unknown. */
  firstBusMs: number;
  /** The only departure left is known to be the day's last bus ("Last bus today"). */
  isLastBus: boolean;
};

export type NextBusTimelineEntry = { date: Date; props: NextBusWidgetProps };

/** WidgetKit reload budgets are tight; a dozen entries covers ~5 h at a 30 min headway. */
export const MAX_TIMELINE_ENTRIES = 12;
/** Hero + up to three following departures (medium shows all four). */
export const MAX_DEPARTURES_PER_ENTRY = 4;
/**
 * The hero shows a ticking countdown under an hour and a clock time beyond.
 * The entry date is the only clock the layout sees, so we add an entry at
 * `departure − 1 h` when the gap is longer than that.
 */
export const COUNTDOWN_WINDOW_MS = 60 * 60_000;
/**
 * A live ETA is an estimate that ages: after this long without an app refresh
 * it's shown as scheduled (the design rule: never present stale data as live).
 */
export const LIVE_FRESH_MS = 5 * 60_000;

export const EMPTY_WIDGET_PROPS: NextBusWidgetProps = {
  state: 'empty',
  routeCode: '',
  stopName: '',
  departures: [],
  updatedAtMs: 0,
  firstBusMs: 0,
  isLastBus: false,
};

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

/** Sorted, de-duplicated (live wins), integer-ms departures. */
function normaliseDepartures(departures: readonly NextBusDeparture[]): NextBusDeparture[] {
  const byTime = new Map<number, boolean>();
  for (const d of departures) {
    if (!d || typeof d.epochMs !== 'number' || !Number.isFinite(d.epochMs)) continue;
    const t = Math.round(d.epochMs);
    byTime.set(t, (byTime.get(t) ?? false) || d.live === true);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([epochMs, live]) => ({ epochMs, live }));
}

/**
 * Build the widget timeline for `snapshot` as seen at `now` (epoch ms).
 *
 * - One entry at `now`, then one at each upcoming departure time, each listing
 *   the departures still ahead at that moment (max {@link MAX_DEPARTURES_PER_ENTRY}).
 * - An extra entry one hour before a departure that is more than an hour away,
 *   so the hero can switch from clock time to countdown.
 * - After the last departure: `ended` (or `stale` when the app's list stopped
 *   short of `lastBusTodayMs`).
 * - At most {@link MAX_TIMELINE_ENTRIES} entries.
 * - `live` survives only on the first entry's first departure, and only while
 *   the data is fresh: later entries can't know whether that bus is still live.
 */
export function buildNextBusTimeline(
  snapshot: NextBusSnapshot,
  now: number,
): NextBusTimelineEntry[] {
  if (snapshot == null) {
    return [{ date: new Date(now), props: { ...EMPTY_WIDGET_PROPS, departures: [] } }];
  }

  const ahead = normaliseDepartures(snapshot.departures).filter((d) => d.epochMs > now);
  const updatedAtMs = finiteOrZero(snapshot.updatedAtMs);
  const firstBusMs = finiteOrZero(snapshot.firstBusTomorrowMs);
  const lastBusTodayMs = finiteOrZero(snapshot.lastBusTodayMs);
  const liveIsFresh = updatedAtMs > 0 && now - updatedAtMs <= LIVE_FRESH_MS;

  // Entry dates: now, each departure (it has left → next bus is the hero), and
  // the countdown switch-over point for long gaps.
  const dates: number[] = [now];
  let prev = now;
  for (const d of ahead) {
    const switchAt = d.epochMs - COUNTDOWN_WINDOW_MS;
    if (switchAt > prev) dates.push(switchAt);
    dates.push(d.epochMs);
    prev = d.epochMs;
    if (dates.length >= MAX_TIMELINE_ENTRIES) break;
  }

  // If the app's list doesn't reach the day's last bus, running out of
  // departures means "we don't know", not "service ended".
  const lastListed = ahead.length > 0 ? ahead[ahead.length - 1]!.epochMs : now;
  const listIsComplete = lastBusTodayMs === 0 || lastListed >= lastBusTodayMs;

  const base = {
    routeCode: snapshot.routeCode,
    stopName: snapshot.stopName,
    updatedAtMs,
    firstBusMs,
  };

  return dates.slice(0, MAX_TIMELINE_ENTRIES).map((date, index) => {
    const departures = ahead
      .filter((d) => d.epochMs > date)
      .slice(0, MAX_DEPARTURES_PER_ENTRY)
      .map((d, i) => ({
        epochMs: d.epochMs,
        live: index === 0 && i === 0 && liveIsFresh && d.live,
      }));
    const state: NextBusWidgetProps['state'] =
      departures.length > 0 ? 'service' : listIsComplete ? 'ended' : 'stale';
    const isLastBus = departures.length === 1 && listIsComplete && departures[0]!.epochMs === lastListed;
    return { date: new Date(date), props: { ...base, state, departures, isLastBus } };
  });
}

/**
 * Cheap identity for "would the widget show something different?" — route,
 * stop, departures to the minute, live flags and the end-of-day hints. Excludes
 * `updatedAtMs` so a poll that changes nothing doesn't spend WidgetKit's
 * reload budget.
 */
export function nextBusTimelineKey(snapshot: NextBusSnapshot): string {
  if (snapshot == null) return 'empty';
  const deps = normaliseDepartures(snapshot.departures)
    .map((d) => `${Math.floor(d.epochMs / 60_000)}${d.live ? 'L' : 'S'}`)
    .join(',');
  return [
    snapshot.routeCode,
    snapshot.stopName,
    deps,
    Math.floor(finiteOrZero(snapshot.firstBusTomorrowMs) / 60_000),
    Math.floor(finiteOrZero(snapshot.lastBusTodayMs) / 60_000),
  ].join('|');
}
