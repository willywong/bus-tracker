import type { FeedId, Mode } from "../network.js";
import type { Place, PlanQuery } from "../plan.js";

/** Plan 14/06 step 2: one end-to-end expectation against the 2026-10-23 fixtures. */
export interface Golden {
  name: string;
  /** Passed to `fixtureNetwork`. */
  exclude?: readonly FeedId[];
  /** `walkMetersPerMin: 80`. */
  query: PlanQuery;
  expect: {
    /** At least one itinerary matches one of these (`outlineMatches`); [] accepts any outline. */
    outlines: string[];
    /** 'HH:MM' MYT arrival of a matching itinerary, ±5 min; null until recorded (`GOLDEN_REPORT=1`). */
    arrive: string | null;
    /** Outline required at index 0. */
    first?: string;
    /** `PlanResult.excludedFeeds` must equal this (default []). */
    excludedFeeds?: FeedId[];
    /** Every ride leg's mode must be in this list. */
    allowedModes?: Mode[];
    minItineraries?: number;
  };
}

/** 2026-10-28 08:00 MYT (a Wednesday inside every fixture calendar). */
export const AT_0800 = Date.UTC(2026, 9, 28, 0, 0);

export const LISA: Place = { kind: "stop", name: "Hotel Lisa De Inn", lat: 3.118231, lng: 101.63065, ref: "12000759" };
export const KLCC: Place = { kind: "station", name: "KLCC", lat: 3.158935, lng: 101.713287, ref: "klcc" };

const query = (from: Place, to: Place): PlanQuery => ({ from, to, departAt: AT_0800, walkMetersPerMin: 80 });

export const GOLDENS: readonly Golden[] = [
  {
    name: "Hotel Lisa De Inn → KLCC",
    query: query(LISA, KLCC),
    // With Rapid KL buses, a bus (or two) to a KJ station beats T816 → KG → KJ (09:16), which leaves earlier and arrives
    // later than walk>T786>walk>780>walk>KJ (08:36 → 09:04), so it is not in the Pareto set. The T816 outline is golden 6.
    expect: { outlines: ["walk>*>*>walk>KJ", "walk>*>walk>KJ", "walk>*>walk>*>walk>KJ", "T816>walk>KG>walk>KJ"], arrive: "08:42" },
  },
  {
    name: "PJ Section 14 → KL Sentral",
    query: query(
      { kind: "place", name: "Digital Mall, Seksyen 14", lat: 3.110474, lng: 101.636336 },
      { kind: "station", name: "KL Sentral", lat: 3.133636, lng: 101.687034, ref: "kl-sentral" },
    ),
    expect: { outlines: ["walk>KJ", "walk>*>walk>KJ", "walk>*>walk>KG>walk", "walk>*>walk"], arrive: "08:23" },
  },
  {
    name: "Subang Jaya → Bukit Bintang",
    query: query(
      { kind: "place", name: "SS15, Subang Jaya", lat: 3.083, lng: 101.589 },
      { kind: "station", name: "Bukit Bintang", lat: 3.146262, lng: 101.711224, ref: "bukit-bintang" },
    ),
    // Spec §4.4 says "KTM → LRT → Monorail"; on this network KTM to KL Sentral changes straight to the Monorail.
    expect: { outlines: ["walk>KTM Port Klang>walk>MR", "walk>KJ>walk>MR", "walk>KJ>walk>KG"], arrive: "08:56" },
  },
  {
    name: "300 m walk-only",
    query: query(
      { kind: "place", name: "Hotel Lisa De Inn", lat: 3.118231, lng: 101.63065 },
      { kind: "place", name: "300 m north", lat: 3.120929, lng: 101.63065 },
    ),
    expect: { outlines: ["walk"], arrive: "08:04", first: "walk" },
  },
  {
    name: "Rail expired fallback",
    exclude: ["rail"],
    query: query(LISA, KLCC),
    expect: { outlines: [], arrive: "09:05", excludedFeeds: ["rail"], allowedModes: ["bus", "feeder", "ktm"], minItineraries: 1 },
  },
  {
    // Spec §4.4's Lisa → KLCC route: T816 to bus stop 12000750 (MRT Phileo Damansara), walk to rail:KG12, KG to Pasar
    // Seni or Muzium Negara, change, KJ to KLCC. Rapid KL buses left out, as in 14/05's live case.
    name: "Hotel Lisa De Inn → KLCC, feeder and rail only",
    query: { ...query(LISA, KLCC), modes: ["feeder", "lrt", "mrt", "monorail"] },
    expect: { outlines: ["T816>walk>KG>walk>KJ"], arrive: "09:16", first: "T816>walk>KG>walk>KJ", allowedModes: ["feeder", "lrt", "mrt", "monorail"] },
  },
];
