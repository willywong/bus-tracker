import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEED_IDS,
  MODES,
  RAIL_LINES,
  RAIL_STATIONS,
  type FeedId,
  type Mode,
  type RailStation,
  type TransitNetwork,
} from '@bus-tracker/shared';

import {
  railAlpha,
  railLines,
  railStationMarks,
  railStationsFor,
  railZoomBand,
  stationsInFocus,
  zoomFromRegion,
} from '@/components/map/railModel';

interface Route {
  id: string;
  mode: Mode;
  feed: FeedId;
  color: string;
  shapeId: string;
}

/**
 * A network with just what the rail layer reads: stops, routes and pattern
 * stop lists. Everything else is empty.
 */
function net(spec: {
  stops: [lat: number, lon: number][];
  routes: Route[];
  patterns: { route: number; stops: number[] }[];
  stations?: RailStation[];
}): TransitNetwork {
  const { stops, routes, patterns } = spec;
  const flat = patterns.flatMap((p) => p.stops);
  const starts: number[] = [];
  let at = 0;
  for (const p of patterns) {
    starts.push(at);
    at += p.stops.length;
  }
  return {
    meta: { serviceDate: '20261028' },
    stops: {
      count: stops.length,
      id: stops.map((_, i) => `s${i}`),
      name: stops.map((_, i) => `Stop ${i}`),
      lat: Float32Array.from(stops.map((s) => s[0])),
      lon: Float32Array.from(stops.map((s) => s[1])),
    },
    stations: spec.stations ?? [],
    routes: {
      count: routes.length,
      id: routes.map((r) => r.id),
      label: routes.map((r) => r.id),
      longName: routes.map((r) => r.id),
      mode: Uint8Array.from(routes.map((r) => MODES.indexOf(r.mode))),
      color: routes.map((r) => r.color),
      textColor: routes.map(() => '#FFFFFF'),
      feed: Uint8Array.from(routes.map((r) => FEED_IDS.indexOf(r.feed))),
      shapeId: routes.map((r) => r.shapeId),
    },
    patterns: {
      count: patterns.length,
      route: Int32Array.from(patterns.map((p) => p.route)),
      stopStart: Int32Array.from(starts),
      stopLen: Int32Array.from(patterns.map((p) => p.stops.length)),
      stops: Int32Array.from(flat),
    },
  } as unknown as TransitNetwork;
}

const round = (c: { latitude: number; longitude: number }) => [
  Math.round(c.latitude * 1e4) / 1e4,
  Math.round(c.longitude * 1e4) / 1e4,
];

test('railAlpha dims to 59 below zoom 11 and is FF otherwise', () => {
  assert.equal(railAlpha('rail:KJ', null, true), '59');
  assert.equal(railAlpha('rail:KJ', null, false), 'FF');
  assert.equal(railZoomBand(10.9), 0);
  assert.equal(railZoomBand(11), 1);
  assert.equal(railZoomBand(11.99), 1);
  assert.equal(railZoomBand(12), 2);
  assert.equal(railZoomBand(Number.NaN), 0);
});

test('railAlpha focus keeps listed routes FF and drops others to 26', () => {
  const focus = ['rail:KJ', 'ktm:SB'];
  assert.equal(railAlpha('rail:KJ', focus, false), 'FF');
  assert.equal(railAlpha('ktm:SB', focus, true), 'FF');
  assert.equal(railAlpha('rail:AG', focus, false), '26');
  assert.equal(railAlpha('rail:AG', focus, true), '26');
});

test('railLines builds KTM from stop order when shapeId is empty', () => {
  const n = net({
    stops: [
      [3.1, 101.6],
      [3.2, 101.7],
      [3.3, 101.8],
      [3.0, 101.5],
    ],
    routes: [
      { id: 'kl:U400', mode: 'bus', feed: 'bus-kl', color: '#000000', shapeId: 'kl:shp' },
      { id: 'ktm:SB', mode: 'ktm', feed: 'ktm', color: '1964B7', shapeId: '' },
    ],
    patterns: [
      { route: 0, stops: [0, 1] },
      { route: 1, stops: [2, 1] },
      // The longest pattern wins, in its own stop order.
      { route: 1, stops: [3, 0, 1, 2] },
    ],
  });
  const lines = railLines(n, new Map());
  const ktm = lines.find((l) => l.routeId === 'ktm:SB');
  assert.ok(ktm);
  assert.equal(ktm.color, '#1964B7');
  assert.deepEqual(ktm.coords.map(round), [
    [3.0, 101.5],
    [3.1, 101.6],
    [3.2, 101.7],
    [3.3, 101.8],
  ]);
  // Buses are never drawn by the rail layer.
  assert.equal(lines.some((l) => l.routeId === 'kl:U400'), false);
});

test('railLines draws a stored shape for a rail route, else its stops', () => {
  const n = net({
    stops: [
      [3.1, 101.6],
      [3.2, 101.7],
    ],
    routes: [
      { id: 'rail:KJ', mode: 'lrt', feed: 'rail', color: '#D50032', shapeId: 'rail:shp_KJ_0' },
      { id: 'rail:AG', mode: 'lrt', feed: 'rail', color: '#E57200', shapeId: 'rail:shp_AG_0' },
    ],
    patterns: [
      { route: 0, stops: [0, 1] },
      { route: 1, stops: [1, 0] },
    ],
  });
  const shapes = new Map([['rail:KJ', Float32Array.from([3.1, 101.6, 3.15, 101.62, 3.2, 101.7])]]);
  const lines = railLines(n, shapes);
  assert.deepEqual(
    lines.map((l) => l.routeId),
    ['rail:KJ', 'rail:AG'],
  );
  assert.deepEqual(lines[0].coords.map(round), [
    [3.1, 101.6],
    [3.15, 101.62],
    [3.2, 101.7],
  ]);
  // No stored shape yet: station to station.
  assert.deepEqual(lines[1].coords.map(round), [
    [3.2, 101.7],
    [3.1, 101.6],
  ]);
});

test('railLines falls back to RAIL_STATIONS code order when network is null', () => {
  const lines = railLines(null, new Map());
  assert.equal(lines.length, RAIL_LINES.length);
  assert.deepEqual(
    lines.map((l) => l.routeId),
    RAIL_LINES.map((l) => l.code),
  );

  const kj = lines.find((l) => l.routeId === 'LRT KJ')!;
  assert.equal(kj.color, '#D50032');
  const stationAt = (c: { latitude: number; longitude: number }) =>
    RAIL_STATIONS.find((s) => s.lat === c.latitude && s.lng === c.longitude)!;
  const kjCodes = kj.coords.map((c) => stationAt(c).stopIds.find((id) => /^KJ\d/.test(id)));
  const kjNums = kjCodes.map((id) => Number(id!.slice(2)));
  assert.deepEqual(kjNums, [...kjNums].sort((a, b) => a - b));
  assert.equal(kjCodes[0], 'KJ1');

  // KG18A (Bukit Bintang) sorts by its number: after KG17, before KG20.
  const kg = lines.find((l) => l.routeId === 'MRT KG')!;
  const kgCodes = kg.coords.map((c) => stationAt(c).stopIds.find((id) => /^KG\d/.test(id))!);
  const at = kgCodes.indexOf('KG18A');
  assert.deepEqual(kgCodes.slice(at - 1, at + 2), ['KG17', 'KG18A', 'KG20']);
});

test('railLines adds the bundled lines when the rail feed is left out, keeping KTM', () => {
  const n = net({
    stops: [
      [3.1, 101.6],
      [3.2, 101.7],
    ],
    routes: [{ id: 'ktm:SB', mode: 'ktm', feed: 'ktm', color: '#1964B7', shapeId: '' }],
    patterns: [{ route: 0, stops: [0, 1] }],
  });
  const ids = railLines(n, new Map()).map((l) => l.routeId);
  assert.deepEqual(ids, [...RAIL_LINES.map((l) => l.code), 'ktm:SB']);
  const ktmStation: RailStation = {
    id: 'ktm-kl-sentral',
    name: 'KL Sentral',
    lat: 3.13,
    lng: 101.68,
    stopIds: ['ktm:19100'],
    lines: [],
  };
  const withKtm = net({ stops: [], routes: [], patterns: [], stations: [ktmStation] });
  assert.equal(railStationsFor(withKtm).length, RAIL_STATIONS.length + 1);
  assert.equal(railStationsFor(null), RAIL_STATIONS);
});

test('railStationMarks gives interchanges one colour per line', () => {
  const marks = railStationMarks(RAIL_STATIONS);
  const pasarSeni = marks.find((m) => m.id === 'pasar-seni')!;
  assert.equal(pasarSeni.interchange, true);
  assert.deepEqual(pasarSeni.colors, ['#D50032', '#047940']);
  assert.equal(pasarSeni.label, 'Kelana Jaya Line and Kajang Line station, Pasar Seni');

  const chanSowLin = marks.find((m) => m.id === 'chan-sow-lin')!;
  assert.equal(chanSowLin.colors.length, 3);
  assert.equal(
    chanSowLin.label,
    'Ampang Line, Sri Petaling Line and Putrajaya Line station, Chan Sow Lin',
  );

  const bangsar = marks.find((m) => m.id === 'bangsar')!;
  assert.equal(bangsar.interchange, false);
  assert.deepEqual(bangsar.colors, ['#D50032']);
  assert.equal(bangsar.label, 'Kelana Jaya Line station, Bangsar');

  // Below zoom 12 only interchanges show: a couple of dozen, not all 160.
  const interchanges = marks.filter((m) => m.interchange).length;
  assert.ok(interchanges >= 15 && interchanges <= 35, `${interchanges} interchanges`);
});

test('zoomFromRegion returns ~11 for KL_REGION on a 393 pt wide screen', () => {
  const z = zoomFromRegion(0.25, 393);
  assert.ok(Math.abs(z - 11) < 0.25, `zoom ${z}`);
  // Halving the span is one zoom level in.
  assert.ok(Math.abs(zoomFromRegion(0.125, 393) - z - 1) < 1e-9);
});

test('stationsInFocus keeps only stations on a focused line, all without focus', () => {
  const line = (routeId: string, color: string) => ({ routeId, color, coords: [] });
  const mark = (id: string, colors: string[]) => ({ id, name: id, lat: 0, lng: 0, colors, interchange: colors.length > 1, label: id });
  const lines = [line('rail:KJ', '#E0115F'), line('rail:MR', '#84C341')];
  const stations = [mark('kl-sentral', ['#e0115f', '#84c341']), mark('bukit-bintang', ['#84C341']), mark('kelana-jaya', ['#E0115F'])];
  assert.equal(stationsInFocus(stations, lines, null), stations);
  assert.deepEqual(
    stationsInFocus(stations, lines, ['rail:MR']).map((s) => s.id),
    ['kl-sentral', 'bukit-bintang'],
  );
  assert.deepEqual(stationsInFocus(stations, lines, ['rail:XX']), []);
});
