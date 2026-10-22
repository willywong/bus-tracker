import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Itinerary, Leg, LegPoint, Timing } from '@bus-tracker/shared';

import {
  durationLabel,
  feedNotes,
  journeySegments,
  leaveLabel,
  legChips,
  resultAccessibilityLabel,
  statusText,
  tagLabel,
  updatedNote,
  warningNote,
  type RouteInfo,
} from '../results';

const T0 = Date.UTC(2026, 9, 28, 0, 0); // 08:00 MYT
const MIN = 60_000;
/** "9:12": MYT, 12-hour, as the criterion writes it. */
const clock = (ms: number) => {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCHours() % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const ROUTES: RouteInfo = {
  longName: (r) => ['T816 feeder', 'MRT Kajang Line', 'LRT Kelana Jaya Line', 'KTM Komuter Seremban Line'][r] ?? '',
  textColor: (r) => (r === 3 ? '#FFFFFF' : '#FFFFFF'),
};

const pt = (name: string, min: number): LegPoint => ({ name, lat: 3.1, lng: 101.6, time: T0 + min * MIN });
const walk = (a: number, b: number, meters: number): Leg => ({
  kind: 'walk',
  from: pt('w', a),
  to: pt('w', b),
  meters,
  seconds: (b - a) * 60,
});
const ride = (
  mode: Extract<Leg, { kind: 'ride' }>['mode'],
  label: string,
  route: number,
  a: number,
  b: number,
  timing: Timing = { kind: 'scheduled' },
  color = '#000000',
): Leg => ({
  kind: 'ride',
  mode,
  route,
  label,
  color,
  headsign: 'x',
  from: pt('a', a),
  to: pt('b', b),
  via: [],
  timing,
});
const itinerary = (legs: Leg[], extra: Partial<Itinerary> = {}): Itinerary => ({
  id: 'it',
  departAt: legs[0].from.time,
  arriveAt: legs[legs.length - 1].to.time,
  legs,
  rides: legs.filter((l) => l.kind === 'ride').length,
  walkMeters: legs.reduce((s, l) => s + (l.kind === 'walk' ? l.meters : 0), 0),
  tags: [],
  warnings: [],
  ...extra,
});

/** Walk 5 → T816 (wait 2) → KG every 6 → walk 3: 08:00 to 08:38. */
const CRITERION = itinerary(
  [
    walk(0, 5, 400),
    ride('feeder', 'T816', 0, 7, 20),
    ride('mrt', 'KG', 1, 24, 35, { kind: 'headway', headwaySec: 360 }, '#047940'),
    walk(35, 38, 250),
  ],
  { tags: ['fastest'] },
);

test('leave label pluralises and switches to a clock past an hour', () => {
  assert.equal(leaveLabel(CRITERION, T0, clock), 'Leave now');
  assert.equal(leaveLabel(CRITERION, T0 + 30_000, clock), 'Leave now');
  assert.equal(leaveLabel(CRITERION, T0 - MIN, clock), 'Leave in 1 min');
  assert.equal(leaveLabel(CRITERION, T0 - 4 * MIN - 10_000, clock), 'Leave in 4 mins');
  assert.equal(leaveLabel(CRITERION, T0 - 59 * MIN, clock), 'Leave in 59 mins');
  assert.equal(leaveLabel(CRITERION, T0 - 60 * MIN, clock), 'Leave 8:00');
  assert.equal(durationLabel(CRITERION), '38 mins');
});

test('segments sum to the journey', () => {
  const segs = journeySegments(CRITERION);
  assert.deepEqual(
    segs.map((s) => [s.kind, s.seconds, s.color]),
    [
      ['walk', 300, null],
      ['wait', 120, null],
      ['bus', 780, null],
      ['rail', 900, '#047940'],
      ['walk', 180, null],
    ],
  );
  assert.equal(
    segs.reduce((s, x) => s + x.seconds, 0),
    (CRITERION.arriveAt - CRITERION.departAt) / 1000,
  );
});

test('wait segment only before the first ride', () => {
  // A snap walk (3 s) folds into the wait; the 4-min transfer wait belongs to the train.
  const it = itinerary([
    { kind: 'walk', from: pt('w', 0), to: { ...pt('w', 0), time: T0 + 3000 }, meters: 3, seconds: 3 },
    ride('bus', '770', 0, 2, 10),
    ride('lrt', 'KJ', 2, 14, 30, { kind: 'headway', headwaySec: 240 }, '#D50032'),
  ]);
  const segs = journeySegments(it);
  assert.deepEqual(segs.map((s) => s.kind), ['wait', 'bus', 'rail']);
  assert.equal(segs.filter((s) => s.kind === 'wait').length, 1);
  assert.equal(segs[0].seconds, 120);
  assert.equal(segs[2].seconds, 20 * 60);
  assert.equal(segs.reduce((s, x) => s + x.seconds, 0), 30 * 60);
});

test('status is Live only for a live first bus leg', () => {
  assert.deepEqual(statusText(CRITERION), { live: false, text: '1 change · 650 m walk' });
  const live = itinerary([
    walk(0, 5, 400),
    ride('feeder', 'T816', 0, 7, 20, { kind: 'live', vehicleId: 'v', asOf: T0, deltaSec: 60 }),
  ]);
  assert.deepEqual(statusText(live), { live: true, text: 'No changes · 400 m walk' });
  // A later live leg never counts; the first ride (rail) is never live.
  const railFirst = itinerary([
    ride('lrt', 'KJ', 2, 0, 10, { kind: 'headway', headwaySec: 240 }),
    ride('feeder', 'T816', 0, 12, 20, { kind: 'live', vehicleId: 'v', asOf: T0, deltaSec: 0 }),
    ride('bus', '770', 0, 22, 30),
    walk(30, 45, 1200),
  ]);
  assert.deepEqual(statusText(railFirst), { live: false, text: '2 changes · 1.2 km walk' });
  assert.equal(statusText(itinerary([walk(0, 20, 1500)])).text, 'Walk only · 1.5 km');
});

test('rail headway chip carries every', () => {
  const chips = legChips(CRITERION, ROUTES);
  assert.deepEqual(chips, [
    { kind: 'walk', minutes: 5 },
    { kind: 'bus', label: 'T816', every: null },
    { kind: 'rail', label: 'KG', name: 'Kajang Line', color: '#047940', textColor: '#FFFFFF', every: 6 },
    { kind: 'walk', minutes: 3 },
  ]);
  const ktm = legChips(itinerary([ride('ktm', 'KTM Seremban', 3, 0, 20)]), ROUTES);
  assert.equal(ktm[0].kind === 'rail' && ktm[0].label, 'KTM');
});

test('more than five chips fold inner walks', () => {
  const it = itinerary([
    walk(0, 3, 200),
    ride('bus', '770', 0, 4, 10),
    walk(10, 12, 100),
    ride('lrt', 'KJ', 2, 13, 20),
    walk(20, 22, 100),
    ride('mrt', 'KG', 1, 23, 30),
    walk(30, 33, 200),
  ]);
  assert.deepEqual(
    legChips(it, ROUTES).map((c) => c.kind),
    ['walk', 'bus', 'rail', 'rail', 'walk'],
  );
});

test('accessibility label matches criterion 7', () => {
  assert.equal(
    resultAccessibilityLabel(CRITERION, T0 - 4 * MIN, clock, ROUTES),
    'Leave in 4 minutes, scheduled. 38 minutes. Walk 5 minutes, bus T816, Kajang Line, walk 3 minutes. Arrive 8:38. Fastest.',
  );
  // README criterion 7's own example: live, 56 minutes, two lines.
  const live = itinerary(
    [
      walk(0, 5, 400),
      ride('feeder', 'T816', 0, 7, 20, { kind: 'live', vehicleId: 'v', asOf: T0, deltaSec: 0 }),
      ride('mrt', 'KG', 1, 24, 35, { kind: 'headway', headwaySec: 360 }),
      ride('lrt', 'KJ', 2, 38, 53, { kind: 'headway', headwaySec: 240 }),
      walk(53, 56, 250),
    ],
    { tags: ['fastest'] },
  );
  assert.equal(
    resultAccessibilityLabel(live, T0 - 4 * MIN, clock, ROUTES),
    'Leave in 4 minutes, live. 56 minutes. Walk 5 minutes, bus T816, Kajang Line, Kelana Jaya Line, walk 3 minutes. Arrive 8:56. Fastest.',
  );
});

test('updatedNote shows was for previousArriveAt', () => {
  const it = { ...CRITERION, arriveAt: CRITERION.arriveAt + 3 * MIN, previousArriveAt: CRITERION.arriveAt };
  assert.equal(updatedNote(it, clock), 'Updated · was 8:38');
  assert.equal(updatedNote(CRITERION, clock), null);
});

test('updatedNote ignores a sub-minute change', () => {
  const it = { ...CRITERION, arriveAt: CRITERION.arriveAt + 59_000, previousArriveAt: CRITERION.arriveAt };
  assert.equal(updatedNote(it, clock), null);
});

test('feedNotes covers rail and ktm and stays empty for none', () => {
  assert.deepEqual(feedNotes([]), []);
  assert.deepEqual(feedNotes(['ktm', 'rail']), [
    'Rail timetable from data.gov.my has expired. Showing bus-only routes.',
    'KTM timetable expired. Showing routes without KTM Komuter.',
  ]);
  assert.deepEqual(feedNotes(['feeder', 'bus-kl']), [
    'Rapid KL bus timetable expired. Showing other routes.',
    'MRT feeder timetable expired. Showing other routes.',
  ]);
});

test('warningNote maps missed-connection', () => {
  assert.equal(warningNote({ ...CRITERION, warnings: ['long-wait', 'missed-connection'] }), 'Connection missed. Times updated');
  assert.equal(warningNote({ ...CRITERION, warnings: ['last-service'] }), 'Last service tonight');
  assert.equal(warningNote({ ...CRITERION, warnings: ['long-wait'] }), 'Long wait for the first ride');
  assert.equal(warningNote(CRITERION), null);
});

test('tag label', () => {
  assert.equal(tagLabel(CRITERION), 'Fastest');
  assert.equal(tagLabel({ ...CRITERION, tags: ['less-walking'] }), 'Less walking');
  assert.equal(tagLabel({ ...CRITERION, tags: [] }), null);
});
