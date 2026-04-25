import { strFromU8, unzipSync } from "fflate";
import type {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsFareAttribute,
  GtfsFareRule,
  GtfsRoute,
  GtfsShapePoint,
  GtfsStop,
  GtfsStopTime,
  GtfsTransfer,
  GtfsTrip,
} from "../types/gtfs.js";

export interface ParsedGtfs {
  routes: GtfsRoute[];
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  shapes: GtfsShapePoint[];
  calendar: GtfsCalendar[];
  calendarDates: GtfsCalendarDate[];
  fareAttributes: GtfsFareAttribute[];
  fareRules: GtfsFareRule[];
  transfers: GtfsTransfer[];
}

const BOM = "\uFEFF";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else if (c === '"' && cur.length === 0) {
      inQuotes = true;
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

export function parseCsv(text: string): Array<Record<string, string>> {
  let t = text;
  if (t.startsWith(BOM)) t = t.slice(1);
  const lines = t.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (fields[j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

function num(s: string | undefined): number {
  if (s === undefined || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseGtfsZip(buffer: ArrayBuffer | Uint8Array): ParsedGtfs {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = unzipSync(bytes);
  const read = (name: string): Array<Record<string, string>> => {
    const f = files[name];
    if (!f) return [];
    return parseCsv(strFromU8(f));
  };

  const routes: GtfsRoute[] = read("routes.txt").map((r) => ({
    route_id: r.route_id,
    route_short_name: r.route_short_name,
    route_long_name: r.route_long_name || undefined,
  }));

  const stops: GtfsStop[] = read("stops.txt").map((r) => ({
    stop_id: r.stop_id,
    stop_name: r.stop_name,
    stop_lat: num(r.stop_lat),
    stop_lon: num(r.stop_lon),
    wheelchair_boarding:
      r.wheelchair_boarding === "1"
        ? 1
        : r.wheelchair_boarding === "2"
          ? 2
          : r.wheelchair_boarding === "0"
            ? 0
            : undefined,
  }));

  const trips: GtfsTrip[] = read("trips.txt").map((r) => ({
    route_id: r.route_id,
    service_id: r.service_id,
    trip_id: r.trip_id,
    shape_id: r.shape_id || undefined,
    direction_id:
      r.direction_id === "1" ? 1 : r.direction_id === "0" ? 0 : undefined,
    trip_headsign: r.trip_headsign || undefined,
  }));

  const stopTimes: GtfsStopTime[] = read("stop_times.txt").map((r) => ({
    trip_id: r.trip_id,
    stop_id: r.stop_id,
    stop_sequence: num(r.stop_sequence),
    arrival_time: r.arrival_time || undefined,
    departure_time: r.departure_time || undefined,
  }));

  const shapes: GtfsShapePoint[] = read("shapes.txt").map((r) => ({
    shape_id: r.shape_id,
    shape_pt_lat: num(r.shape_pt_lat),
    shape_pt_lon: num(r.shape_pt_lon),
    shape_pt_sequence: num(r.shape_pt_sequence),
  }));

  const calendar: GtfsCalendar[] = read("calendar.txt").map((r) => ({
    service_id: r.service_id,
    monday: r.monday === "1",
    tuesday: r.tuesday === "1",
    wednesday: r.wednesday === "1",
    thursday: r.thursday === "1",
    friday: r.friday === "1",
    saturday: r.saturday === "1",
    sunday: r.sunday === "1",
    start_date: r.start_date,
    end_date: r.end_date,
  }));

  const calendarDates: GtfsCalendarDate[] = [];
  for (const r of read("calendar_dates.txt")) {
    const t =
      r.exception_type === "1" ? 1 : r.exception_type === "2" ? 2 : null;
    if (t === null || !r.service_id || !r.date) continue;
    calendarDates.push({
      service_id: r.service_id,
      date: r.date,
      exception_type: t as 1 | 2,
    });
  }

  const fareAttributes: GtfsFareAttribute[] = read("fare_attributes.txt").map(
    (r) => ({
      fare_id: r.fare_id,
      price: num(r.price),
      currency_type: r.currency_type,
      payment_method:
        r.payment_method === "1" ? 1 : r.payment_method === "0" ? 0 : undefined,
      transfers:
        r.transfers === "" || r.transfers === undefined
          ? null
          : (num(r.transfers) as 0 | 1 | 2),
      transfer_duration:
        r.transfer_duration === "" || r.transfer_duration === undefined
          ? undefined
          : num(r.transfer_duration),
    }),
  );

  const fareRules: GtfsFareRule[] = read("fare_rules.txt").map((r) => ({
    fare_id: r.fare_id,
    route_id: r.route_id || undefined,
    origin_id: r.origin_id || undefined,
    destination_id: r.destination_id || undefined,
    contains_id: r.contains_id || undefined,
  }));

  const transfers: GtfsTransfer[] = [];
  for (const r of read("transfers.txt")) {
    const t = num(r.transfer_type);
    if (t !== 0 && t !== 1 && t !== 2 && t !== 3) continue;
    if (!r.from_stop_id || !r.to_stop_id) continue;
    const entry: GtfsTransfer = {
      from_stop_id: r.from_stop_id,
      to_stop_id: r.to_stop_id,
      transfer_type: t as 0 | 1 | 2 | 3,
    };
    if (r.min_transfer_time !== "" && r.min_transfer_time !== undefined) {
      entry.min_transfer_time = num(r.min_transfer_time);
    }
    transfers.push(entry);
  }

  return {
    routes,
    stops,
    trips,
    stopTimes,
    shapes,
    calendar,
    calendarDates,
    fareAttributes,
    fareRules,
    transfers,
  };
}
