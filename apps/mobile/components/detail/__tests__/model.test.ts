import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBusDetail,
  buildStopDetail,
  formatDistance,
  stopRelation,
  type BusDetailInput,
  type StopDetailInput,
} from '@/components/detail/model';

const NOW = Date.UTC(2026, 9, 21, 2, 0);
const min = (m: number) => NOW + m * 60_000;
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const stop = (patch: Partial<StopDetailInput> = {}): StopDetailInput => ({
  stopName: 'Bomba SS2',
  routeCode: 'T816',
  stopIndex: 4,
  userStopIndex: 7,
  stopCount: 20,
  live: null,
  scheduled: [min(6), min(36)],
  now: NOW,
  formatClock: clock,
  otherRoutes: [],
  wheelchair: null,
  ...patch,
});

test('stop relation on a loop: before, after, yours', () => {
  assert.equal(stopRelation(4, 7, 20), '3 stops before yours');
  assert.equal(stopRelation(6, 7, 20), '1 stop before yours');
  assert.equal(stopRelation(9, 7, 20), '2 stops after yours');
  // Wraps around the loop: 19 → 0 → 1 is two stops before yours at 1.
  assert.equal(stopRelation(19, 1, 20), '2 stops before yours');
  assert.equal(stopRelation(7, 7, 20), 'Your stop');
  assert.equal(stopRelation(null, 7, 20), null);
});

test('stop detail: live bus leads, with the next scheduled one as a fact', () => {
  const m = buildStopDetail(stop({ live: { minutes: 4.4, stopsAway: 2 } }));
  assert.equal(m.title, 'Bomba SS2');
  assert.equal(m.subtitle, 'Stop 5 of 20 · 3 stops before yours');
  assert.deepEqual(m.hero, { text: '4', unit: 'mins', kind: 'minutes' });
  assert.equal(m.source, 'live');
  assert.deepEqual(m.line, ['2 stops away']);
  assert.equal(m.stopsAhead, 2);
  assert.deepEqual(m.facts[0], {
    id: 'next',
    label: 'Next scheduled',
    value: '02:06',
    caption: null,
  });
  assert.equal(m.peek, 'Next T816 in 4 mins');
});

test('stop detail: scheduled only, bus after, wheelchair info', () => {
  const m = buildStopDetail(stop({ wheelchair: 1 }));
  assert.deepEqual(m.hero, { text: '6', unit: 'mins', kind: 'minutes' });
  assert.equal(m.source, 'scheduled');
  assert.deepEqual(m.line, ['Departs 02:06']);
  assert.equal(m.stopsAhead, null);
  assert.deepEqual(
    m.facts.map((f) => [f.label, f.value]),
    [
      ['Bus after', '02:36'],
      ['Wheelchair', 'Step-free'],
    ],
  );
});

test('stop detail: other routes when there is no access info; nothing left today', () => {
  assert.deepEqual(buildStopDetail(stop({ otherRoutes: ['T815', 'T817'] })).facts[1], {
    id: 'routes',
    label: 'Routes here',
    value: '3 routes',
    caption: 'Also T815, T817',
  });
  const done = buildStopDetail(stop({ scheduled: [] }));
  assert.equal(done.hero, null);
  assert.equal(done.peek, 'No more buses today');
});

const bus = (patch: Partial<BusDetailInput> = {}): BusDetailInput => ({
  routeCode: 'T816',
  headsign: 'Stesen MRT Phileo Damansara',
  reporting: true,
  isYourBus: false,
  speedKmh: 23.6,
  motionLabel: null,
  observedAt: NOW - 20_000,
  now: NOW,
  formatClock: clock,
  nearStopName: 'Bomba SS2',
  toYourStop: { minutes: 7.2, stopsAway: 3, meters: 1840 },
  passed: false,
  yourStopName: 'Hotel Lisa De Inn',
  ...patch,
});

test('bus detail: approaching your stop', () => {
  const m = buildBusDetail(bus());
  assert.equal(m.title, 'To Stesen MRT Phileo Damansara');
  assert.equal(m.subtitle, 'Near Bomba SS2');
  assert.deepEqual(m.hero, { text: '7', unit: 'mins', kind: 'minutes' });
  assert.deepEqual(m.line, ['Moving · 24 km/h']);
  assert.equal(m.stopsAhead, 3);
  assert.deepEqual(
    m.facts.map((f) => [f.value, f.caption]),
    [
      ['3 stops away', 'Hotel Lisa De Inn'],
      ['1.8 km', 'Along the route'],
    ],
  );
  assert.equal(m.peek, '7 mins to Hotel Lisa De Inn');
});

test('bus detail: your bus, passed, stale and lost', () => {
  assert.equal(buildBusDetail(bus({ isYourBus: true })).subtitle, 'Your bus');
  const passed = buildBusDetail(bus({ passed: true }));
  assert.equal(passed.hero, null);
  assert.equal(passed.stopsAhead, null);
  assert.equal(passed.line[0], 'Passed Hotel Lisa De Inn');
  assert.deepEqual(buildBusDetail(bus({ observedAt: NOW - 4 * 60_000 })).line, [
    'Moving · 24 km/h',
    'Updated 4 mins ago',
  ]);
  const lost = buildBusDetail(bus({ reporting: false }));
  assert.equal(lost.source, null);
  assert.equal(lost.line[0], 'Stopped reporting · last seen 01:59');
});

test('distance formatting', () => {
  assert.equal(formatDistance(4), '10 m');
  assert.equal(formatDistance(640), '640 m');
  assert.equal(formatDistance(1840), '1.8 km');
});
