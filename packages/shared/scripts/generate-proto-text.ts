import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "src", "proto", "gtfs-realtime.proto");
const dst = path.join(here, "..", "src", "proto", "gtfs-realtime-text.ts");

const txt = readFileSync(src, "utf8");
const body =
  "// Auto-generated from gtfs-realtime.proto — do not edit directly.\n" +
  "// Regenerate via: tsx packages/shared/scripts/generate-proto-text.ts\n\n" +
  `export const GTFS_REALTIME_PROTO = ${JSON.stringify(txt)};\n`;

writeFileSync(dst, body);
console.log(`wrote ${dst} (${body.length} bytes)`);
