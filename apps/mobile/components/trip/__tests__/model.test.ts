import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTripModel,
  formatCountdown,
  formatDuration,
  formatIn,
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
  assert.deepEqual(m.hero, { text: '14', unit: 'mins', kind: 'minutes' });
  assert.equal(m.source, 'live');
  assert.equal(m.status, 'Live · 3 stops away');
  assert.equal(m.compact, '14 mins');
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
  assert.equal(m.status, 'Scheduled');
  assert.equal(m.detail, null);
  assert.match(m.accessibilityLabel, /scheduled time/);
});

test('feed error is a warning on the scheduled fallback, not status text', () => {
  const m = buildTripModel(
    input({
      mode: 'schedule',
      liveBusCount: 0,
      feedError: true,
      primaryArrival: { kind: 'sched', epochMs: min(9), tripId: 's1' },
      minutesToStop: 9,
    }),
  );
  assert.equal(m.status, 'Scheduled');
  const offline = m.notes.find((n) => n.id === 'offline');
  assert.equal(offline?.tone, 'warning');
  assert.equal(offline?.title, "Can't reach live data");
});

test('old live data is shown as ageing', () => {
  const m = buildTripModel(input({ lastUpdated: NOW - 3 * 60_000 }));
  assert.equal(m.source, 'aging');
  assert.equal(m.status, 'Updated 3 mins ago');
});

test('motion label wins over delay in the detail line', () => {
  const delay = { delayMinutes: 3, onTimeWindow: 'late' as const };
  assert.equal(buildTripModel(input({ delay })).detail, '3 mins behind schedule');
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
  assert.equal(m.then, 'Then 28 · 43 mins');
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
  assert.equal(m.detail, 'In 47 mins');
});

test('service ended', () => {
  const m = buildTripModel(
    input({ mode: 'none', primaryArrival: null, minutesToStop: null, serviceEnded: true }),
  );
  assert.equal(m.state, 'service-ended');
  assert.equal(m.hero, null);
});

test('formatters', () => {
  assert.equal(formatDuration(45), '45 mins');
  assert.equal(formatDuration(65), '1 h 5 mins');
  assert.equal(formatDuration(61), '1 h 1 min');
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
  assert.equal(down.status, 'Scheduled');
  assert.equal(ids(down)[0], 'feed-down');
  assert.ok(!ids(down).includes('ghost'));

  const quiet = buildTripModel(scheduledInput({ feedVehicleCount: 40 }));
  assert.equal(quiet.feedHealth, 'route-quiet');
  assert.equal(quiet.status, 'Scheduled');

  const offline = buildTripModel(scheduledInput({ feedError: true, feedVehicleCount: 40 }));
  assert.equal(offline.feedHealth, 'unreachable');
  assert.ok(!ids(offline).includes('ghost'));
});

test('ghost guard: bus due soon, nothing on the route reporting, feed healthy', () => {
  const m = buildTripModel(scheduledInput({ feedVehicleCount: 40, routeCode: 'T816' }));
  const ghost = m.notes.find((n) => n.id === 'ghost');
  assert.equal(ghost?.title, 'No bus on T816 is reporting yet');
  assert.equal(ghost?.text, 'This one may not run');
  // Far enough out that the bus may simply not have left the depot.
  const later = buildTripModel(
    scheduledInput({ feedVehicleCount: 40, minutesToStop: 25, primaryArrival: sched(25) }),
  );
  assert.ok(!ids(later).includes('ghost'));
});

test('"Then" row: the following bus and the wait if you miss this one', () => {
  assert.deepEqual(buildTripModel(input({ laterArrivals: [sched(44)] })).next, {
    clock: '02:44',
    wait: '+30 mins',
    live: false,
  });
  assert.equal(buildTripModel(input()).next, null);
});

test('last bus: heads-up late in the day, and a firm note on the final run', () => {
  const headsUp = buildTripModel(input({ laterArrivals: [sched(44)], lastBusToday: min(120) }));
  const lastNote = headsUp.notes.find((n) => n.id === 'last-bus');
  assert.equal(lastNote?.text, 'Last bus today at 04:00');
  assert.equal(lastNote?.value, '04:00');
  assert.ok(!ids(buildTripModel(input({ lastBusToday: min(300) }))).includes('last-bus'));

  const final = buildTripModel(input({ lastBusToday: min(12), laterArrivals: [sched(24 * 60)] }));
  assert.equal(final.notes.find((n) => n.id === 'last-bus')?.text, 'This is the last bus today');
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
    'Next two buses are 3 mins apart, then a 43-min gap',
  );
});

test('where-from names the stop the live bus is near; notes are capped', () => {
  // With a stop count, "near …" rides in the facts row instead of a note.
  const m = buildTripModel(
    input({ busNearStopName: 'Stesen MRT Phileo Damansara', stopsAhead: null }),
  );
  assert.equal(m.notes.find((n) => n.id === 'where-from')?.text, 'Now near Stesen MRT Phileo Damansara');

  const busy = buildTripModel(
    scheduledInput({
      feedVehicleCount: 0,
      lastBusToday: min(60),
      laterArrivals: [sched(40)],
      rainNudge: {
        condition: 'heavy-rain',
        title: 'Heavy rain warning',
        message: 'Petaling until 18:00 — leave a few minutes early',
      },
    }),
  );
  assert.deepEqual(ids(busy), ['feed-down', 'last-bus', 'rain']);
  const rain = busy.notes.find((n) => n.id === 'rain');
  assert.equal(rain?.icon, 'cloud.heavyrain.fill');
  assert.equal(rain?.title, 'Heavy rain warning');
});

test('"Then" never mixes a bare minute count with a clock time', () => {
  assert.equal(buildTripModel(input({ laterArrivals: [sched(30), sched(45)] })).then, 'Then 30 · 45 mins');
  assert.equal(buildTripModel(input({ laterArrivals: [sched(53), sched(83)] })).then, 'Then 02:53 · 03:23');
});

test('source line: live with timing and freshness, scheduled plain (the reason is a warning), ageing with its age', () => {
  assert.deepEqual(
    buildTripModel(
      input({ lastUpdated: min(-1) + 30_000, delay: { delayMinutes: 8, onTimeWindow: 'late' } }),
    ).sourceLine,
    { label: 'Live', note: '8 mins late', updated: 'Updated 01:59', arrives: 'Arrives 02:14' },
  );
  assert.deepEqual(buildTripModel(input({ mode: 'schedule', liveBusCount: 0 })).sourceLine, {
    label: 'Scheduled',
    note: null,
    updated: null,
    arrives: 'Arrives 02:14',
  });
  assert.deepEqual(buildTripModel(input({ lastUpdated: min(-3) })).sourceLine, {
    label: 'Live',
    note: null,
    updated: 'Updated 3 mins ago',
    arrives: 'Arrives 02:14',
  });
});

test('source line: timing wording, and motion when there is no timing', () => {
  const note = (patch: Partial<TripModelInput>) => buildTripModel(input(patch)).sourceLine.note;
  assert.equal(note({ delay: { delayMinutes: 0, onTimeWindow: 'on-time' } }), 'On time');
  assert.equal(note({ delay: { delayMinutes: -2, onTimeWindow: 'early' } }), '2 mins early');
  assert.equal(note({ motionLabel: 'Stopped' }), 'Stopped');
});

test('facts: where the bus is and the next bus; timing stays in the source line', () => {
  const m = buildTripModel(
    input({
      stopsAhead: 0,
      busNearStopName: 'Komersial SS19/8',
      delay: { delayMinutes: -2, onTimeWindow: 'early' },
      motionLabel: 'Slow traffic',
      laterArrivals: [sched(44)],
    }),
  );
  assert.deepEqual(m.facts, [
    {
      id: 'position',
      label: 'Your bus',
      value: 'Next stop',
      caption: 'Near Komersial SS19/8',
    },
  ]);
  assert.equal(m.sourceLine.note, '2 mins early');
  // The grid carries "near …", so the separate note isn't repeated.
  assert.ok(!m.notes.some((n) => n.id === 'where-from'));
});

test('facts: stop counts; motion under the bus only when timing took the note', () => {
  const bus = (patch: Partial<TripModelInput>) =>
    buildTripModel(input(patch)).facts.find((f) => f.id === 'position');
  assert.equal(bus({ stopsAhead: 3 })?.value, '3 stops away');
  assert.equal(bus({ stopsAhead: 1 })?.value, '1 stop away');
  assert.equal(
    bus({ stopsAhead: 2, motionLabel: 'Slow traffic', delay: { delayMinutes: 4, onTimeWindow: 'late' } })
      ?.caption,
    'Slow traffic',
  );
  assert.equal(bus({ stopsAhead: 2, motionLabel: 'Slow traffic' })?.caption, null);
  assert.equal(bus({ stopsAhead: null }), undefined);
});

test('facts: a scheduled arrival has none (later buses live in the Today grid)', () => {
  const m = buildTripModel(
    input({ mode: 'schedule', liveBusCount: 0, stopsAhead: 2, laterArrivals: [sched(44)] }),
  );
  assert.deepEqual(m.facts, []);
});

test('formatIn counts from now, singular and past the hour', () => {
  assert.equal(formatIn(1), 'in 1 min');
  assert.equal(formatIn(33), 'in 33 mins');
  assert.equal(formatIn(60), 'in 1 h');
  assert.equal(formatIn(61), 'in 1 h 1 min');
  assert.equal(formatIn(95), 'in 1 h 35 mins');
});
