import { strFromU8, unzipSync } from "fflate";
import type {
  GtfsCalendar,
  GtfsRoute,
  GtfsShapePoint,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
} from "../types/gtfs.js";

export interface ParsedGtfs {
  routes: GtfsRoute[];
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  shapes: GtfsShapePoint[];
  calendar: GtfsCalendar[];
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
  }));

  const trips: GtfsTrip[] = read("trips.txt").map((r) => ({
    route_id: r.route_id,
    service_id: r.service_id,
    trip_id: r.trip_id,
    shape_id: r.shape_id || undefined,
    direction_id:
      r.direction_id === "1" ? 1 : r.direction_id === "0" ? 0 : undefined,
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

  return { routes, stops, trips, stopTimes, shapes, calendar };
}
