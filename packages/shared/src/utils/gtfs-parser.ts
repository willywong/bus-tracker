import { DecodeUTF8, strFromU8, unzipSync } from "fflate";
import type {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsFareAttribute,
  GtfsFareRule,
  GtfsFrequency,
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
  /** Empty for feeds without frequencies.txt (feeder, Penang). */
  frequencies: GtfsFrequency[];
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

/**
 * Splits one CSV line. Most GTFS lines have no quotes, and a native
 * `split` is far faster than the character loop on Hermes (no JIT) —
 * stop_times.txt runs to 300k lines for Penang.
 */
function splitCsvLine(line: string): string[] {
  return line.indexOf('"') === -1 ? line.split(",") : parseCsvLine(line);
}

export interface CsvTable {
  headers: string[];
  /** Raw (untrimmed) fields per data row. */
  rows: string[][];
  /** Column index for a header, or -1. */
  col(name: string): number;
}

export function parseCsvTable(text: string): CsvTable {
  let t = text;
  if (t.startsWith(BOM)) t = t.slice(1);
  const lines = t.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && lines[first].length === 0) first++;
  const headers = first < lines.length ? splitCsvLine(lines[first]).map((h) => h.trim()) : [];
  const rows: string[][] = [];
  for (let i = first + 1; i < lines.length; i++) {
    if (lines[i].length > 0) rows.push(splitCsvLine(lines[i]));
  }
  return { headers, rows, col: (name) => headers.indexOf(name) };
}

/**
 * Calls `onLine` for each non-empty line of `text` from `from`, without its
 * line ending. Unless `final`, a last line with no "\n" yet is left alone;
 * returns where it starts (`text.length` when nothing is left).
 */
function forEachLine(
  text: string,
  from: number,
  final: boolean,
  onLine: (line: string) => void,
): number {
  let start = from;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf("\n", start);
    if (end === -1) {
      if (!final) return start;
      end = n;
    }
    const stop = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    if (stop > start) onLine(text.slice(start, stop));
    start = end + 1;
  }
  return n;
}

/**
 * Calls `onRow` with the raw fields of each data row (and the trimmed
 * headers), one line at a time. Unlike {@link parseCsvTable} it never holds
 * every line or every row at once, so a 300k-line stop_times.txt costs one
 * short-lived array per row rather than two arrays of 300k.
 */
export function forEachCsvRow(
  text: string,
  onRow: (fields: string[], headers: readonly string[]) => void,
): void {
  let headers: string[] | null = null;
  forEachLine(text, text.startsWith(BOM) ? 1 : 0, true, (line) => {
    if (headers === null) headers = splitCsvLine(line).map((h) => h.trim());
    else onRow(splitCsvLine(line), headers);
  });
}

/** {@link forEachCsvRow} with the named columns resolved to indexes once. */
export function scanCsvColumns(
  text: string,
  columns: readonly string[],
  onRow: (row: string[], col: readonly number[]) => void,
): void {
  let col: number[] | null = null;
  forEachCsvRow(text, (row, headers) => {
    col ??= columns.map((c) => headers.indexOf(c));
    onRow(row, col);
  });
}

/** UTF-8 bytes decoded and scanned per step of {@link scanCsvColumnsSteps}. */
const SCAN_STEP_BYTES = 64 * 1024;

/**
 * {@link scanCsvColumns} over a file's UTF-8 bytes, in any number of chunks,
 * as a generator that yields after every 64 KB: a few milliseconds of work
 * on Hermes, so the caller can let the UI run between steps. Decodes as it
 * goes; the file never becomes one big string.
 */
export function* scanCsvColumnsSteps(
  chunks: Iterable<Uint8Array>,
  columns: readonly string[],
  onRow: (row: string[], col: readonly number[]) => void,
): Generator<void, void, void> {
  let col: number[] | null = null;
  const onLine = (line: string) => {
    if (col === null) {
      const headers = splitCsvLine(line).map((h) => h.trim());
      col = columns.map((c) => headers.indexOf(c));
    } else onRow(splitCsvLine(line), col);
  };
  let decoded = "";
  const decoder = new DecodeUTF8((s) => {
    decoded += s;
  });
  let carry = "";
  let atStart = true;
  const scan = (final: boolean) => {
    const text = carry + decoded;
    decoded = "";
    let from = 0;
    if (atStart && text.length > 0) {
      atStart = false;
      if (text.startsWith(BOM)) from = 1;
    }
    const rest = forEachLine(text, from, final, onLine);
    carry = rest < text.length ? text.slice(rest) : "";
  };
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += SCAN_STEP_BYTES) {
      decoder.push(chunk.subarray(i, i + SCAN_STEP_BYTES));
      scan(false);
      yield;
    }
  }
  decoder.push(new Uint8Array(0), true);
  scan(true);
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const { headers, rows } = parseCsvTable(text);
  return rows.map((fields) => {
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (fields[j] ?? "").trim();
    }
    return row;
  });
}

/** Trimmed field `i` of `row`, or "" when the column is missing. */
function field(row: string[], i: number): string {
  return i < 0 ? "" : (row[i] ?? "").trim();
}

function num(s: string | undefined): number {
  if (s === undefined || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export interface ParseGtfsOptions {
  /**
   * Keep only the routes this accepts, with just their trips, stop_times,
   * shapes and frequencies. The rest (stops, calendars, fares, transfers) is
   * small and kept whole; the bundle cut picks from it. Cutting while
   * parsing means a 300k-row feed never becomes 300k objects to find one
   * route's few thousand.
   */
  keepRoute?: (route: GtfsRoute) => boolean;
}

export function parseGtfsZip(
  buffer: ArrayBuffer | Uint8Array,
  opts: ParseGtfsOptions = {},
): ParsedGtfs {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = unzipSync(bytes);
  const read = (name: string): Array<Record<string, string>> => {
    const f = files[name];
    if (!f) return [];
    return parseCsv(strFromU8(f));
  };
  // The two big files are scanned a line at a time, columns mapped directly,
  // and their bytes released as soon as they're read.
  const scan = (
    name: string,
    columns: readonly string[],
    onRow: (row: string[], col: readonly number[]) => void,
  ): void => {
    const f = files[name];
    if (!f) return;
    delete files[name];
    scanCsvColumns(strFromU8(f), columns, onRow);
  };

  let routes: GtfsRoute[] = read("routes.txt").map((r) => ({
    route_id: r.route_id,
    route_short_name: r.route_short_name,
    route_long_name: r.route_long_name || undefined,
  }));
  if (opts.keepRoute) routes = routes.filter(opts.keepRoute);
  const keptRouteIds = opts.keepRoute ? new Set(routes.map((r) => String(r.route_id))) : null;

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

  let trips: GtfsTrip[] = read("trips.txt").map((r) => ({
    route_id: r.route_id,
    service_id: r.service_id,
    trip_id: r.trip_id,
    shape_id: r.shape_id || undefined,
    direction_id:
      r.direction_id === "1" ? 1 : r.direction_id === "0" ? 0 : undefined,
    trip_headsign: r.trip_headsign || undefined,
  }));
  if (keptRouteIds) trips = trips.filter((t) => keptRouteIds.has(t.route_id));
  const keptTripIds = keptRouteIds ? new Set(trips.map((t) => t.trip_id)) : null;
  const keptShapeIds = keptRouteIds
    ? new Set(trips.map((t) => t.shape_id).filter((id): id is string => !!id))
    : null;

  const stopTimes: GtfsStopTime[] = [];
  scan(
    "stop_times.txt",
    ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
    (r, [trip, stop, seq, arr, dep]) => {
      const tripId = field(r, trip);
      if (keptTripIds && !keptTripIds.has(tripId)) return;
      stopTimes.push({
        trip_id: tripId,
        stop_id: field(r, stop),
        stop_sequence: num(field(r, seq)),
        arrival_time: field(r, arr) || undefined,
        departure_time: field(r, dep) || undefined,
      });
    },
  );

  const shapes: GtfsShapePoint[] = [];
  scan(
    "shapes.txt",
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
    (r, [id, lat, lon, seq]) => {
      const shapeId = field(r, id);
      if (keptShapeIds && !keptShapeIds.has(shapeId)) return;
      shapes.push({
        shape_id: shapeId,
        shape_pt_lat: num(field(r, lat)),
        shape_pt_lon: num(field(r, lon)),
        shape_pt_sequence: num(field(r, seq)),
      });
    },
  );

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

  const frequencies: GtfsFrequency[] = [];
  for (const r of read("frequencies.txt")) {
    const headway = num(r.headway_secs);
    if (!r.trip_id || !r.start_time || !r.end_time || headway <= 0) continue;
    if (keptTripIds && !keptTripIds.has(r.trip_id)) continue;
    frequencies.push({
      trip_id: r.trip_id,
      start_time: r.start_time,
      end_time: r.end_time,
      headway_secs: headway,
      exact_times: r.exact_times === "1" ? 1 : 0,
    });
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
    frequencies,
  };
}
