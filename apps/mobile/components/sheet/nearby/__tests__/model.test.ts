import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineMeters, stopIndexById, type RailStation, type TransitNetwork } from '@bus-tracker/shared';

// Test-only helpers from the shared package: a hand-built network and the
// four 2026-10-23 fixture feeds compiled for 2026-10-28.
import { buildNetwork } from '../../../../../../packages/shared/src/transit/__tests__/fixtures/syntheticNetwork';
import { fixtureNetwork } from '../../../../../../packages/shared/src/transit/__tests__/helpers/fixture-network';

import {
  aroundYou,
  gtfsStopId,
  MAX_PLACES,
  MIN_STATIONS,
  placeName,
  routePreview,
  STATION_RADIUS_M,
  STOP_RADIUS_M,
  stopRoutes,
  type NearbyPlace,
} from '../model';

/** Epoch ms of a Malaysia wall-clock time on 2026-10-28 (the fixture's service date). */
const myt = (h: number, m = 0) => Date.UTC(2026, 9, 28, h, m) - 8 * 3_600_000;
const at = (h: number, m = 0) => h * 3600 + m * 60;
/** A fixed clock so expectations don't depend on the 12/24 h setting. */
const clock = (ms: number) => {
  const d = new Date(ms + 8 * 3_600_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** Hotel Lisa De Inn: the Rapid KL stop and, 3 m away, the T816 feeder stop. */
const LISA_KL = 'kl:1000944';
const LISA_FEEDER = '12000759';

function lisa(net: TransitNetwork) {
  const s = stopIndexById(net, LISA_KL);
  return { lat: net.stops.lat[s], lng: net.stops.lon[s] };
}

const stops = (places: NearbyPlace[]) => places.filter((p): p is Extract<NearbyPlace, { kind: 'stop' }> => p.kind === 'stop');

test('aroundYou orders by distance and caps at 8', () => {
  const net = fixtureNetwork();
  const places = aroundYou(net, lisa(net), myt(7, 30), { clock, yourStopId: null });
  assert.equal(places.length, MAX_PLACES);
  for (let i = 1; i < places.length; i++) {
    const kinds = [places[i - 1].kind, places[i].kind];
    // Stations are only ever swapped in at the end, so stops stay in order among themselves.
    if (kinds[0] === kinds[1]) assert.ok(places[i - 1].distanceM <= places[i].distanceM, `${places[i - 1].name} before ${places[i].name}`);
  }
});

test('stations within 2 km, stops only within 600 m, two stations kept', () => {
  const net = fixtureNetwork();
  const places = aroundYou(net, lisa(net), myt(7, 30), { clock, yourStopId: null });
  for (const p of stops(places)) assert.ok(p.distanceM <= STOP_RADIUS_M);
  const stations = places.filter((p) => p.kind === 'station');
  assert.equal(stations.length, MIN_STATIONS);
  for (const p of stations) assert.ok(p.distanceM <= STATION_RADIUS_M);
  assert.deepEqual(
    stations.map((p) => p.name),
    ['Taman Paramount', 'Asia Jaya'],
  );
  assert.equal(places[places.length - 1].kind, 'station');
});

test('same-name stops across the road merge, and your stop is captioned', () => {
  const net = fixtureNetwork();
  const places = aroundYou(net, lisa(net), myt(7, 30), { clock, yourStopId: LISA_FEEDER });
  const first = places[0];
  assert.equal(first.kind, 'stop');
  if (first.kind !== 'stop') return;
  assert.equal(first.name, 'Hotel Lisa De Inn');
  assert.equal(first.stopIndexes.length, 2);
  assert.ok(first.routes.includes('T816'));
  assert.ok(first.routes.includes('PJ02'));
  assert.equal(first.isYourStop, true);
  assert.match(first.spoken, /^Hotel Lisa De Inn, your stop, 0 metres, routes /);
  assert.equal(stops(places).filter((p) => p.isYourStop).length, 1);
});

test('your live ETA shows on your stop', () => {
  const net = fixtureNetwork();
  const places = aroundYou(net, lisa(net), myt(7, 30), {
    clock,
    yourStopId: LISA_FEEDER,
    yourRouteCode: 'T816',
    yourLiveNext: '4 min',
  });
  const mine = stops(places).find((p) => p.isYourStop)!;
  assert.equal(mine.next, '4 min');
  assert.equal(mine.live, true);
});

test('a stop with no departures is dropped', () => {
  const net = fixtureNetwork();
  // After midnight past the service day: nothing boards, so nothing lists.
  const places = aroundYou(net, lisa(net), Date.UTC(2026, 10, 2, 0) - 8 * 3_600_000, { clock, yourStopId: null });
  assert.equal(stops(places).length, 0);
});

test('stopRoutes sorts by soonest and marks ended', () => {
  const net = fixtureNetwork();
  const place = stops(aroundYou(net, lisa(net), myt(7, 30), { clock, yourStopId: null }))[0];
  const rows = stopRoutes(net, place.stopIndexes, myt(7, 30), { clock, liveRoutes: new Set(['T816']) });
  assert.ok(rows.length >= 5);
  const open = rows.filter((r) => !r.ended);
  for (let i = 1; i < open.length; i++) assert.ok((open[i - 1].nextAt ?? 0) <= (open[i].nextAt ?? Infinity));
  const t816 = rows.find((r) => r.label === 'T816')!;
  assert.equal(t816.live, true);
  assert.equal(t816.towards, 'MRT Phileo Damansara Pintu A');
  assert.match(t816.then ?? '', /^then \d+:\d\d · \d+:\d\d$/);

  const late = stopRoutes(net, place.stopIndexes, myt(23, 55), { clock });
  const ended = late.filter((r) => r.ended);
  assert.ok(ended.length > 0);
  assert.equal(late[late.length - 1].ended, true);
  for (const r of ended) {
    assert.equal(r.next, 'No more today');
    assert.equal(r.live, false);
  }
});

/** One feeder route, A → B → C, two trips; and a headway-only rail line. */
function tinyNetwork(): TransitNetwork {
  const station = (id: string, name: string, stopIds: string[]): RailStation => ({ id, name, lat: 3.1, lng: 101.6, stopIds, lines: [] });
  const net = buildNetwork({
    stops: [
      { id: '9001', name: 'A Stop', station: -1 },
      { id: '9002', name: 'PJ210 B Stop', station: -1 },
      { id: '9003', name: '(m) KL2147 C Stop', station: -1 },
      { id: 'rail:X1', name: 'Xa', station: 0 },
      { id: 'rail:X2', name: 'Xb', station: 1 },
    ],
    stations: [station('xa', 'Xa', ['rail:X1']), station('xb', 'Xb', ['rail:X2'])],
    routes: [
      { id: 'T900', label: 'T900', mode: 'feeder', feed: 'feeder' },
      { id: 'rail:X', label: 'X', mode: 'lrt', feed: 'rail' },
    ],
    patterns: [
      { route: 0, headsign: 'C', stops: [0, 1, 2], trips: [[at(7), at(7, 5), at(7, 12)], [at(8), at(8, 5), at(8, 12)]] },
      { route: 1, headsign: 'Xb', stops: [3, 4], windows: [[at(6), at(23), 600]], runOffset: [0, 180] },
    ],
  });
  const coords: Array<[number, number]> = [[3.1, 101.6], [3.101, 101.601], [3.102, 101.602], [3.11, 101.61], [3.12, 101.62]];
  coords.forEach(([la, lo], i) => {
    net.stops.lat[i] = la;
    net.stops.lon[i] = lo;
  });
  net.stops.feed[0] = net.stops.feed[1] = net.stops.feed[2] = 2; // feeder
  return net;
}

test('routePreview starts at your stop with the next trip and falls back to stop-to-stop', () => {
  const net = tinyNetwork();
  const pv = routePreview(net, 0, 1, myt(7, 2), { clock });
  assert.ok(pv);
  assert.equal(pv.label, 'T900');
  assert.equal(pv.towards, 'C Stop');
  assert.equal(pv.fromStopName, 'B Stop');
  assert.deepEqual(pv.stops.map((s) => [s.name, s.time, s.yours]), [
    ['B Stop', '7:05', true],
    ['C Stop', '7:12', false],
  ]);
  assert.equal(clock(pv.nextAt!), '7:05');
  assert.equal(clock(pv.firstAt!), '7:05');
  assert.equal(pv.onRoad, false);
  assert.deepEqual(pv.path, pv.stops.map((s) => ({ lat: s.lat, lng: s.lng })));

  // Past the last trip: no times, nothing next.
  const late = routePreview(net, 0, 1, myt(9), { clock })!;
  assert.equal(late.nextAt, null);
  assert.deepEqual(late.stops.map((s) => s.time), [null, null]);
});

test('routePreview follows a road shape that fits, on headway windows too', () => {
  const net = tinyNetwork();
  const shape = [
    { lat: 3.0995, lng: 101.5995 },
    { lat: 3.1005, lng: 101.6005 },
    { lat: 3.101, lng: 101.601 },
    { lat: 3.1015, lng: 101.6015 },
    { lat: 3.102, lng: 101.602 },
    { lat: 3.1025, lng: 101.6025 },
  ];
  const pv = routePreview(net, 0, 1, myt(7, 2), { clock, roadShape: shape })!;
  assert.equal(pv.onRoad, true);
  assert.ok(pv.path.length >= 2);
  assert.ok(haversineMeters(pv.path[0], { lat: 3.101, lng: 101.601 }) < 20);

  const rail = routePreview(net, 1, 3, myt(7, 1), { clock })!;
  assert.deepEqual(rail.stops.map((s) => s.time), ['7:10', '7:13']);
});

test('routePreview is null off the pattern or at its terminus', () => {
  const net = tinyNetwork();
  assert.equal(routePreview(net, 0, 4, myt(7), { clock }), null);
  assert.equal(routePreview(net, 0, 2, myt(7), { clock }), null);
  assert.equal(routePreview(net, 99, 0, myt(7), { clock }), null);
});

test('gtfsStopId strips kl: and keeps feeder raw', () => {
  assert.equal(gtfsStopId('kl:1005840'), '1005840');
  assert.equal(gtfsStopId('12000759'), '12000759');
  assert.equal(gtfsStopId('rail:KJ15'), 'KJ15');
  assert.equal(gtfsStopId('ktm:19100'), '19100');
});

test('placeName drops the stop code and feeder marker, never the whole name', () => {
  assert.equal(placeName('PJ210 HOTEL LISA DE INN'), 'Hotel Lisa De Inn');
  assert.equal(placeName('(m) KL2147 Midvalley North Court'), 'Midvalley North Court');
  assert.equal(placeName('Komersial Seksyen 17/45'), 'Komersial Seksyen 17/45');
  assert.equal(placeName('PJ210'), 'PJ210');
});
