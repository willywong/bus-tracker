import type {
  BundledRoute,
  GtfsFrequency,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
  PolylinePoint,
  T816Bundle,
} from "../types/gtfs.js";
import { routeCodeOf, routeKeyFor, type BusCategory } from "./categories.js";
import type { ParsedGtfs } from "./gtfs-parser.js";
import { gtfsTimeToSeconds } from "./gtfs-time.js";

export const T816_TARGET_CODES = [
  "T816",
  "T815",
  "T786",
  "PJ01",
  "PJ02",
] as const;
export type T816TargetCode = (typeof T816_TARGET_CODES)[number];

/** Whether `route` is the one `code` names (a route key when `category` is given). */
export function matchesCode(
  route: ParsedGtfs["routes"][number],
  code: string,
  category: BusCategory | undefined,
): boolean {
  const norm = (s: string | undefined) => (s ?? "").trim().toUpperCase();
  const target = code.trim().toUpperCase();
  if (category) return norm(routeKeyFor(category, routeCodeOf(route))) === target;
  return (
    norm(route.route_short_name) === target ||
    norm(route.route_long_name) === target
  );
}

export interface FilterToRoutesOptions {
  /**
   * Feed the routes come from. Codes are then matched as route keys
   * (`routeKeyFor`) and the bundle is tagged with the category. Omit for the
   * legacy feeder-only behaviour (match short or long name).
   */
  category?: BusCategory;
}

/**
 * Cuts the rows for `codes` out of a parsed feed. Trips without stop_times
 * are dropped (data.gov.my withholds ~2% of Rapid KL's), and headway-based
 * trips (frequencies.txt) are expanded into one concrete trip per departure,
 * so everything downstream sees a plain timetable.
 */
export function filterToRoutes(
  parsed: ParsedGtfs,
  codes: readonly string[],
  now: () => number = Date.now,
  opts: FilterToRoutesOptions = {},
): T816Bundle {
  const matchedRoutes: BundledRoute[] = [];
  const matchedRouteIds = new Set<string>();

  for (const code of codes) {
    // A feed may split one route code over several route_ids; keep them all.
    for (const r of parsed.routes) {
      if (!matchesCode(r, code, opts.category)) continue;
      const id = String(r.route_id);
      if (matchedRouteIds.has(id)) continue;
      matchedRouteIds.add(id);
      matchedRoutes.push({
        route_id: id,
        code: opts.category ? routeKeyFor(opts.category, routeCodeOf(r)) : code,
        long_name: r.route_long_name,
      });
    }
  }

  const routeTrips = parsed.trips.filter((t) => matchedRouteIds.has(t.route_id));
  const routeTripIds = new Set(routeTrips.map((t) => t.trip_id));
  const routeStopTimes = parsed.stopTimes.filter((st) => routeTripIds.has(st.trip_id));
  const timedTripIds = new Set(routeStopTimes.map((st) => st.trip_id));
  const { trips, stopTimes } = expandFrequencies(
    routeTrips.filter((t) => timedTripIds.has(t.trip_id)),
    routeStopTimes,
    parsed.frequencies ?? [],
  );

  const shapeIds = new Set(
    trips
      .map((t) => t.shape_id)
      .filter((s): s is string => typeof s === "string" && s.length > 0),
  );
  const stopIds = new Set(stopTimes.map((st) => st.stop_id));

  const stopsById = new Map<string, GtfsStop>();
  for (const s of parsed.stops) {
    if (stopIds.has(s.stop_id)) stopsById.set(s.stop_id, s);
  }
  const stops = Array.from(stopsById.values());

  const shapes: Record<string, PolylinePoint[]> = {};
  for (const p of parsed.shapes) {
    if (!shapeIds.has(p.shape_id)) continue;
    const arr = shapes[p.shape_id] ?? (shapes[p.shape_id] = []);
    arr.push({
      lat: p.shape_pt_lat,
      lng: p.shape_pt_lon,
      seq: p.shape_pt_sequence,
    });
  }
  for (const k of Object.keys(shapes)) {
    shapes[k].sort((a, b) => a.seq - b.seq);
  }

  const serviceIds = new Set(trips.map((t) => t.service_id));
  const calendar = parsed.calendar.filter((c) => serviceIds.has(c.service_id));
  const calendarDates = parsed.calendarDates.filter((c) =>
    serviceIds.has(c.service_id),
  );

  // Fares are route-scoped via fare_rules.route_id. Attributes are kept only
  // for fare_ids referenced by surviving rules.
  const routeFareRules = parsed.fareRules.filter(
    (r) => !r.route_id || matchedRouteIds.has(r.route_id),
  );
  const fareIds = new Set(routeFareRules.map((r) => r.fare_id));
  const fareAttributes = parsed.fareAttributes.filter((a) =>
    fareIds.has(a.fare_id),
  );

  const transfers = parsed.transfers.filter(
    (t) => stopIds.has(t.from_stop_id) && stopIds.has(t.to_stop_id),
  );

  return {
    generatedAt: now(),
    ...(opts.category ? { category: opts.category } : {}),
    routes: matchedRoutes,
    stops,
    trips,
    stopTimes,
    shapes,
    calendar,
    calendarDates: calendarDates.length > 0 ? calendarDates : undefined,
    fareAttributes: fareAttributes.length > 0 ? fareAttributes : undefined,
    fareRules: routeFareRules.length > 0 ? routeFareRules : undefined,
    transfers: transfers.length > 0 ? transfers : undefined,
  };
}

/** Separates a frequency template's trip_id from the instance's start time. */
export const FREQUENCY_INSTANCE_SEPARATOR = "@";

/**
 * Id of one run of a headway-based template trip: `<template>@HH:MM`, or
 * `@HH:MM:SS` when the start isn't on a whole minute (so two runs can't
 * share an id). Realtime vehicles on these trips are given the same shape,
 * built from GTFS-RT `trip.start_time`.
 */
export function frequencyInstanceId(templateId: string, startSeconds: number): string {
  const t = secondsToGtfsTime(startSeconds);
  return `${templateId}${FREQUENCY_INSTANCE_SEPARATOR}${t.endsWith(":00") ? t.slice(0, -3) : t}`;
}

/**
 * Splits a frequency instance id (`kl:weekday_U4000_x_0@07:45`) into its
 * template trip_id and start time in seconds, or null for an ordinary trip.
 */
export function parseFrequencyInstanceId(
  tripId: string,
): { templateId: string; startSeconds: number } | null {
  const i = tripId.lastIndexOf(FREQUENCY_INSTANCE_SEPARATOR);
  if (i <= 0) return null;
  const m = /^(\d{2,3}):(\d{2})(?::(\d{2}))?$/.exec(tripId.slice(i + 1));
  if (!m) return null;
  return {
    templateId: tripId.slice(0, i),
    startSeconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0),
  };
}

/** Template trip_id of a frequency instance id, or null for an ordinary trip. */
export function frequencyTemplateId(tripId: string): string | null {
  return parseFrequencyInstanceId(tripId)?.templateId ?? null;
}

function secondsToGtfsTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/**
 * Replaces each trip that has frequencies.txt windows with one trip per
 * departure. The template's stop_times give the offsets from its first stop.
 *
 * Windows are expanded with an inclusive end (start ≤ t ≤ end). Prasarana's
 * windows are laid out that way: route 400 runs 05:30–07:30 every 15 min,
 * then 07:50–08:10 every 20 min, and only an inclusive 07:30 keeps the
 * 20-minute gap into the next window.
 */
export function expandFrequencies(
  trips: readonly GtfsTrip[],
  stopTimes: readonly GtfsStopTime[],
  frequencies: readonly GtfsFrequency[],
): { trips: GtfsTrip[]; stopTimes: GtfsStopTime[] } {
  if (frequencies.length === 0) return { trips: [...trips], stopTimes: [...stopTimes] };
  const windowsByTrip = new Map<string, GtfsFrequency[]>();
  for (const f of frequencies) {
    const arr = windowsByTrip.get(f.trip_id) ?? [];
    arr.push(f);
    windowsByTrip.set(f.trip_id, arr);
  }
  const stByTrip = new Map<string, GtfsStopTime[]>();
  for (const st of stopTimes) {
    const arr = stByTrip.get(st.trip_id) ?? [];
    arr.push(st);
    stByTrip.set(st.trip_id, arr);
  }

  const outTrips: GtfsTrip[] = [];
  const outStopTimes: GtfsStopTime[] = [];
  for (const trip of trips) {
    const windows = windowsByTrip.get(trip.trip_id);
    const sts = stByTrip.get(trip.trip_id) ?? [];
    if (!windows) {
      outTrips.push(trip);
      outStopTimes.push(...sts);
      continue;
    }
    const ordered = [...sts].sort((a, b) => a.stop_sequence - b.stop_sequence);
    const base =
      gtfsTimeToSeconds(ordered[0]?.departure_time) ??
      gtfsTimeToSeconds(ordered[0]?.arrival_time);
    if (base == null) continue;
    const offsets = ordered.map((st) => ({
      st,
      arr: offsetOf(st.arrival_time, base),
      dep: offsetOf(st.departure_time, base),
    }));
    const starts = new Set<number>();
    for (const w of windows) {
      const from = gtfsTimeToSeconds(w.start_time);
      const to = gtfsTimeToSeconds(w.end_time);
      if (from == null || to == null || w.headway_secs <= 0) continue;
      for (let t = from; t <= to; t += w.headway_secs) starts.add(t);
    }
    for (const start of [...starts].sort((a, b) => a - b)) {
      const id = frequencyInstanceId(trip.trip_id, start);
      outTrips.push({ ...trip, trip_id: id });
      for (const o of offsets) {
        outStopTimes.push({
          ...o.st,
          trip_id: id,
          arrival_time: o.arr == null ? undefined : secondsToGtfsTime(start + o.arr),
          departure_time: o.dep == null ? undefined : secondsToGtfsTime(start + o.dep),
        });
      }
    }
  }
  return { trips: outTrips, stopTimes: outStopTimes };
}

function offsetOf(t: string | undefined, base: number): number | null {
  const s = gtfsTimeToSeconds(t);
  return s == null ? null : s - base;
}

/** @deprecated Use `filterToRoutes` and pass an explicit `codes` array. */
export const filterToT816 = filterToRoutes;
