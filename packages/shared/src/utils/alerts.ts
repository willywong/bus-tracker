import type {
  AlertCause,
  AlertEffect,
  AlertSeverity,
  ServiceAlert,
  StopTimeUpdate,
  TripUpdateRecord,
} from "../types/bus.js";
import type {
  DecodedAlert,
  DecodedFeed,
  DecodedTranslatedString,
  DecodedTripUpdate,
} from "./protobuf.js";

const ALERT_CAUSES = new Set<string>([
  "UNKNOWN_CAUSE",
  "OTHER_CAUSE",
  "TECHNICAL_PROBLEM",
  "STRIKE",
  "DEMONSTRATION",
  "ACCIDENT",
  "HOLIDAY",
  "WEATHER",
  "MAINTENANCE",
  "CONSTRUCTION",
  "POLICE_ACTIVITY",
  "MEDICAL_EMERGENCY",
]);

const ALERT_EFFECTS = new Set<string>([
  "NO_SERVICE",
  "REDUCED_SERVICE",
  "SIGNIFICANT_DELAYS",
  "DETOUR",
  "ADDITIONAL_SERVICE",
  "MODIFIED_SERVICE",
  "OTHER_EFFECT",
  "UNKNOWN_EFFECT",
  "STOP_MOVED",
  "NO_EFFECT",
  "ACCESSIBILITY_ISSUE",
]);

const ALERT_SEVERITIES = new Set<string>([
  "UNKNOWN_SEVERITY",
  "INFO",
  "WARNING",
  "SEVERE",
]);

/**
 * Picks a single translation string from a GTFS-RT TranslatedString,
 * preferring the requested language, then "en", then the first entry.
 */
function pickTranslated(
  ts: DecodedTranslatedString | undefined,
  preferred = "en",
): string | null {
  if (!ts || !ts.translation || ts.translation.length === 0) return null;
  const wanted = ts.translation.find(
    (t) => t.language?.toLowerCase().startsWith(preferred.toLowerCase()) && t.text,
  );
  if (wanted?.text) return wanted.text;
  const english = ts.translation.find(
    (t) => (!t.language || t.language.toLowerCase().startsWith("en")) && t.text,
  );
  if (english?.text) return english.text;
  return ts.translation[0].text ?? null;
}

function toAlert(id: string, raw: DecodedAlert): ServiceAlert {
  const affectedRouteIds: string[] = [];
  const affectedStopIds: string[] = [];
  const affectedTripIds: string[] = [];
  for (const e of raw.informed_entity ?? []) {
    if (e.route_id) affectedRouteIds.push(e.route_id);
    if (e.stop_id) affectedStopIds.push(e.stop_id);
    if (e.trip?.trip_id) affectedTripIds.push(e.trip.trip_id);
  }
  return {
    id,
    headerText: pickTranslated(raw.header_text),
    descriptionText: pickTranslated(raw.description_text),
    url: pickTranslated(raw.url),
    cause:
      raw.cause && ALERT_CAUSES.has(raw.cause)
        ? (raw.cause as AlertCause)
        : null,
    effect:
      raw.effect && ALERT_EFFECTS.has(raw.effect)
        ? (raw.effect as AlertEffect)
        : null,
    severity:
      raw.severity_level && ALERT_SEVERITIES.has(raw.severity_level)
        ? (raw.severity_level as AlertSeverity)
        : null,
    activePeriod: (raw.active_period ?? []).map((p) => ({
      startMs: typeof p.start === "number" ? p.start * 1000 : null,
      endMs: typeof p.end === "number" ? p.end * 1000 : null,
    })),
    affectedRouteIds,
    affectedStopIds,
    affectedTripIds,
  };
}

/**
 * Extracts all `ServiceAlert`s from an Alerts feed. Caller can filter to
 * a subset of route/stop ids afterward.
 */
export function entitiesToAlerts(feed: DecodedFeed): ServiceAlert[] {
  const out: ServiceAlert[] = [];
  for (const entity of feed.entity) {
    if (entity.is_deleted || !entity.alert) continue;
    out.push(toAlert(entity.id, entity.alert));
  }
  return out;
}

/**
 * Filters alerts to ones affecting the provided route_ids, route codes or
 * stop ids. An alert with no `informed_entity` is considered system-wide and
 * always included.
 */
export function filterAlertsForScope(
  alerts: readonly ServiceAlert[],
  scope: {
    routeIds?: ReadonlySet<string>;
    routeCodes?: ReadonlySet<string>;
    stopIds?: ReadonlySet<string>;
  },
): ServiceAlert[] {
  const { routeIds, routeCodes, stopIds } = scope;
  return alerts.filter((a) => {
    const systemWide =
      a.affectedRouteIds.length === 0 &&
      a.affectedStopIds.length === 0 &&
      a.affectedTripIds.length === 0;
    if (systemWide) return true;
    for (const r of a.affectedRouteIds) {
      if (routeIds?.has(r)) return true;
      if (routeCodes?.has(r)) return true;
    }
    for (const s of a.affectedStopIds) if (stopIds?.has(s)) return true;
    return false;
  });
}

function toStopTimeUpdate(raw: {
  stop_sequence?: number;
  stop_id?: string;
  arrival?: { delay?: number; time?: number };
  departure?: { delay?: number; time?: number };
  schedule_relationship?: string;
}): StopTimeUpdate {
  return {
    stopSequence:
      typeof raw.stop_sequence === "number" && raw.stop_sequence >= 0
        ? raw.stop_sequence
        : undefined,
    stopId: raw.stop_id || undefined,
    arrivalDelaySec:
      typeof raw.arrival?.delay === "number" ? raw.arrival.delay : undefined,
    arrivalTimeMs:
      typeof raw.arrival?.time === "number"
        ? raw.arrival.time * 1000
        : undefined,
    departureDelaySec:
      typeof raw.departure?.delay === "number"
        ? raw.departure.delay
        : undefined,
    departureTimeMs:
      typeof raw.departure?.time === "number"
        ? raw.departure.time * 1000
        : undefined,
    scheduleRelationship: raw.schedule_relationship,
  };
}

function toTripUpdateRecord(
  raw: DecodedTripUpdate,
): TripUpdateRecord | null {
  const tripId = raw.trip?.trip_id;
  if (!tripId) return null;
  return {
    tripId,
    routeId: raw.trip?.route_id,
    vehicleId: raw.vehicle?.id ?? raw.vehicle?.label,
    delaySec: typeof raw.delay === "number" ? raw.delay : undefined,
    timestamp:
      typeof raw.timestamp === "number" ? raw.timestamp * 1000 : undefined,
    stopTimeUpdates: (raw.stop_time_update ?? []).map(toStopTimeUpdate),
  };
}

export function entitiesToTripUpdates(feed: DecodedFeed): TripUpdateRecord[] {
  const out: TripUpdateRecord[] = [];
  for (const entity of feed.entity) {
    if (entity.is_deleted || !entity.trip_update) continue;
    const rec = toTripUpdateRecord(entity.trip_update);
    if (rec) out.push(rec);
  }
  return out;
}
