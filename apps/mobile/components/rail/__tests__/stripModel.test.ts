import assert from 'node:assert/strict';
import test from 'node:test';

import { RAIL_LINES, type RailStation, type TransitNetwork } from '@bus-tracker/shared';

// Test-only helpers from the shared package: a hand-built network and the
// four 2026-10-23 fixture feeds compiled for 2026-10-28.
import { buildNetwork } from '../../../../../packages/shared/src/transit/__tests__/fixtures/syntheticNetwork';
import { fixtureNetwork } from '../../../../../packages/shared/src/transit/__tests__/helpers/fixture-network';

import {
  isKtmRoute,
  KTM_CAPTION,
  nearestStationIndex,
  RAIL_CAPTION,
  routeIndexById,
  runTimes,
  serviceSecondsAt,
  stationSpoken,
  stripHeader,
  stripModel,
  trainRunTimes,
} from '../stripModel';

/** Epoch ms of a Malaysia wall-clock time on 2026-10-28. */
const myt = (h: number, m = 0) => Date.UTC(2026, 9, 28, h, m) - 8 * 3_600_000;
const at = (h: number, m = 0) => h * 3600 + m * 60;
/** A fixed clock so expectations don't depend on the 12/24 h setting. */
const clock = (ms: number) => {
  const d = new Date(ms + 8 * 3_600_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const KJ = RAIL_LINES.find((l) => l.code === 'LRT KJ')!;
const KG = RAIL_LINES.find((l) => l.code === 'MRT KG')!;

const station = (id: string, name: string, stopIds: string[], lines = [KJ], lat = 3.1, lng = 101.7): RailStation => ({
  id,
  name,
  lat,
  lng,
  stopIds,
  lines,
});

const WINDOWS: Array<[number, number, number]> = [
  [at(6), at(9), 180],
  [at(9), at(23, 30), 420],
];
/** 0, 5, 15 and 25 min from Alpha: a slow and a fast segment. */
const OFFSETS = [0, 300, 900, 1500];

/**
 * Alpha – Bravo – Charlie – Delta on KJ each way; Charlie also holds a
 * Kajang Line platform. A one-trip-short KTM line runs two timetabled trips.
 */
function net(): TransitNetwork {
  const n = buildNetwork({
    stops: [
      { id: 'rail:KJ1', name: 'Alpha', station: 0 },
      { id: 'rail:KJ2', name: 'Bravo', station: 1 },
      { id: 'rail:KJ3', name: 'Charlie', station: 2 },
      { id: 'rail:KJ4', name: 'Delta', station: 3 },
      { id: 'rail:KG9', name: 'Charlie', station: 2 },
      { id: 'ktm:100', name: 'Kilo One', station: 4 },
      { id: 'ktm:200', name: 'Kilo Two', station: 5 },
    ],
    stations: [
      station('alpha', 'Alpha', ['rail:KJ1']),
      station('bravo', 'Bravo', ['rail:KJ2']),
      station('charlie', 'Charlie', ['rail:KJ3', 'rail:KG9'], [KJ, KG]),
      station('delta', 'Delta', ['rail:KJ4'], [KJ], 3.2, 101.7),
      station('ktm-kilo-one', 'Kilo One', ['ktm:100'], []),
      station('ktm-kilo-two', 'Kilo Two', ['ktm:200'], []),
    ],
    routes: [
      { id: 'rail:KJ', label: KJ.name, mode: 'lrt', feed: 'rail' },
      { id: 'ktm:SB', label: 'KTM Seremban', mode: 'ktm', feed: 'ktm' },
    ],
    patterns: [
      { route: 0, headsign: 'Delta', stops: [0, 1, 2, 3], windows: WINDOWS, runOffset: OFFSETS },
      { route: 0, headsign: 'Alpha', stops: [3, 2, 1, 0], windows: WINDOWS, runOffset: OFFSETS },
      {
        route: 1,
        headsign: 'Kilo Two',
        stops: [5, 6],
        trips: [
          [at(7), at(7, 20)],
          [at(8), at(8, 25)],
        ],
      },
    ],
  });
  // Charlie at 3.15, Delta at 3.2: nearest-station distances are real.
  n.stops.lat.set([3.1, 3.1, 3.15, 3.2, 3.15, 3.0, 3.0]);
  n.stops.lon.set([101.7, 101.7, 101.7, 101.7, 101.7, 101.6, 101.6]);
  return n;
}

const KJ_ROUTE = 0;

test('trainRunTimes spaces trains by headway', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(7))!;
  const t = serviceSecondsAt(m, myt(7))!;
  assert.equal(t, at(7));
  const runs = trainRunTimes(m, t);
  assert.deepEqual(runs, [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i] - runs[i - 1], 180);
});

test('trainRunTimes drops trains past the terminus', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(7))!;
  assert.equal(m.totalRunSec, 1500);
  // At 07:01 the 06:36 train is exactly at Delta (r = 1500); the 06:33 one
  // (r = 1680) has arrived and is gone.
  const runs = trainRunTimes(m, at(7, 1));
  assert.ok(runs.every((r) => r >= 0 && r <= m.totalRunSec));
  assert.equal(runs[runs.length - 1], 1500);
  assert.ok(!runs.includes(1680));
  assert.equal(runs.length, 9);
});

test('no trains before the first window', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(5, 59))!;
  assert.deepEqual(trainRunTimes(m, at(5, 59)), []);
  assert.equal(m.window, null);
  assert.equal(m.next, myt(6));
  assert.equal(stripHeader(m, false, clock).status, 'First 6:00');
});

test('after the window ends only running trains remain', () => {
  const now = myt(23, 40);
  const m = stripModel(net(), KJ_ROUTE, 0, now)!;
  assert.equal(m.window, null);
  assert.equal(m.next, null);
  // The last grid departure is 23:28 (09:00 + 124 · 7 min); 23:21 is still running.
  assert.equal(m.last, myt(23, 28));
  assert.deepEqual(trainRunTimes(m, serviceSecondsAt(m, now)!), [720, 1140]);
  assert.equal(stripHeader(m, false, clock).status, 'No more trains today');
});

test('runs from an earlier window stay on the line after the headway changes', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(9, 1))!;
  assert.equal(m.window?.headwaySec, 420);
  const runs = trainRunTimes(m, at(9, 1));
  // 09:00 (7-min window) plus the 3-min window's trains from 08:36 on.
  assert.deepEqual(runs, [60, 240, 420, 600, 780, 960, 1140, 1320, 1500]);
});

test('stripModel lists other-line colours at interchanges', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(8))!;
  const charlie = m.stations.find((s) => s.name === 'Charlie')!;
  assert.deepEqual(charlie.otherLineColors, [KG.color]);
  assert.deepEqual(charlie.otherLineNames, ['Kajang Line']);
  assert.equal(charlie.stationId, 'charlie');
  assert.deepEqual(m.stations.find((s) => s.name === 'Bravo')!.otherLineColors, []);
  assert.equal(stationSpoken(charlie, false), 'Charlie, change for Kajang Line');
  assert.equal(stationSpoken(charlie, true), 'Charlie, change for Kajang Line, nearest to you');
  assert.equal(m.line, KJ);
  assert.equal(m.name, 'Kelana Jaya Line');
});

test('stripModel dir 1 reverses the station order', () => {
  const n = net();
  const a = stripModel(n, KJ_ROUTE, 0, myt(8))!;
  const b = stripModel(n, KJ_ROUTE, 1, myt(8))!;
  assert.deepEqual(a.stations.map((s) => s.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(b.stations.map((s) => s.name), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
  assert.equal(a.towards, 'Delta');
  assert.equal(b.towards, 'Alpha');
  assert.deepEqual(a.directions, [
    { dir: 0, towards: 'Delta' },
    { dir: 1, towards: 'Alpha' },
  ]);
  assert.deepEqual(a.stations.map((s) => s.offsetSec), OFFSETS);
});

test('header reads the headway now, first and last, and the caption', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(8))!;
  const h = stripHeader(m, false, clock);
  assert.equal(h.status, 'every 3 mins now');
  assert.equal(h.footer, 'First 6:00 · Last 23:28');
  assert.equal(h.caption, "Trains shown at timetable spacing — Rapid Rail doesn't publish live positions.");
  assert.equal(h.caption, RAIL_CAPTION);
  assert.equal(
    h.spoken,
    'Kelana Jaya Line towards Delta, every 3 minutes now. First train 6:00, last train 23:28. Trains shown at timetable spacing.',
  );
});

test('a timetabled KTM line runs on its own trips, with the KTM caption', () => {
  const n = net();
  const r = routeIndexById(n, 'ktm:SB');
  assert.ok(isKtmRoute(n, r));
  const m = stripModel(n, r, 0, myt(8, 10))!;
  assert.equal(m.kind, 'timetable');
  assert.deepEqual(m.runs, [at(7), at(8)]);
  assert.deepEqual(trainRunTimes(m, at(8, 10)), [600]);
  // The 08:00 trip takes 25 min, not the first trip's 20.
  assert.deepEqual(runTimes(n, m, 1), [at(8), at(8, 25)]);
  const h = stripHeader(m, true, clock);
  assert.equal(h.caption, KTM_CAPTION);
  assert.equal(h.status, 'No more trains today');
  assert.equal(stripHeader(stripModel(n, r, 0, myt(7, 30))!, true, clock).status, 'Next 8:00');
});

test('off the service date the strip still draws but has no times', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, Date.UTC(2026, 10, 5, 0))!;
  assert.equal(m.midnightMs, null);
  assert.equal(m.stations.length, 4);
  assert.equal(stripHeader(m, false, clock).status, 'Timetable unavailable');
});

test('nearest station is within 2 km or none', () => {
  const m = stripModel(net(), KJ_ROUTE, 0, myt(8))!;
  assert.equal(nearestStationIndex(m.stations, { lat: 3.199, lng: 101.7 }), 3);
  assert.equal(nearestStationIndex(m.stations, { lat: 3.4, lng: 101.7 }), -1);
  assert.equal(nearestStationIndex(m.stations, null), -1);
});

test('fixture Kelana Jaya at 08:00 runs every 4 mins over 37 stations', () => {
  const n = fixtureNetwork();
  const r = routeIndexById(n, 'rail:KJ');
  const m = stripModel(n, r, 0, myt(8))!;
  assert.equal(m.stations.length, 37);
  assert.equal(m.towards, 'Putra Heights');
  assert.equal(m.window?.headwaySec, 240);
  const runs = trainRunTimes(m, serviceSecondsAt(m, myt(8))!);
  assert.ok(runs.length > 12, `${runs.length} trains on the whole line`);
  const pasarSeni = m.stations.find((s) => s.name === 'Pasar Seni')!;
  assert.deepEqual(pasarSeni.otherLineNames, ['Kajang Line']);
  for (let i = 1; i < m.stations.length; i++) assert.ok(m.stations[i].offsetSec > m.stations[i - 1].offsetSec);
});

test('fixture KTM Seremban takes its badge from the network stations', () => {
  const n = fixtureNetwork();
  const r = routeIndexById(n, 'ktm:KC05_KB18');
  const m = stripModel(n, r, 0, myt(8))!;
  assert.equal(m.kind, 'timetable');
  assert.equal(m.line.code, 'KTM');
  assert.equal(m.name, 'Komuter Seremban Line');
  assert.ok(isKtmRoute(n, r));
});
