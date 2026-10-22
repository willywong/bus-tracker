import { readFileSync } from "node:fs";

import { compileNetworkSync, type CompileFeeds } from "../../compile.js";
import { readFeed, type NormalisedFeed } from "../../feeds.js";
import { FEED_IDS, type FeedId, type TransitNetwork } from "../../network.js";

/** Fixture feeds, captured 2026-10-23 (plan 12/00 step 1). */
const FIXTURES = new URL("../../__fixtures__/2026-10-23/", import.meta.url);
const ZIP: Record<FeedId, string> = {
  rail: "rapid-rail-kl.zip",
  "bus-kl": "rapid-bus-kl.zip",
  feeder: "rapid-bus-mrtfeeder.zip",
  ktm: "ktmb.zip",
};

let feeds: NormalisedFeed[] | null = null;
const networks = new Map<string, TransitNetwork>();

/**
 * The four fixture feeds compiled for `serviceDate` (default 20261028, a
 * Wednesday inside every calendar), with each `exclude` feed marked not
 * included. Feeds are read once and each network is memoised by its key, so
 * callers must not mutate it.
 */
export function fixtureNetwork(opts: { serviceDate?: string; exclude?: readonly FeedId[] } = {}): TransitNetwork {
  const serviceDate = opts.serviceDate ?? "20261028";
  const exclude = [...(opts.exclude ?? [])].sort();
  const key = `${serviceDate}|${exclude.join(",")}`;
  let net = networks.get(key);
  if (!net) {
    feeds ??= FEED_IDS.map((f) => readFeed(new Uint8Array(readFileSync(new URL(ZIP[f], FIXTURES))), f));
    const compileFeeds: CompileFeeds = {};
    for (const data of feeds) {
      compileFeeds[data.feed] = {
        data,
        meta: { fetchedAt: 1, hash: `h-${data.feed}`, validUntil: data.validUntil, included: !exclude.includes(data.feed) },
      };
    }
    net = compileNetworkSync(compileFeeds, serviceDate, { builtAt: 0 });
    networks.set(key, net);
  }
  return net;
}
