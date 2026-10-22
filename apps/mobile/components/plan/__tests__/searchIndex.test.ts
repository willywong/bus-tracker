import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RailStation, TransitNetwork } from '@bus-tracker/shared';

import { buildLocalIndex, lookupLocal, normalizeName, searchLocal } from '../searchIndex';

type StopRow = { id: string; name: string; lat: number; lng: number; station?: number; routes?: number[] };

const LINE_KJ = { code: 'LRT KJ', mode: 'LRT', name: 'LRT Kelana Jaya Line', color: '#E0115F', textColor: '#FFFFFF' } as const;
const LINE_KG = { code: 'MRT KG', mode: 'MRT', name: 'MRT Kajang Line', color: '#047940', textColor: '#FFFFFF' } as const;

const STATIONS: RailStation[] = [
  { id: 'pasar-seni', name: 'Pasar Seni', lat: 3.1424, lng: 101.6955, stopIds: ['KJ14', 'KG16'], lines: [LINE_KJ, LINE_KG] },
  { id: 'kl-sentral', name: 'KL Sentral', lat: 3.1343, lng: 101.6862, stopIds: ['KJ15'], lines: [LINE_KJ] },
];

/** Route labels by route index. */
const ROUTES = ['T816', 'T815', '300', '301', '302', 'KJ'];

/** A tiny network with one pattern per (stop, route) pair, enough for name search. */
function makeNet(stops: StopRow[]): TransitNetwork {
  const start: number[] = [];
  const len: number[] = [];
  const pattern: number[] = [];
  const patternRoute: number[] = [];
  for (const s of stops) {
    start.push(pattern.length);
    for (const r of s.routes ?? []) {
      pattern.push(patternRoute.length);
      patternRoute.push(r);
    }
    len.push(pattern.length - start[start.length - 1]);
  }
  return {
    stops: {
      count: stops.length,
      id: stops.map((s) => s.id),
      name: stops.map((s) => s.name),
      lat: Float32Array.from(stops.map((s) => s.lat)),
      lon: Float32Array.from(stops.map((s) => s.lng)),
      station: Int32Array.from(stops.map((s) => s.station ?? -1)),
    },
    stations: STATIONS,
    routes: { count: ROUTES.length, label: ROUTES },
    patterns: { count: patternRoute.length, route: Int32Array.from(patternRoute) },
    stopRoutes: {
      start: Int32Array.from(start),
      len: Int32Array.from(len),
      pattern: Int32Array.from(pattern),
      pos: new Int32Array(pattern.length),
    },
  } as unknown as TransitNetwork;
}

const NET = makeNet([
  { id: 'rail:KJ14', name: 'Pasar Seni', lat: 3.1424, lng: 101.6955, station: 0, routes: [5] },
  { id: 'rail:KJ15', name: 'KL Sentral', lat: 3.1343, lng: 101.6862, station: 1, routes: [5] },
  // A bus stop named like the station, outside it.
  { id: 'kl:1001', name: 'Pasar Seni', lat: 3.1430, lng: 101.6960, routes: [2] },
  { id: 'kl:1002', name: 'Hentian Pasar Seni', lat: 3.1440, lng: 101.6970, routes: [3] },
  { id: 'kl:1003', name: 'Jalan Kampung Pasar', lat: 3.1500, lng: 101.7000, routes: [4] },
  { id: 'kl:1004', name: 'Sepasar Mall', lat: 3.1600, lng: 101.7100, routes: [4] },
  // Twin stops either side of a road, ~40 m apart.
  { id: '1005840', name: 'Hotel Lisa De Inn', lat: 3.05000, lng: 101.58000, routes: [0, 1] },
  { id: '1005841', name: 'Hotel Lisa De Inn', lat: 3.05035, lng: 101.58010, routes: [0, 2, 3, 4] },
  // Same name, far apart: two entries.
  { id: 'kl:2001', name: 'Masjid Jamek', lat: 3.1490, lng: 101.6960, routes: [2] },
  { id: 'kl:2002', name: 'Masjid Jamek', lat: 3.0500, lng: 101.5000, routes: [3] },
  { id: 'kl:3001', name: 'Café Ánggerik', lat: 3.1000, lng: 101.6000 },
  // RapidKL names: upper case, often after a stop code.
  { id: 'kl:4001', name: 'KL94 KLCC (UTARA)', lat: 3.1570, lng: 101.7120, routes: [2] },
  { id: 'kl:4002', name: 'JALAN AMPANG KLCC', lat: 3.1580, lng: 101.7100, routes: [3] },
]);

const IX = buildLocalIndex(NET, STATIONS);

test('prefix beats substring', () => {
  const hits = searchLocal(IX, 'pasar', null, 10);
  const names = hits.map((h) => h.name);
  // Whole-name prefix (station, then stop), then word prefix, then substring.
  assert.deepEqual(names, ['Pasar Seni', 'Pasar Seni', 'Hentian Pasar Seni', 'Jalan Kampung Pasar', 'Sepasar Mall']);
});

test('station outranks a stop with the same name', () => {
  const [first, second] = searchLocal(IX, 'Pasar Seni', null);
  assert.equal(first.kind, 'station');
  assert.equal(first.id, 'pasar-seni');
  assert.equal(second.kind, 'stop');
  assert.equal(second.id, 'kl:1001');
  if (first.kind === 'station') {
    assert.deepEqual(first.lineColors, ['#E0115F', '#047940']);
    assert.equal(first.lineCount, 2);
  }
});

test('stops in a station are folded into it', () => {
  const hits = searchLocal(IX, 'kl sentral', null);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'station');
  assert.ok(!searchLocal(IX, 'pasar', null, 20).some((h) => h.id === 'rail:KJ14'));
});

test('twin stops across a road appear once', () => {
  const hits = searchLocal(IX, 'hotel lisa', null);
  assert.equal(hits.length, 1);
  const [hit] = hits;
  assert.equal(hit.kind, 'stop');
  if (hit.kind === 'stop') {
    // Labels from both sides, unique, capped at three plus a count.
    assert.deepEqual(hit.routes, ['T816', 'T815', '300']);
    assert.equal(hit.routeCount, 5);
  }
  // The nearer twin is the one returned.
  assert.equal(searchLocal(IX, 'hotel lisa', { lat: 3.0504, lng: 101.5801 })[0].id, '1005841');
  assert.equal(searchLocal(IX, 'hotel lisa', { lat: 3.0499, lng: 101.58 })[0].id, '1005840');
});

test('nearer wins a tie', () => {
  const north = searchLocal(IX, 'masjid', { lat: 3.149, lng: 101.696 });
  assert.equal(north.length, 2);
  assert.equal(north[0].id, 'kl:2001');
  const south = searchLocal(IX, 'masjid', { lat: 3.05, lng: 101.5 });
  assert.equal(south[0].id, 'kl:2002');
});

test('empty query returns nothing', () => {
  assert.deepEqual(searchLocal(IX, '', null), []);
  assert.deepEqual(searchLocal(IX, '   ', null), []);
  assert.deepEqual(searchLocal(IX, '!?', null), []);
});

test('accents and punctuation fold', () => {
  assert.equal(normalizeName("  Café  Ánggerik's, (KL) "), 'cafe anggeriks kl');
  assert.equal(searchLocal(IX, 'cafe ang', null)[0]?.id, 'kl:3001');
});

test('limit caps the hits', () => {
  assert.equal(searchLocal(IX, 'a', null).length, 6);
  assert.equal(searchLocal(IX, 'a', null, 2).length, 2);
});

test('lookupLocal finds a station and keeps a stop on its own side', () => {
  const st = lookupLocal(IX, 'station', 'kl-sentral');
  assert.equal(st?.kind, 'station');
  const stop = lookupLocal(IX, 'stop', '1005841');
  assert.equal(stop?.id, '1005841');
  assert.equal(stop?.kind === 'stop' ? stop.routeCount : 0, 5);
  assert.equal(lookupLocal(IX, 'stop', 'missing'), null);
});

test('a leading stop code does not hide a name prefix', () => {
  const hits = searchLocal(IX, 'klcc', null);
  assert.deepEqual(
    hits.map((h) => h.name),
    ['KL94 Klcc (utara)', 'Jalan Ampang Klcc'],
  );
  // The code itself still finds it.
  assert.equal(searchLocal(IX, 'kl94', null)[0]?.id, 'kl:4001');
});
