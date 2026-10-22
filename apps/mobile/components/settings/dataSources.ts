import { FEED_IDS, FEED_INFO, type FeedId, type NetworkHealth } from '@bus-tracker/shared';

/** One feed's row in Settings → Data sources. */
export interface DataSourceRow {
  feed: FeedId;
  /** `FEED_INFO[feed].label`. */
  title: string;
  /** The feed's state in words, with its end date. */
  detail: string;
  tone: 'normal' | 'warning' | 'muted';
}

/** Spec §5: the CC BY 4.0 credit. */
export const DATA_CREDIT = 'Data: data.gov.my (Prasarana, KTMB), CC BY 4.0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'YYYYMMDD' as "6 Nov 2026". A date, not a time: no clock format, time
 * zone or `Intl` is involved.
 */
export function formatYmd(ymd: string): string {
  const month = MONTHS[Number(ymd.slice(4, 6)) - 1];
  if (ymd.length !== 8 || !month) return ymd;
  return `${Number(ymd.slice(6, 8))} ${month} ${ymd.slice(0, 4)}`;
}

/** One row per network feed, in `FEED_IDS` order. */
export function dataSourceRows(health: NetworkHealth): DataSourceRow[] {
  return FEED_IDS.map((feed): DataSourceRow => {
    const title = FEED_INFO[feed].label;
    const h = health[feed];
    if (!h) return { feed, title, detail: 'Not downloaded yet', tone: 'muted' };
    const end = formatYmd(h.validUntil);
    switch (h.state) {
      case 'ok':
        return { feed, title, detail: `Timetable to ${end}`, tone: 'normal' };
      case 'expiring':
        return { feed, title, detail: `Ends ${end} · check back for an update`, tone: 'warning' };
      case 'expired':
        return { feed, title, detail: `Ended ${end} · not used for routes`, tone: 'muted' };
    }
  });
}
