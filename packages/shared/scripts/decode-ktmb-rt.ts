/**
 * Prototype (plan 12/00 step 5): does KTMB's GTFS-R vehicle-position feed
 * carry Komuter trains, or only ETS? Prints every vehicle and flags the
 * ones that look like Komuter: a non-ETS label, or a position on the
 * Seremban / Port Klang corridor inside the Klang Valley.
 *
 *   pnpm -C packages/shared exec tsx scripts/decode-ktmb-rt.ts [runs=3]
 *
 * Runs are 16 s apart (4 requests/min per API family). Run it between
 * 07:00 and 22:00 MYT on a weekday; overnight the feed is empty.
 */
import { decodeFeed } from "../src/utils/protobuf.js";

const URL_ = "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb";
const KV = { minLat: 2.7, maxLat: 3.45, minLon: 101.25, maxLon: 101.95 };
const runs = Number(process.argv[2] ?? 3);

for (let i = 0; i < runs; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 16_000));
  const res = await fetch(URL_);
  const at = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" });
  if (!res.ok) {
    console.log(`${at} MYT: HTTP ${res.status}`);
    continue;
  }
  const feed = decodeFeed(new Uint8Array(await res.arrayBuffer()));
  const vehicles = feed.entity.filter((e) => e.vehicle).map((e) => e.vehicle!);
  let komuter = 0;
  console.log(`${at} MYT: ${feed.entity.length} entities, header ts ${feed.header.timestamp ?? "-"}`);
  for (const v of vehicles) {
    const label = v.vehicle?.label ?? v.vehicle?.id ?? "?";
    const lat = v.position?.latitude ?? NaN;
    const lon = v.position?.longitude ?? NaN;
    const inKv = lat >= KV.minLat && lat <= KV.maxLat && lon >= KV.minLon && lon <= KV.maxLon;
    const looksKomuter = !/^ETS/i.test(label) || inKv;
    if (looksKomuter) komuter++;
    console.log(
      `  ${label.padEnd(10)} route=${v.trip?.route_id ?? "-"} trip=${v.trip?.trip_id ?? "-"} ` +
        `${lat.toFixed(5)},${lon.toFixed(5)} speed=${v.position?.speed ?? "-"}${looksKomuter ? "  <- Komuter?" : ""}`,
    );
  }
  console.log(`  Komuter candidates: ${komuter}/${vehicles.length}`);
}
