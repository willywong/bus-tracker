import { strFromU8, strToU8 } from "fflate";

import { NETWORK_VERSION, type TransitNetwork } from "./network.js";

/**
 * Binary network format (plan 12/05). All integers are little-endian.
 *
 *   0   magic     'BBTN'
 *   4   format    u16  {@link NETWORK_FORMAT_VERSION}
 *   6   sections  u16  N
 *   8   reserved  u32  0
 *   12  table     N × 16 bytes: tag (4 ASCII), kind u8, pad 3, offset u32, length u32
 *   …   data      each section 8-byte aligned, zero-padded
 *
 * Typed arrays are stored raw and decoded as views over the blob. A string
 * section is `u32 count`, `(count + 1) × u32` byte offsets, then the strings
 * as UTF-8 joined with NUL.
 */
export const NETWORK_MAGIC = "BBTN";
/** Bump on any change to the layout or the section list. */
export const NETWORK_FORMAT_VERSION = 1;

/** A blob that is not a readable network of this version. Treat as "no blob" and rebuild. */
export class NetworkFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkFormatError";
  }
}

if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error("transit/serialize: big-endian platforms are not supported");
}

const KIND = { i32: 1, f32: 2, u8: 3, str: 4, json: 5 } as const;
type Kind = (typeof KIND)[keyof typeof KIND];

const HEADER_BYTES = 12;
const ENTRY_BYTES = 16;
const SEP = "\u0000";

/**
 * Every section, in blob order: `[tag, path, kind]`. `grid.*` paths other
 * than `cellDeg` are the grid's columns ({@link GridColumns}), not fields of
 * `TransitNetwork`. Append only within a format version.
 */
const SECTIONS = [
  ["META", "meta", KIND.json],
  ["STNS", "stations", KIND.json],
  ["SID ", "stops.id", KIND.str],
  ["SNAM", "stops.name", KIND.str],
  ["SLAT", "stops.lat", KIND.f32],
  ["SLON", "stops.lon", KIND.f32],
  ["SFED", "stops.feed", KIND.u8],
  ["SSTN", "stops.station", KIND.i32],
  ["RID ", "routes.id", KIND.str],
  ["RLAB", "routes.label", KIND.str],
  ["RLNG", "routes.longName", KIND.str],
  ["RMOD", "routes.mode", KIND.u8],
  ["RCOL", "routes.color", KIND.str],
  ["RTXC", "routes.textColor", KIND.str],
  ["RFED", "routes.feed", KIND.u8],
  ["RSHP", "routes.shapeId", KIND.str],
  ["PRTE", "patterns.route", KIND.i32],
  ["PHED", "patterns.headsign", KIND.str],
  ["PSST", "patterns.stopStart", KIND.i32],
  ["PSLN", "patterns.stopLen", KIND.i32],
  ["PSTP", "patterns.stops", KIND.i32],
  ["PTST", "patterns.tripStart", KIND.i32],
  ["PTLN", "patterns.tripLen", KIND.i32],
  ["PTMS", "patterns.timeStart", KIND.i32],
  ["PARR", "patterns.arr", KIND.i32],
  ["PDEP", "patterns.dep", KIND.i32],
  ["PKEY", "patterns.tripKey", KIND.str],
  ["PFST", "patterns.freqStart", KIND.i32],
  ["PFLN", "patterns.freqLen", KIND.i32],
  ["FSTA", "patterns.fStart", KIND.i32],
  ["FEND", "patterns.fEnd", KIND.i32],
  ["FHWY", "patterns.fHeadway", KIND.i32],
  ["PROF", "patterns.runOffset", KIND.i32],
  ["XSTA", "stopRoutes.start", KIND.i32],
  ["XLEN", "stopRoutes.len", KIND.i32],
  ["XPAT", "stopRoutes.pattern", KIND.i32],
  ["XPOS", "stopRoutes.pos", KIND.i32],
  ["TSTA", "transfers.start", KIND.i32],
  ["TLEN", "transfers.len", KIND.i32],
  ["TTO ", "transfers.to", KIND.i32],
  ["TSEC", "transfers.seconds", KIND.i32],
  ["TKND", "transfers.kind", KIND.u8],
  // JSON, not f32: an f32 0.005 would move cell boundaries in `gridKey`.
  ["GCEL", "grid.cellDeg", KIND.json],
  ["GLAT", "grid.lat", KIND.i32],
  ["GLON", "grid.lon", KIND.i32],
  ["GSTA", "grid.start", KIND.i32],
  ["GLEN", "grid.len", KIND.i32],
  ["GSTP", "grid.stops", KIND.i32],
] as const satisfies ReadonlyArray<readonly [string, string, Kind]>;

/** `grid.cells` as CSR over keys sorted ascending; a key is `lat * 1_000_000 + lon`. */
interface GridColumns { cellDeg: number; lat: Int32Array; lon: Int32Array; start: Int32Array; len: Int32Array; stops: Int32Array }

const GRID_KEY_SPLIT = 1_000_000;

function gridColumns(grid: TransitNetwork["grid"]): GridColumns {
  const keys = [...grid.cells.keys()].sort((a, b) => a - b);
  const lat = new Int32Array(keys.length);
  const lon = new Int32Array(keys.length);
  const start = new Int32Array(keys.length);
  const len = new Int32Array(keys.length);
  let total = 0;
  for (const cell of grid.cells.values()) total += cell.length;
  const stops = new Int32Array(total);
  let at = 0;
  for (let i = 0; i < keys.length; i++) {
    const cell = grid.cells.get(keys[i])!;
    lat[i] = Math.floor(keys[i] / GRID_KEY_SPLIT);
    lon[i] = keys[i] - lat[i] * GRID_KEY_SPLIT;
    start[i] = at;
    len[i] = cell.length;
    stops.set(cell, at);
    at += cell.length;
  }
  return { cellDeg: grid.cellDeg, lat, lon, start, len, stops };
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  let v: unknown = root;
  for (const k of path.split(".")) v = (v as Record<string, unknown>)[k];
  return v;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let o = root;
  for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {}) as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

const align8 = (n: number): number => (n + 7) & ~7;

/** A string section's bytes: count, offsets, then the NUL-joined UTF-8 text. */
function encodeStrings(tag: string, list: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let textLen = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i] ?? "";
    if (s.includes(SEP)) throw new Error(`encodeNetwork: ${tag.trim()}[${i}] contains NUL`);
    const u = strToU8(s);
    parts.push(u);
    textLen += u.length + (i < list.length - 1 ? 1 : 0);
  }
  const head = 4 * (list.length + 2);
  const out = new Uint8Array(head + textLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, list.length, true);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    dv.setUint32(4 * (i + 1), at, true);
    out.set(parts[i], head + at);
    at += parts[i].length + 1; // the NUL separator; the buffer is already zeroed
  }
  dv.setUint32(4 * (list.length + 1), textLen, true);
  return out;
}

function decodeStrings(tag: string, bytes: Uint8Array): string[] {
  if (bytes.byteLength < 4) throw new NetworkFormatError(`${tag}: string section too short`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(0, true);
  const head = 4 * (count + 2);
  if (head > bytes.byteLength) throw new NetworkFormatError(`${tag}: string offsets out of bounds`);
  const textLen = bytes.byteLength - head;
  if (dv.getUint32(4 * (count + 1), true) !== textLen) throw new NetworkFormatError(`${tag}: text length mismatch`);
  if (count === 0) {
    if (textLen !== 0) throw new NetworkFormatError(`${tag}: text in an empty string section`);
    return [];
  }
  const list = strFromU8(bytes.subarray(head)).split(SEP);
  if (list.length !== count) throw new NetworkFormatError(`${tag}: expected ${count} strings, got ${list.length}`);
  return list;
}

/** One section's payload, unaligned. Typed arrays are byte views, not copies. */
function sectionBytes(tag: string, kind: Kind, value: unknown): Uint8Array {
  switch (kind) {
    case KIND.i32:
    case KIND.f32:
    case KIND.u8: {
      const arr = value as Int32Array | Float32Array | Uint8Array;
      const ok = kind === KIND.i32 ? arr instanceof Int32Array : kind === KIND.f32 ? arr instanceof Float32Array : arr instanceof Uint8Array;
      if (!ok) throw new Error(`encodeNetwork: ${tag.trim()} is not the expected typed array`);
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    case KIND.str:
      return encodeStrings(tag, value as string[]);
    case KIND.json:
      return strToU8(JSON.stringify(value));
  }
}

/**
 * Serialises a network to the versioned binary format. Deterministic: the
 * same network (grid insertion order aside) always gives the same bytes.
 * Throws if any string contains NUL.
 */
export function encodeNetwork(net: TransitNetwork): Uint8Array {
  const root = { ...net, grid: gridColumns(net.grid) } as unknown as Record<string, unknown>;
  const payloads = SECTIONS.map(([tag, path, kind]) => sectionBytes(tag, kind, getPath(root, path)));

  let size = align8(HEADER_BYTES + SECTIONS.length * ENTRY_BYTES);
  const offsets = payloads.map((p) => {
    const off = size;
    size += align8(p.byteLength);
    return off;
  });

  const buf = new ArrayBuffer(size);
  const out = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) out[i] = NETWORK_MAGIC.charCodeAt(i);
  dv.setUint16(4, NETWORK_FORMAT_VERSION, true);
  dv.setUint16(6, SECTIONS.length, true);
  dv.setUint32(8, 0, true);
  SECTIONS.forEach(([tag, , kind], i) => {
    const e = HEADER_BYTES + i * ENTRY_BYTES;
    for (let c = 0; c < 4; c++) out[e + c] = tag.charCodeAt(c);
    out[e + 4] = kind;
    dv.setUint32(e + 8, offsets[i], true);
    dv.setUint32(e + 12, payloads[i].byteLength, true);
    new Uint8Array(buf, offsets[i], payloads[i].byteLength).set(payloads[i]);
  });
  return out;
}

/**
 * Reads a blob written by {@link encodeNetwork}. Typed arrays (and grid
 * cells) are views over `bytes`' buffer, so don't reuse that buffer
 * afterwards. An unaligned view is copied once first. Throws
 * {@link NetworkFormatError} on anything malformed or of another version.
 */
export function decodeNetwork(bytes: Uint8Array): TransitNetwork {
  if (bytes.byteOffset % 8 !== 0) bytes = bytes.slice();
  const fail = (msg: string): never => {
    throw new NetworkFormatError(msg);
  };
  if (bytes.byteLength < HEADER_BYTES) fail("blob shorter than its header");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== NETWORK_MAGIC) fail("bad magic");
  const format = dv.getUint16(4, true);
  if (format !== NETWORK_FORMAT_VERSION) fail(`unknown format ${format}`);
  const n = dv.getUint16(6, true);
  if (HEADER_BYTES + n * ENTRY_BYTES > bytes.byteLength) fail("section table out of bounds");

  const table = new Map<string, { kind: number; off: number; len: number }>();
  for (let i = 0; i < n; i++) {
    const e = HEADER_BYTES + i * ENTRY_BYTES;
    const tag = String.fromCharCode(bytes[e], bytes[e + 1], bytes[e + 2], bytes[e + 3]);
    const off = dv.getUint32(e + 8, true);
    const len = dv.getUint32(e + 12, true);
    if (off % 8 !== 0) fail(`${tag}: misaligned offset ${off}`);
    if (off + len > bytes.byteLength) fail(`${tag}: out of bounds`);
    if (table.has(tag)) fail(`${tag}: duplicate section`);
    table.set(tag, { kind: bytes[e + 4], off, len });
  }

  const root: Record<string, unknown> = {};
  for (const [tag, path, kind] of SECTIONS) {
    const s = table.get(tag) ?? fail(`${tag}: missing section`);
    if (s.kind !== kind) fail(`${tag}: kind ${s.kind}, expected ${kind}`);
    const at = bytes.byteOffset + s.off;
    let value: unknown;
    switch (kind) {
      case KIND.i32:
      case KIND.f32:
        if (s.len % 4 !== 0) fail(`${tag}: length ${s.len} is not a multiple of 4`);
        value = kind === KIND.i32 ? new Int32Array(bytes.buffer, at, s.len / 4) : new Float32Array(bytes.buffer, at, s.len / 4);
        break;
      case KIND.u8:
        value = new Uint8Array(bytes.buffer, at, s.len);
        break;
      case KIND.str:
        value = decodeStrings(tag, bytes.subarray(s.off, s.off + s.len));
        break;
      case KIND.json:
        try {
          value = JSON.parse(strFromU8(bytes.subarray(s.off, s.off + s.len)));
        } catch {
          fail(`${tag}: bad JSON`);
        }
        break;
    }
    setPath(root, path, value);
  }

  const meta = root.meta as TransitNetwork["meta"] | null;
  if (!meta || typeof meta !== "object" || meta.version !== NETWORK_VERSION) {
    fail(`network version ${meta?.version}, expected ${NETWORK_VERSION}`);
  }
  const g = root.grid as GridColumns;
  const cells = new Map<number, Int32Array>();
  for (let i = 0; i < g.lat.length; i++) {
    if (g.start[i] < 0 || g.len[i] < 0 || g.start[i] + g.len[i] > g.stops.length) fail("GSTA: cell out of bounds");
    cells.set(g.lat[i] * GRID_KEY_SPLIT + g.lon[i], g.stops.subarray(g.start[i], g.start[i] + g.len[i]));
  }
  const net = { ...root, grid: { cellDeg: g.cellDeg, cells } } as unknown as TransitNetwork;
  net.stops.count = net.stops.id.length;
  net.routes.count = net.routes.id.length;
  net.patterns.count = net.patterns.route.length;
  return net;
}
