import assert from "node:assert/strict";
import test from "node:test";

import { daysBetween, EXPIRING_DAYS, feedHealth, healthNote, networkHealth, type FeedHealthInput } from "../health.js";

/** 01:00 MYT on that calendar day (17:00 UTC the day before), so the date is unambiguous. */
const myt = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 1) - 8 * 60 * 60 * 1000;

const rail = (hasActiveServicesToday = false): FeedHealthInput => ({
  feed: "rail",
  validFrom: "20190101",
  validUntil: "20261231",
  hasActiveServicesToday,
});
// Before the end date the feed runs services; the flag only matters after it.
const railOn = (y: number, m: number, d: number, active = true) => networkHealth([rail(active)], myt(y, m, d)).rail!;

test("daysBetween counts whole days, negative backwards", () => {
  assert.equal(daysBetween("20261023", "20261231"), 69);
  assert.equal(daysBetween("20261231", "20261231"), 0);
  assert.equal(daysBetween("20270101", "20261231"), -1);
  assert.equal(EXPIRING_DAYS, 14);
});

test("rail on 2026-10-23 is ok (69 days left)", () => {
  const h = railOn(2026, 10, 23);
  assert.deepEqual(h, {
    feed: "rail",
    state: "ok",
    validFrom: "20190101",
    validUntil: "20261231",
    daysLeft: 69,
    included: true,
  });
});

test("rail on 2026-12-17 is expiring (14 days, inclusive boundary)", () => {
  const h = railOn(2026, 12, 17);
  assert.equal(h.daysLeft, 14);
  assert.equal(h.state, "expiring");
  assert.equal(h.included, true);
});

test("rail on 2026-12-16 is ok (15 days)", () => {
  const h = railOn(2026, 12, 16);
  assert.equal(h.daysLeft, 15);
  assert.equal(h.state, "ok");
});

test("rail on 2026-12-31 is still expiring (last valid day)", () => {
  const h = railOn(2026, 12, 31);
  assert.equal(h.daysLeft, 0);
  assert.equal(h.state, "expiring");
  assert.equal(h.included, true);
});

test("rail on 2027-01-01 with no active services is expired and excluded", () => {
  const h = railOn(2027, 1, 1, false);
  assert.equal(h.state, "expired");
  assert.equal(h.daysLeft, -1);
  assert.equal(h.included, false);
});

test("past validUntil but a calendar_dates add today keeps it usable", () => {
  const h = feedHealth(rail(true), "20270102");
  assert.equal(h.included, true);
  assert.notEqual(h.state, "expired");
  // Usable today, but nothing is promised after it.
  assert.equal(h.state, "expiring");
});

test("ktm fixture (ends early November, calendar 20261106) is expiring on 2026-10-23", () => {
  const h = networkHealth(
    [{ feed: "ktm", validFrom: "20260818", validUntil: "20261106", hasActiveServicesToday: true }],
    myt(2026, 10, 23),
  ).ktm!;
  assert.equal(h.daysLeft, 14);
  assert.equal(h.state, "expiring");
  assert.equal(h.included, true);
});

test("never-downloaded feeds are absent", () => {
  const h = networkHealth([rail(true)], myt(2026, 10, 23));
  assert.deepEqual(Object.keys(h), ["rail"]);
});

test("healthNote wording for rail-only, ktm-only and multiple", () => {
  const today = "20270102";
  const expired = (feed: FeedHealthInput["feed"]) =>
    feedHealth({ feed, validFrom: "20260101", validUntil: "20261231", hasActiveServicesToday: false }, today);
  const fine = (feed: FeedHealthInput["feed"]) =>
    feedHealth({ feed, validFrom: "20260101", validUntil: "20270331", hasActiveServicesToday: true }, today);

  assert.equal(healthNote({}), null);
  assert.equal(healthNote({ rail: fine("rail"), ktm: fine("ktm") }), null);
  assert.equal(
    healthNote({ rail: expired("rail"), "bus-kl": fine("bus-kl") }),
    "Rail timetable from data.gov.my has expired. Showing bus-only routes.",
  );
  assert.equal(
    healthNote({ ktm: expired("ktm"), rail: fine("rail") }),
    "KTM Komuter timetable from data.gov.my has expired. Showing routes without KTM.",
  );
  assert.equal(
    healthNote({ ktm: expired("ktm"), rail: expired("rail"), feeder: fine("feeder") }),
    "Some timetables from data.gov.my have expired: Rapid KL rail, KTM Komuter. Routes leave them out.",
  );
});

test("MYT date, not UTC", () => {
  // 2026-12-31T17:00Z is 01:00 on 2027-01-01 in Kuala Lumpur.
  const h = networkHealth([rail(false)], Date.UTC(2026, 11, 31, 17)).rail!;
  assert.equal(h.state, "expired");
  assert.equal(h.included, false);
  // An hour earlier it is still the last valid day.
  assert.equal(networkHealth([rail(false)], Date.UTC(2026, 11, 31, 15, 59)).rail!.state, "expiring");
});
