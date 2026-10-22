# 12-Transit-Network / 05 — Network serialisation (binary blob)

**Build impact:** JS-only (Metro reload)

## Context
- Spec §3.3: one `TransitNetwork` per service date, stored as one BLOB in `network_blobs(service_date TEXT PRIMARY KEY, version INT, built_at INT, data BLOB)`.
- The README success criterion: the blob round-trips byte-identically and stays under 6 MB. Spec §1 estimates about 3 MB of Int32 arrays plus strings.
- The search index already persists, but as JSON in the `meta` table (`apps/mobile/db/searchIndexStore.ts:12`, `serializeRouteSearchIndex` at `packages/shared/src/utils/search-routes.ts:348`). That is fine at 50–350 KB but too slow and large for about 385k stop events.
- The UTF-8 helpers `strToU8`/`strFromU8` from `fflate` are already used by the parser (`packages/shared/src/utils/gtfs-parser.ts:1`). Use them rather than `TextDecoder`, which Hermes may not provide.
- Grid keys from task 03 are `latCell * 1_000_000 + lonCell`. They exceed Int32, so the serialiser stores them as two Int32 columns.

## Goal
`encodeNetwork(net): Uint8Array` and `decodeNetwork(bytes): TransitNetwork`, as a small versioned binary format.
- Typed arrays are stored raw (little-endian) and decoded as zero-copy views.
- Strings are stored once per section as UTF-8.
- The result is deterministic and byte-identical on round-trip.

## Prerequisites
- Tasks 03 and 04: a full, deterministic `TransitNetwork`.

## Steps

1. **Format**, in `packages/shared/src/transit/serialize.ts`. All integers are little-endian.
   ```
   offset 0   magic        4 bytes  'B','B','T','N'
   offset 4   format       u16      NETWORK_FORMAT_VERSION (1)
   offset 6   sections     u16      N
   offset 8   reserved     u32      0
   offset 12  table        N × 16 bytes:
                tag     4 bytes ASCII ('SLAT', 'PARR', …)
                kind    u8   1=i32 2=f32 3=u8 4=str 5=json
                pad     3 bytes 0
                offset  u32  from start of blob, 8-byte aligned
                length  u32  bytes
   data       sections, each padded with 0 to an 8-byte boundary
   ```
   - **`kind 4` (strings):** the payload is `u32 count`, then `(count + 1) × u32` byte offsets into the text, then the text: the strings UTF-8 encoded and joined with `"\u0000"`.
     - The decoder runs `strFromU8` once on the whole text and splits on `\u0000`. It checks that the split length equals `count` and that the last offset equals the text length.
     - The offsets allow single-string access without decoding the rest. A later lazy decoder can use them.
     - Throw on encode if any string contains `\u0000`.
     - Use `''` for a missing value.
   - **`kind 5`:** UTF-8 JSON, only for small structured data: `meta` and `stations`.
   - **Section list:** one tag per field of `TransitNetwork`, in a fixed order. Declare it as a const array of `[tag, path, kind]` so encode and decode share one table:
     - `META` json, `STNS` json;
     - stops: `SID` str, `SNAM` str, `SLAT` f32, `SLON` f32, `SFED` u8, `SSTN` i32;
     - routes: `RID`, `RLAB`, `RLNG` str, `RMOD` u8, `RCOL`, `RTXC` str, `RFED` u8, `RSHP` str;
     - patterns: `PRTE` i32, `PHED` str, `PSST`/`PSLN`/`PSTP` i32, `PTST`/`PTLN` i32, `PARR`/`PDEP` i32, `PKEY` str, `PFST`/`PFLN` i32, `FSTA`/`FEND`/`FHWY` i32, `PROF` i32;
     - `stopRoutes`: `XSTA`/`XLEN`/`XPAT`/`XPOS` i32;
     - transfers: `TSTA`/`TLEN`/`TTO`/`TSEC` i32, `TKND` u8;
     - grid: `GCEL` f32 (a single value), `GLAT`/`GLON` i32 cell coords, `GSTA`/`GLEN`/`GSTP` i32 CSR. Sort the keys ascending before writing so the output is deterministic.
     - Pad 3-character tags with a trailing space.
   - **Counts** (`stops.count`, `routes.count`, `patterns.count`) are implied by the array lengths, and decode re-derives them.

2. **Encode:**
   - Compute every section's byte length first, allocate one `ArrayBuffer`, then copy with `new Uint8Array(buf, off, len).set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))`.
   - Assert little-endian once at module load: `new Uint8Array(new Uint16Array([1]).buffer)[0] === 1`. If it fails, throw, because every iOS and Android device is LE.
   - Signature: `export function encodeNetwork(net: TransitNetwork): Uint8Array`.

3. **Decode:** `export function decodeNetwork(bytes: Uint8Array): TransitNetwork`.
   - Validate the magic, `format === NETWORK_FORMAT_VERSION`, that the table fits, that every section lies within bounds, and that `offset % 8 === 0`.
   - On any failure, throw `NetworkFormatError` (exported, `name = 'NetworkFormatError'`). The caller treats it as "no blob" and rebuilds.
   - Typed arrays are views: `new Int32Array(bytes.buffer, bytes.byteOffset + off, len / 4)`.
     - If `bytes.byteOffset % 8 !== 0` (expo-sqlite may hand back an unaligned view), copy once into a fresh aligned buffer first.
   - Rebuild `grid.cells` as `Map<number, Int32Array>` with `subarray` views.
   - Check `meta.version === NETWORK_VERSION` (task 01). A mismatch also throws `NetworkFormatError`.

4. **Exports:** `encodeNetwork`, `decodeNetwork`, `NetworkFormatError`, `NETWORK_FORMAT_VERSION` and `NETWORK_MAGIC = 'BBTN'`, all from `packages/shared/src/transit/index.ts`.

5. **Size check script:** add `packages/shared/scripts/network-blob-size.ts <fixturesDir> <YYYYMMDD>`.
   - It compiles, encodes, and prints the total and per-section bytes, plus the gzip size via `fflate.gzipSync`. The gzip size is the spec §3.5 fallback's download size.
   - Paste its output into task 00 **Results** under "Estimated network Int32 bytes".

6. **Tests** in `packages/shared/src/transit/__tests__/serialize.test.ts`:
   - `round-trips a synthetic network byte-identically`: `encode(decode(encode(n)))` deep-equals `encode(n)` (`assert.deepEqual` on `Uint8Array`).
   - `decoded network equals the original`: compare every field. Typed arrays via `Array.from`; the grid via sorted entries.
   - `fixture network for 20261028 round-trips and is < 6 MB`: compile the four fixtures, encode, `assert.ok(bytes.byteLength < 6 * 1024 * 1024)`, and round-trip.
   - `non-ASCII names survive`: a stop named `"Stesen Ñ — 中文"`.
   - `rejects bad magic`, `rejects unknown format version`, `rejects truncated blob`: all throw `NetworkFormatError`.
   - `decodes from an unaligned view`: copy the blob to `new Uint8Array(len + 1).subarray(1)` first.
   - `string containing NUL is rejected on encode`.
   - `encode is deterministic`: two compiles of the same fixtures encode to equal bytes, with `builtAt` fixed through `opts.builtAt`.

## Verification
- `pnpm --filter @bus-tracker/shared test`.
- `pnpm type-check`.
- `pnpm -C packages/shared exec tsx scripts/network-blob-size.ts packages/shared/src/transit/__fixtures__/2026-10-23 20261028` prints a total under 6 MB and a gzip size around 1.5 MB.

## Handoff to next step ([06-mobile-feed-refresh-and-store.md](./06-mobile-feed-refresh-and-store.md))
- `encodeNetwork` / `decodeNetwork` are ready for SQLite storage. Store `NETWORK_FORMAT_VERSION` in `network_blobs.version`, and treat a `NetworkFormatError` as a missing blob.
- The measured blob and gzip sizes are recorded in task 00 Results.

## Implementation notes
- **`patterns.timeStart` gets its own section, `PTMS` i32.** The Step 1 list leaves it out, but `ev()` cannot read trip times without it.
- **`GCEL` is `json`, not `f32`.** An f32 `0.005` decodes as `0.004999999888…`. That moves cell boundaries in `stopsNear`/`gridKey`, so lookups would miss the stored keys. The JSON number round-trips exactly.
- **Decode looks sections up by tag, not by position.** It requires every expected tag with its expected kind, and rejects duplicates. Bad JSON, bad string sections, i32/f32 lengths that are not a multiple of 4, and grid cells outside `GSTP` also throw `NetworkFormatError`.
- **Decoded typed arrays and grid cells are views over the input buffer**, as specified. Don't reuse the buffer after decoding. On an unaligned input, the views are over a one-time copy instead.
- **Fixture size for 20261028:** 3.51 MB blob (2.92 MB typed arrays), 1.43 MB gzipped. `PARR`/`PDEP` take 2.4 MB of that, and `PKEY` 267 KB. On Node, encode takes ≈ 4 ms and decode ≈ 0.7 ms. The full output is in task 00 Results.
- **`network-blob-size.ts` resolves `<fixturesDir>` from the cwd, then from the repo root.** `pnpm -C packages/shared` runs from the package, so the Verification command's repo-relative path would not resolve otherwise.
