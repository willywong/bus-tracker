import { MY_TZ_OFFSET_MIN } from "../utils/gtfs-time.js";
import type { TransitNetwork } from "./network.js";

/**
 * Epoch ms of Malaysia midnight starting service day `ymd` ("YYYYMMDD"), the
 * zero of the network's seconds (spec §3.3). UTC+8 all year, no DST.
 */
export function serviceDayStartMs(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) - MY_TZ_OFFSET_MIN * 60_000;
}

/**
 * `epochMs` in whole seconds after the network's service-day midnight. The
 * caller passes the network whose `serviceDate` is the Malaysia date of
 * `epochMs`; times after midnight against yesterday's network are not handled.
 */
export function toServiceSeconds(net: TransitNetwork, epochMs: number): number {
  return Math.floor((epochMs - serviceDayStartMs(net.meta.serviceDate)) / 1000);
}

/** Service-day seconds (may pass 86,400) as epoch ms. */
export function toEpochMs(net: TransitNetwork, sec: number): number {
  return serviceDayStartMs(net.meta.serviceDate) + sec * 1000;
}
