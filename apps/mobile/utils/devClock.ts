const RAW = process.env.EXPO_PUBLIC_DEV_NOW_OFFSET_MS;
const OFFSET_MS = RAW != null && RAW !== '' ? Number(RAW) : 0;
const SAFE_OFFSET = Number.isFinite(OFFSET_MS) ? OFFSET_MS : 0;

/**
 * Returns `Date.now()` in production. In local dev, adds
 * `EXPO_PUBLIC_DEV_NOW_OFFSET_MS` so the app can believe it's within GTFS
 * service hours during off-hours testing (e.g. validating the Dynamic Island
 * Live Activity at 12:30 AM when no buses are running).
 *
 * Zero behavior change when the env var is unset.
 */
export const devNow = (): number => Date.now() + SAFE_OFFSET;

export const devClockOffsetMs = (): number => SAFE_OFFSET;
