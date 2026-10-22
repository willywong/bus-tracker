import assert from "node:assert/strict";
import test from "node:test";

import { INF, raptorProto, raptorProtoSteps, type StopTime } from "../raptor.js";
import { fixtureNetwork } from "./helpers/fixture-network.js";

/** 2026-10-28 08:00 MYT, seconds after the service day's midnight. */
const AT_0800 = 8 * 3600;

/** Hotel Lisa De Inn (feeder `12000759`) → the KLCC station's stops, no walking at either end. */
function lisaToKlcc(): { access: StopTime[]; egress: StopTime[] } {
  const net = fixtureNetwork();
  const origin = net.stops.id.indexOf("12000759");
  assert.ok(origin >= 0, "Hotel Lisa De Inn is in the network");
  const klcc = net.stations.find((s) => s.id === "klcc");
  assert.ok(klcc, "station klcc");
  const egress = klcc.stopIds.map((id) => ({ stop: net.stops.id.indexOf(id), seconds: 0, meters: 0 }));
  assert.ok(egress.length > 0 && egress.every((e) => e.stop >= 0), `KLCC stops ${klcc.stopIds.join(", ")}`);
  return { access: [{ stop: origin, seconds: 0, meters: 0 }], egress };
}

test("raptorProto finds an arrival from Hotel Lisa De Inn to KLCC on the fixture network", () => {
  const { access, egress } = lisaToKlcc();
  const r = raptorProto(fixtureNetwork(), access, egress, AT_0800);
  assert.ok(r.arrive < INF, "reaches KLCC");
  assert.ok(r.arrive > AT_0800 && r.arrive < AT_0800 + 2 * 3600, `arrives within 2 h (${r.arrive})`);
  assert.equal(r.runs, 21, "40-min window in 2-min steps");
  assert.ok(r.rounds > 0);
});

test("the range arrival is the best single-departure arrival in the window, and the steps yield per round", () => {
  const net = fixtureNetwork();
  const { access, egress } = lisaToKlcc();
  let single = INF;
  for (let t = AT_0800; t <= AT_0800 + 1200; t += 120) {
    single = Math.min(single, raptorProto(net, access, egress, t, { windowSec: 0 }).arrive);
  }
  const range = raptorProto(net, access, egress, AT_0800, { windowSec: 1200 });
  assert.equal(range.arrive, single);

  const steps = raptorProtoSteps(net, access, egress, AT_0800, { windowSec: 1200 });
  let yields = 0;
  let step = steps.next();
  for (; !step.done; step = steps.next()) yields++;
  assert.deepEqual(step.value, range);
  assert.equal(yields, range.rounds);
});
