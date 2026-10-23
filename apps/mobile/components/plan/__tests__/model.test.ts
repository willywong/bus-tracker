import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SavedPlace } from '@/hooks/useSettings';

import {
  defaultDepartAt,
  localRow,
  NETWORK_PENDING,
  networkEndMs,
  PLACES_OFFLINE,
  placeRow,
  QUIET_EMPTY,
  recentRow,
  routeRow,
  routesText,
  savedInOrder,
  savedRow,
  searchSections,
  type SearchInput,
} from '../model';

test('station row: squares, line count and spoken label', () => {
  const row = localRow({
    kind: 'station',
    id: 'pasar-seni',
    name: 'Pasar Seni',
    lat: 3.14,
    lng: 101.69,
    lineColors: ['#E0115F', '#047940', '#1', '#2', '#3', '#4'],
    lineCount: 2,
  });
  assert.deepEqual(row.lead, { kind: 'squares', colors: ['#E0115F', '#047940', '#1', '#2'], more: 2 });
  assert.equal(row.subtitle, '2 lines');
  assert.equal(row.accessibilityLabel, 'Station, Pasar Seni, 2 lines');
});

test('stop row: routes capped with a count', () => {
  const two = localRow({ kind: 'stop', id: '1', name: 'Hotel Lisa De Inn', lat: 0, lng: 0, routes: ['T816', 'T815'], routeCount: 2 });
  assert.equal(two.subtitle, 'T816 · T815');
  assert.equal(two.accessibilityLabel, 'Bus stop, Hotel Lisa De Inn, routes T816 and T815');
  const five = localRow({ kind: 'stop', id: '1', name: 'X', lat: 0, lng: 0, routes: ['T816', 'T815', '300'], routeCount: 5 });
  assert.equal(five.subtitle, 'T816 · T815 · 300 · +2');
  assert.equal(five.accessibilityLabel, 'Bus stop, X, routes T816, T815, 300 and 2 more');
  assert.equal(routesText(['T816'], 1), 'T816');
});

test('place row: pin until resolved, then glyph and distance', () => {
  const base = { id: 'c1', title: 'Pavilion Kuala Lumpur', subtitle: 'Bukit Bintang' };
  const pending = placeRow({ ...base, symbol: 'mappin', meters: null });
  assert.deepEqual(pending.lead, { kind: 'symbol', name: 'mappin' });
  assert.equal(pending.trailing, null);
  assert.equal(pending.accessibilityLabel, 'Place, Pavilion Kuala Lumpur, Bukit Bintang');
  const done = placeRow({ ...base, symbol: 'bag.fill', meters: 1210 });
  assert.equal(done.trailing, '1.2 km');
  assert.equal(done.accessibilityLabel, 'Place, Pavilion Kuala Lumpur, Bukit Bintang, 1.2 kilometres');
  assert.equal(placeRow({ ...base, symbol: 'bag.fill', meters: 420 }).accessibilityLabel.endsWith('420 metres'), true);
});

test('recent row keeps its kind', () => {
  const r = recentRow(
    { kind: 'station', name: 'KL Sentral', lat: 3.13, lng: 101.68, ref: 'kl-sentral', usedAt: 1 },
    { kind: 'station', id: 'kl-sentral', name: 'KL Sentral', lat: 3.13, lng: 101.68, lineColors: ['#E0115F'], lineCount: 1 },
  );
  assert.deepEqual(r.lead, { kind: 'symbol', name: 'clock.arrow.circlepath' });
  assert.equal(r.subtitle, '1 line');
  const p = recentRow({ kind: 'place', name: 'Suria KLCC', lat: 3.15, lng: 101.71, usedAt: 1, address: 'Jalan Ampang' }, null);
  assert.equal(p.subtitle, 'Jalan Ampang');
  assert.equal(p.accessibilityLabel, 'Recent, Place, Suria KLCC, Jalan Ampang');
});

test('saved: home, work, then six newest pins', () => {
  const mk = (kind: SavedPlace['kind'], createdAt: number): SavedPlace => ({
    id: kind === 'pin' ? `pin-${createdAt}` : kind,
    kind,
    name: `${kind} ${createdAt}`,
    address: null,
    lat: 3,
    lng: 101,
    ref: null,
    createdAt,
  });
  const list = [mk('pin', 1), mk('work', 2), ...[3, 4, 5, 6, 7, 8, 9].map((t) => mk('pin', t)), mk('home', 10)];
  const ordered = savedInOrder(list);
  assert.deepEqual(
    ordered.map((p) => p.id),
    ['home', 'work', 'pin-9', 'pin-8', 'pin-7', 'pin-6', 'pin-5', 'pin-4'],
  );
  const home = savedRow(ordered[0]);
  assert.equal(home.title, 'Home');
  assert.deepEqual(home.lead, { kind: 'symbol', name: 'house.fill' });
  assert.deepEqual(savedRow(ordered[1]).lead, { kind: 'symbol', name: 'briefcase.fill' });
  assert.deepEqual(savedRow(ordered[2]).lead, { kind: 'symbol', name: 'mappin' });
  assert.equal(savedRow(ordered[2]).title, 'pin 9');
});

test('depart-at range ends 04:00 MYT after tomorrow', () => {
  // 2026-10-23 10:00 MYT → service day 23rd; tomorrow's ends 25th 04:00 MYT.
  const morning = Date.UTC(2026, 9, 23, 2);
  assert.equal(networkEndMs(morning), Date.UTC(2026, 9, 24, 20));
  // 2026-10-24 01:30 MYT is still the 23rd's service day.
  const lateNight = Date.UTC(2026, 9, 23, 17, 30);
  assert.equal(networkEndMs(lateNight), Date.UTC(2026, 9, 24, 20));
  // 04:00 MYT starts the 24th's.
  assert.equal(networkEndMs(Date.UTC(2026, 9, 23, 20)), Date.UTC(2026, 9, 25, 20));
});

test('depart-at defaults to the next five minutes', () => {
  const t = Date.UTC(2026, 9, 23, 2, 7, 30);
  assert.equal(defaultDepartAt(t), Date.UTC(2026, 9, 23, 2, 10));
  assert.equal(defaultDepartAt(Date.UTC(2026, 9, 23, 2, 9, 30)), Date.UTC(2026, 9, 23, 2, 15));
});

const INPUT: SearchInput = {
  query: '',
  local: [],
  routes: [],
  places: [],
  placesOffline: false,
  placesLoading: false,
  recents: [],
  saved: [],
  offerHere: false,
};

const titles = (v: ReturnType<typeof searchSections>) =>
  v.kind === 'sections' ? v.sections.map((s) => s.title ?? s.key) : [v.kind];

test('empty query: recent then saved, or one quiet line', () => {
  const quiet = searchSections(INPUT);
  assert.deepEqual(titles(quiet), ['quiet']);
  assert.equal(quiet.kind === 'sections' && quiet.sections[0].items[0].kind === 'note' && quiet.sections[0].items[0].text, QUIET_EMPTY);
  const full = searchSections({
    ...INPUT,
    recents: [{ recent: { kind: 'place', name: 'KLCC', lat: 3, lng: 101, usedAt: 1 }, local: null }],
    saved: [{ id: 'home', kind: 'home', name: 'Condo', address: null, lat: 3, lng: 101, ref: { kind: 'stop', id: '1005840' }, createdAt: 1 }],
  });
  assert.deepEqual(titles(full), ['Recent', 'Saved']);
  const home = full.kind === 'sections' ? full.sections[1].items[0] : null;
  assert.deepEqual(home?.kind === 'row' && home.target, {
    kind: 'ready',
    place: { kind: 'stop', name: 'Condo', lat: 3, lng: 101, ref: '1005840' },
  });
});

test('typing: local then places; offline and network notes', () => {
  const stop = { kind: 'stop' as const, id: '1', name: 'KLCC', lat: 3, lng: 101, routes: [], routeCount: 0 };
  const place = { id: 'c', title: 'Suria KLCC', subtitle: 'KL', symbol: 'mappin' as const, meters: null };
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 'klcc', local: [stop], places: [place] })), [
    'Stations and stops',
    'Places',
  ]);
  const offline = searchSections({ ...INPUT, query: 'klcc', local: [stop], placesOffline: true });
  assert.deepEqual(titles(offline), ['Stations and stops', 'Places']);
  const note = offline.kind === 'sections' ? offline.sections[1].items[0] : null;
  assert.deepEqual(note, { kind: 'note', symbol: 'wifi.slash', text: PLACES_OFFLINE });
  const pending = searchSections({ ...INPUT, query: 'klcc', local: null, places: [place] });
  const first = pending.kind === 'sections' ? pending.sections[0].items[0] : null;
  assert.equal(first?.kind === 'note' && first.text, NETWORK_PENDING);
});

test('no match at all is the empty view, but not while places load', () => {
  assert.deepEqual(searchSections({ ...INPUT, query: 'zzz' }), { kind: 'no-results', query: 'zzz' });
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 'zzz', placesLoading: true })), []);
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 'zzz', offerHere: true })), ['here']);
});

test('typing a route code: Routes first, and a route alone is not "no results"', () => {
  const route = {
    route: 0,
    label: 'T816',
    longName: '',
    pattern: 0,
    fromStopIndex: 3,
    stopName: 'Hotel Lisa De Inn',
    towards: 'Pasar Seni',
    meters: 450,
  };
  const view = searchSections({ ...INPUT, query: 't816', routes: [route] });
  assert.deepEqual(titles(view), ['Routes']);
  const item = view.kind === 'sections' ? view.sections[0].items[0] : null;
  assert.equal(item?.kind === 'row' && item.target.kind, 'route');
  assert.equal(item?.kind === 'row' && item.row.title, 'T816');
  assert.equal(item?.kind === 'row' && item.row.subtitle, 'To Pasar Seni');
  assert.equal(item?.kind === 'row' && item.row.trailing, '450 m');
  assert.equal(
    item?.kind === 'row' && item.row.accessibilityLabel,
    'Route, T816, To Pasar Seni, nearest stop Hotel Lisa De Inn, 450 metres',
  );
  const stop = { kind: 'stop' as const, id: '1', name: 'T816 Stop', lat: 3, lng: 101, routes: [], routeCount: 0 };
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 't816', routes: [route], local: [stop] })), [
    'Routes',
    'Stations and stops',
  ]);
});

test('a route named only by its code reads its direction; a real name reads as itself', () => {
  const base = { route: 0, pattern: 0, fromStopIndex: 0, stopName: 'A', towards: 'Atwater', meters: null };
  assert.equal(routeRow({ ...base, label: 'T815', longName: 'T815' }).subtitle, 'To Atwater');
  assert.equal(routeRow({ ...base, label: '300', longName: 'Hab Pasar Seni ~ Kepong' }).subtitle, 'Hab Pasar Seni ~ Kepong');
});

test('a whole route code hides places; a partial one keeps them', () => {
  const route = { route: 0, label: 'T815', longName: '', pattern: 0, fromStopIndex: 0, stopName: 'A', towards: 'B', meters: null };
  const place = { id: 'c', title: '34 The Park', subtitle: 'Dublin D17 T815', symbol: 'mappin' as const, meters: null };
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 'T815', routes: [route], places: [place] })), ['Routes']);
  assert.deepEqual(titles(searchSections({ ...INPUT, query: 't81', routes: [route], places: [place] })), [
    'Routes',
    'Places',
  ]);
});
