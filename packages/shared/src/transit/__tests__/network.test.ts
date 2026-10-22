import assert from "node:assert/strict";
import test from "node:test";

import { BUS_CATEGORY_INFO } from "../../utils/categories.js";
import type { RailMode } from "../../utils/rail.js";
import {
  FEED_IDS,
  FEED_INFO,
  feedIdPrefix,
  feedOfStopId,
  namespaceFeedId,
  RAIL_MODE_TO_MODE,
  type Mode,
} from "../network.js";

test("FEED_INFO prefixes match BUS_CATEGORY_INFO", () => {
  assert.equal(FEED_INFO["bus-kl"].idPrefix, BUS_CATEGORY_INFO["rapid-bus-kl"].idPrefix);
  assert.equal(FEED_INFO.feeder.idPrefix, BUS_CATEGORY_INFO["rapid-bus-mrtfeeder"].idPrefix);
  assert.equal(FEED_INFO["bus-kl"].staticUrl, BUS_CATEGORY_INFO["rapid-bus-kl"].staticUrls[0]);
  assert.equal(FEED_INFO.feeder.staticUrl, BUS_CATEGORY_INFO["rapid-bus-mrtfeeder"].staticUrls[0]);
  assert.equal(feedIdPrefix("rail"), "rail:");
  assert.equal(feedIdPrefix("ktm"), "ktm:");
  // Every non-empty prefix is distinct, so feedOfStopId can tell them apart.
  const prefixes = FEED_IDS.map(feedIdPrefix).filter((p) => p !== "");
  assert.equal(new Set(prefixes).size, prefixes.length);
});

test("namespaceFeedId keeps feeder ids raw and prefixes rail/ktm/kl", () => {
  assert.equal(namespaceFeedId("feeder", "1000328"), "1000328");
  assert.equal(namespaceFeedId("rail", "KJ15"), "rail:KJ15");
  assert.equal(namespaceFeedId("ktm", "19100"), "ktm:19100");
  assert.equal(namespaceFeedId("bus-kl", "1005840"), "kl:1005840");
  assert.equal(namespaceFeedId("rail", ""), "");
});

test("feedOfStopId round-trips namespaceFeedId for every feed", () => {
  for (const feed of FEED_IDS) {
    for (const raw of ["KJ15", "19100", "1005840", "U4000"]) {
      assert.equal(feedOfStopId(namespaceFeedId(feed, raw)), feed, `${feed} ${raw}`);
    }
  }
});

test("RAIL_MODE_TO_MODE covers every RailMode", () => {
  RAIL_MODE_TO_MODE satisfies Record<RailMode, Mode>;
  const all: Record<RailMode, true> = { LRT: true, MRT: true, Monorail: true, BRT: true, KTM: true };
  assert.equal(Object.keys(RAIL_MODE_TO_MODE).length, 5);
  assert.deepEqual(Object.keys(RAIL_MODE_TO_MODE).sort(), Object.keys(all).sort());
  assert.equal(RAIL_MODE_TO_MODE.KTM, "ktm");
});
