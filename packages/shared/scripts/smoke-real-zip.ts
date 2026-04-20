import { parseGtfsZip } from "../src/utils/gtfs-parser.js";
import { filterToT816 } from "../src/utils/t816-bundle.js";

const URL_ = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder";

const res = await fetch(URL_);
if (!res.ok) throw new Error(`fetch ${URL_} → ${res.status}`);
const buf = new Uint8Array(await res.arrayBuffer());
console.log(`downloaded ${buf.byteLength} bytes`);

const p = parseGtfsZip(buf);
console.log("routes", p.routes.length);
console.log("stops", p.stops.length);
console.log("trips", p.trips.length);
console.log("stopTimes", p.stopTimes.length);
console.log("shapes", p.shapes.length);
console.log("calendar", p.calendar.length);

const t816Matches = p.routes.filter((r) =>
  /T.?816/i.test(r.route_short_name) ||
  /T.?816/i.test(r.route_long_name ?? "") ||
  /T.?816/i.test(String(r.route_id)),
);
console.log("T816-like routes:", t816Matches);

console.log("sample routes:", p.routes.slice(0, 5));

console.log("\n--- filterToT816 on real data ---");
const bundle = filterToT816(p);
console.log("bundle.routes:", bundle.routes);
console.log("bundle.stops.length:", bundle.stops.length);
console.log("bundle.trips.length:", bundle.trips.length);
console.log("bundle.stopTimes.length:", bundle.stopTimes.length);
console.log("bundle.calendar:", bundle.calendar);
console.log(
  "bundle.shapes:",
  Object.entries(bundle.shapes).map(([k, v]) => `${k}: ${v.length} pts`),
);
const approxKb = Math.round(JSON.stringify(bundle).length / 1024);
console.log(`bundle JSON size: ~${approxKb} KB`);
