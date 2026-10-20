import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTripModel,
  formatCountdown,
  formatDuration,
  type TripModelInput,
} from '../model';

const NOW = Date.UTC(2026, 9, 20, 2, 0, 0);
const min = (m: number) => NOW + m * 60_000;
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

function input(patch: Partial<TripModelInput> = {}): TripModelInput {
  return {
    hasFavorites: true,
    ready: true,
    now: NOW,
    mode: 'live',
    minutesToStop: 14,
    primaryArrival: { kind: 'live', epochMs: min(14), tripId: 'live-1' },
    laterArrivals: [],
    arrivalStatus: 'en-route',
    delay: null,
    serviceEnded: false,
    beforeServiceStart: false,
    firstBusToday: null,
    lastBusToday: null,
    liveBusCount: 2,
    lastUpdated: NOW - 10_000,
    feedError: false,
    stopsAhead: 3,
    motionLabel: null,
    walkMinutes: 5,
    walkRemainingSeconds: null,
    isFollowing: false,
    formatClock: clock,
    ...patch,
  };
}

test('no favourites → empty state', () => {
  assert.equal(buildTripModel(input({ hasFavorites: false })).state, 'empty');
});

test('static data not ready → loading', () => {
  const m = buildTripModel(input({ ready: false }));
  assert.equal(m.state, 'loading');
  assert.equal(m.hero, null);
});

test('live arrival shows minutes, live status with stops away', () => {
  const m = buildTripModel(input());
  assert.equal(m.state, 'arrival');
  assert.deepEqual(m.hero, { text: '14', unit: 'min', kind: 'minutes' });
  assert.equal(m.source, 'live');
  assert.equal(m.status, 'Live · 3 stops away');
  assert.equal(m.compact, '14 min');
  assert.match(m.accessibilityLabel, /in 14 minutes, live, 3 stops away/);
});

test('under one minute reads "Due", never "0 min"', () => {
  const m = buildTripModel(input({ minutesToStop: 0 }));
  assert.equal(m.hero?.text, 'Due');
  assert.equal(m.hero?.unit, null);
});

test('arriving / at stop words only for live buses', () => {
  assert.equal(buildTripModel(input({ arrivalStatus: 'arriving', minutesToStop: 1 })).hero?.text, 'Arriving');
  assert.equal(buildTripModel(input({ arrivalStatus: 'arrived', minutesToStop: 0 })).hero?.text, 'At stop');
  const sched = buildTripModel(
    input({
      mode: 'schedule',
      arrivalStatus: 'arriving',
      minutesToStop: 4,
      primaryArrival: { kind: 'sched', epochMs: min(4), tripId: 's1' },
    }),
  );
  assert.equal(sched.hero?.text, '4');
});

test('60 minutes or more switches to clock time', () => {
  const m = buildTripModel(
    input({ minutesToStop: 75, primaryArrival: { kind: 'live', epochMs: min(75), tripId: 'x' } }),
  );
  assert.equal(m.hero?.kind, 'clock');
  assert.equal(m.hero?.text, clock(min(75)));
});

test('scheduled arrivals never wear the live presentation', () => {
  const m = buildTripModel(
    input({
      mode: 'schedule',
      liveBusCount: 0,
      primaryArrival: { kind: 'sched', epochMs: min(9), tripId: 's1' },
      minutesToStop: 9,
    }),
  );
  assert.equal(m.source, 'scheduled');
  assert.equal(m.status, 'Scheduled · no live buses reporting');
  assert.equal(m.detail, null);
  assert.match(m.accessibilityLabel, /scheduled time/);
});

test('feed error is said out loud on the scheduled fallback', () => {
  const m = buildTripModel(
    input({
      mode: 'schedule',
      liveBusCount: 0,
      feedError: true,
      primaryArrival: { kind: 'sched', epochMs: min(9), tripId: 's1' },
      minutesToStop: 9,
    }),
  );
  assert.equal(m.status, "Scheduled · can't reach live data");
});

test('old live data is shown as ageing', () => {
  const m = buildTripModel(input({ lastUpdated: NOW - 3 * 60_000 }));
  assert.equal(m.source, 'aging');
  assert.equal(m.status, 'Updated 3 min ago');
});

test('motion label wins over delay in the detail line', () => {
  const delay = { delayMinutes: 3, onTimeWindow: 'late' as const };
  assert.equal(buildTripModel(input({ delay })).detail, '3 min behind schedule');
  assert.equal(
    buildTripModel(input({ delay, motionLabel: 'Stopped at a traffic light' })).detail,
    'Stopped at a traffic light',
  );
});

test('"Then" skips the primary trip and duplicates, max two', () => {
  const m = buildTripModel(
    input({
      laterArrivals: [
        { kind: 'sched', epochMs: min(14), tripId: 'live-1' },
        { kind: 'sched', epochMs: min(28), tripId: 's2' },
        { kind: 'sched', epochMs: min(28), tripId: 's2' },
        { kind: 'sched', epochMs: min(43), tripId: 's3' },
        { kind: 'sched', epochMs: min(58), tripId: 's4' },
      ],
    }),
  );
  assert.equal(m.then, 'Then 28 · 43 min');
});

test('actions: follow → leave now → tight → walking', () => {
  assert.deepEqual(buildTripModel(input()).action, {
    kind: 'follow',
    leaveInMinutes: 9,
    following: false,
  });
  assert.deepEqual(buildTripModel(input({ minutesToStop: 7 })).action, {
    kind: 'leave-now',
    following: false,
  });
  assert.deepEqual(buildTripModel(input({ minutesToStop: 3 })).action, { kind: 'tight' });
  assert.deepEqual(buildTripModel(input({ walkRemainingSeconds: 185 })).action, {
    kind: 'walking',
    remainingSeconds: 185,
  });
});

test('before first bus shows its clock time', () => {
  const m = buildTripModel(
    input({
      mode: 'none',
      primaryArrival: null,
      minutesToStop: null,
      beforeServiceStart: true,
      firstBusToday: min(47),
    }),
  );
  assert.equal(m.state, 'before-service');
  assert.equal(m.heroEyebrow, 'First bus');
  assert.equal(m.hero?.text, clock(min(47)));
  assert.equal(m.detail, 'In 47 min');
});

test('service ended', () => {
  const m = buildTripModel(
    input({ mode: 'none', primaryArrival: null, minutesToStop: null, serviceEnded: true }),
  );
  assert.equal(m.state, 'service-ended');
  assert.equal(m.hero, null);
});

test('formatters', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(65), '1 h 5 min');
  assert.equal(formatDuration(120), '2 h');
  assert.equal(formatCountdown(185), '3:05');
});

const sched = (m: number, tripId = `s${m}`) => ({ kind: 'sched' as const, epochMs: min(m), tripId });
const scheduledInput = (patch: Partial<TripModelInput> = {}) =>
  input({
    mode: 'schedule',
    minutesToStop: 10,
    primaryArrival: sched(10),
    liveBusCount: 0,
    stopsAhead: null,
    ...patch,
  });
const ids = (m: ReturnType<typeof buildTripModel>) => m.notes.map((n) => n.id);

test('live ETAs carry their "as of" time; scheduled ones never do', () => {
  assert.equal(buildTripModel(input({ lastUpdated: min(-1) + 30_000 })).freshness, 'as of 01:59');
  assert.equal(buildTripModel(scheduledInput()).freshness, null);
});

test('whole feed empty reads as "live data is down", not a quiet route', () => {
  const down = buildTripModel(scheduledInput({ feedVehicleCount: 0 }));
  assert.equal(down.feedHealth, 'feed-down');
  assert.equal(down.status, 'Scheduled · live data is down');
  assert.equal(ids(down)[0], 'feed-down');
  assert.ok(!ids(down).includes('ghost'));

  const quiet = buildTripModel(scheduledInput({ feedVehicleCount: 40 }));
  assert.equal(quiet.feedHealth, 'route-quiet');
  assert.equal(quiet.status, 'Scheduled · no live buses reporting');

  const offline = buildTripModel(scheduledInput({ feedError: true, feedVehicleCount: 40 }));
  assert.equal(offline.feedHealth, 'unreachable');
  assert.ok(!ids(offline).includes('ghost'));
});

test('ghost guard: bus due soon, nothing on the route reporting, feed healthy', () => {
  const m = buildTripModel(scheduledInput({ feedVehicleCount: 40, routeCode: 'T816' }));
  const ghost = m.notes.find((n) => n.id === 'ghost');
  assert.equal(ghost?.text, 'No bus on T816 is reporting yet. This one may not run.');
  // Far enough out that the bus may simply not have left the depot.
  const later = buildTripModel(
    scheduledInput({ feedVehicleCount: 40, minutesToStop: 25, primaryArrival: sched(25) }),
  );
  assert.ok(!ids(later).includes('ghost'));
});

test('miss cost shows when the next bus is a long wait away', () => {
  const m = buildTripModel(input({ laterArrivals: [sched(44)] }));
  assert.equal(
    m.notes.find((n) => n.id === 'miss-cost')?.text,
    'Miss it and the next is at 02:44, 30 min later.',
  );
  assert.ok(!ids(buildTripModel(input({ laterArrivals: [sched(24)] }))).includes('miss-cost'));
});

test('last bus: heads-up late in the day, and a firm note on the final run', () => {
  const headsUp = buildTripModel(input({ laterArrivals: [sched(44)], lastBusToday: min(120) }));
  assert.equal(headsUp.notes.find((n) => n.id === 'last-bus')?.text, 'Last bus today at 04:00.');
  assert.ok(!ids(buildTripModel(input({ lastBusToday: min(300) }))).includes('last-bus'));

  const final = buildTripModel(input({ lastBusToday: min(12), laterArrivals: [sched(24 * 60)] }));
  assert.equal(final.notes.find((n) => n.id === 'last-bus')?.text, 'This is the last bus today.');
  assert.ok(!ids(final).includes('miss-cost'));
});

test('bunching: two live buses close together, then a gap', () => {
  const m = buildTripModel(
    input({
      laterArrivals: [
        { kind: 'live', epochMs: min(17), tripId: 'live-2' },
        sched(60),
      ],
    }),
  );
  assert.equal(
    m.notes.find((n) => n.id === 'bunching')?.text,
    'Next two buses are 3 min apart, then a 43 min gap.',
  );
  assert.ok(!ids(m).includes('miss-cost'));
});

test('where-from names the stop the live bus is near; notes are capped', () => {
  const m = buildTripModel(input({ busNearStopName: 'Stesen MRT Phileo Damansara' }));
  assert.equal(m.notes.find((n) => n.id === 'where-from')?.text, 'Now near Stesen MRT Phileo Damansara.');

  const busy = buildTripModel(
    scheduledInput({
      feedVehicleCount: 0,
      lastBusToday: min(60),
      laterArrivals: [sched(40)],
      rainNudge: 'Rain warning for Petaling. Leave a few minutes early.',
    }),
  );
  assert.deepEqual(ids(busy), ['feed-down', 'last-bus', 'rain']);
});
