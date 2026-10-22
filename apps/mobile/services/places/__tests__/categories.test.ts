import assert from "node:assert/strict";
import { test } from "node:test";

import { ADDRESS_SYMBOL, CATEGORY_SYMBOLS, PLACE_SYMBOL, placeSymbol } from "../categories";

test("maps every known category to a symbol", () => {
  const categories = Object.keys(CATEGORY_SYMBOLS);
  assert.equal(categories.length, 21);
  for (const category of categories) {
    const symbol = placeSymbol(category);
    assert.equal(symbol, CATEGORY_SYMBOLS[category]);
    assert.notEqual(symbol, PLACE_SYMBOL, category);
    assert.notEqual(symbol, ADDRESS_SYMBOL, category);
  }
  assert.equal(placeSymbol("MKPOICategoryRestaurant"), "fork.knife");
  assert.equal(placeSymbol("MKPOICategoryPublicTransport"), "tram.fill");
  assert.equal(placeSymbol("MKPOICategoryUniversity"), "graduationcap.fill");
});

test("null is an address pin", () => {
  assert.equal(placeSymbol(null), "mappin");
});

test("unknown falls back to mappin.circle.fill", () => {
  assert.equal(placeSymbol("MKPOICategoryBeach"), "mappin.circle.fill");
  assert.equal(placeSymbol(""), "mappin.circle.fill");
});
