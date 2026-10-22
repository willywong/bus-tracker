import assert from "node:assert/strict";
import { test } from "node:test";

import type { SavedPlace } from "@/hooks/useSettings";

import { buildQuickActionItems, MAX_QUICK_ACTIONS } from "../quickActions";

const favorites = ["T816", "400", "SUNWAY LINE", "T815", "780"];

const place = (kind: SavedPlace["kind"], id: string = kind): SavedPlace => ({
  id,
  kind,
  name: id,
  address: null,
  lat: 3.1,
  lng: 101.6,
  ref: null,
  createdAt: 1,
});
const home = place("home");
const work = place("work");

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

test("home and work follow where-to", () => {
  const items = buildQuickActionItems({ favorites, stopNames: {}, saved: [place("pin", "pin-1"), work, home] });
  assert.deepEqual(
    items.map((a) => a.id),
    ["where-to", "plan-home", "plan-work", "track-T816"],
  );
  assert.deepEqual(items[1], {
    id: "plan-home",
    title: "Home",
    subtitle: "Directions home",
    icon: "symbol:house.fill",
    params: { href: "/plan", to: "home" },
  });
  assert.deepEqual(items[2]?.params, { href: "/plan", to: "work" });
  assert.equal(items[2]?.icon, "symbol:briefcase.fill");
});

test("favourites fill what is left", () => {
  for (const saved of [[], [home], [home, work]]) {
    for (let n = 0; n <= favorites.length; n++) {
      const items = buildQuickActionItems({ favorites: favorites.slice(0, n), stopNames: {}, saved });
      assert.equal(items.length, Math.min(MAX_QUICK_ACTIONS, 1 + saved.length + n));
      const tracks = items.filter((a) => a.id.startsWith("track-")).map((a) => a.params);
      assert.deepEqual(
        tracks,
        favorites.slice(0, Math.min(n, MAX_QUICK_ACTIONS - 1 - saved.length)).map((code) => ({ code })),
      );
    }
  }
});

test("missing home is skipped", () => {
  const items = buildQuickActionItems({ favorites, stopNames: {}, saved: [work] });
  assert.deepEqual(
    items.map((a) => a.id),
    ["where-to", "plan-work", "track-T816", "track-400"],
  );
});
