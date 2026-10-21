import assert from "node:assert/strict";
import test from "node:test";
import {
  categoriesForKey,
  namespaceId,
  parseRouteKey,
  rawGtfsId,
  routeCodeOf,
  routeKeyFor,
  vehiclePositionsUrl,
} from "../categories.js";

test("Klang Valley keys are the bare code; Penang and Kuantan are suffixed", () => {
  assert.equal(routeKeyFor("rapid-bus-mrtfeeder", "t816"), "T816");
  assert.equal(routeKeyFor("rapid-bus-kl", "400"), "400");
  assert.equal(routeKeyFor("rapid-bus-penang", "401e"), "401E Penang");
  assert.equal(routeKeyFor("rapid-bus-kuantan", "300"), "300 Kuantan");
});

test("parseRouteKey round-trips and leaves bare keys category-less", () => {
  assert.deepEqual(parseRouteKey("401E Penang"), { code: "401E", category: "rapid-bus-penang" });
  assert.deepEqual(parseRouteKey("300 kuantan"), { code: "300", category: "rapid-bus-kuantan" });
  assert.deepEqual(parseRouteKey("T816"), { code: "T816", category: null });
  assert.deepEqual(parseRouteKey("SUNWAY LINE"), { code: "SUNWAY LINE", category: null });
  assert.deepEqual(categoriesForKey("400"), ["rapid-bus-mrtfeeder", "rapid-bus-kl"]);
  assert.deepEqual(categoriesForKey("401 Penang"), ["rapid-bus-penang"]);
});

test("routeCodeOf reads the feeder's long name and other feeds' short name", () => {
  assert.equal(routeCodeOf({ route_short_name: "", route_long_name: "T816" }), "T816");
  assert.equal(routeCodeOf({ route_short_name: "400", route_long_name: "Damai Perdana ~ Pasar Seni" }), "400");
});

test("ids are namespaced for every category but the feeder", () => {
  assert.equal(namespaceId("rapid-bus-mrtfeeder", "12000321"), "12000321");
  assert.equal(namespaceId("rapid-bus-penang", "12000321"), "pg:12000321");
  assert.equal(namespaceId("rapid-bus-kl", undefined), undefined);
  assert.equal(rawGtfsId("kl:U4000"), "U4000");
  assert.equal(rawGtfsId("30000025"), "30000025");
});

test("vehicle positions URL is per category", () => {
  assert.equal(
    vehiclePositionsUrl("rapid-bus-kl"),
    "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl",
  );
});
