import assert from "node:assert/strict";
import { test } from "node:test";

import { buildQuickActionItems, MAX_QUICK_ACTIONS } from "../quickActions";

const favorites = ["T816", "400", "SUNWAY LINE", "T815", "780"];

test("where-to is always first", () => {
  assert.equal(buildQuickActionItems({ favorites, stopNames: {}, saved: [] })[0]?.id, "where-to");
  const alone = buildQuickActionItems({ favorites: [], stopNames: {}, saved: [] });
  assert.deepEqual(
    alone.map((a) => a.id),
    ["where-to"],
  );
  assert.deepEqual(alone[0]?.params, { href: "/plan" });
});

test("favourites fill the remaining three slots", () => {
  const items = buildQuickActionItems({ favorites, stopNames: {}, saved: [] });
  assert.deepEqual(
    items.slice(1).map((a) => a.params),
    [{ code: "T816" }, { code: "400" }, { code: "SUNWAY LINE" }],
  );
  assert.equal(items[1]?.title, "Track T816");
});

test("never more than four items", () => {
  for (let n = 0; n <= favorites.length; n++) {
    const items = buildQuickActionItems({ favorites: favorites.slice(0, n), stopNames: {}, saved: [] });
    assert.ok(items.length <= MAX_QUICK_ACTIONS);
    assert.equal(items.length, Math.min(MAX_QUICK_ACTIONS, n + 1));
  }
});

test("stop name becomes the subtitle", () => {
  const items = buildQuickActionItems({
    favorites: ["T816", "400"],
    stopNames: { T816: "Hotel Lisa De Inn" },
    saved: [],
  });
  assert.equal(items[1]?.subtitle, "Hotel Lisa De Inn");
  assert.equal(items[2]?.subtitle, null);
});
