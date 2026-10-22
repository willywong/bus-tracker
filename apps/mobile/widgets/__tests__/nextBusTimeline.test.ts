import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COUNTDOWN_WINDOW_MS,
  LIVE_FRESH_MS,
  MAX_DEPARTURES_PER_ENTRY,
  MAX_TIMELINE_ENTRIES,
  buildNextBusTimeline,
  nextBusTimelineKey,
  type NextBusSnapshot,
} from '../nextBusTimeline';

const MIN = 60_000;
// 2026-10-20 08:30 in Kuala Lumpur (UTC+8).
const NOW = Date.UTC(2026, 9, 20, 0, 30);

function snap(overrides: Partial<NonNullable<NextBusSnapshot>> = {}): NonNullable<NextBusSnapshot> {
  return {
    routeCode: 'T816',
    stopName: 'Hotel Lisa De Inn',
    departures: [
      { epochMs: NOW + 12 * MIN, live: true },
      { epochMs: NOW + 42 * MIN, live: false },
      { epochMs: NOW + 72 * MIN, live: false },
    ],
    updatedAtMs: NOW - 30_000,
    ...overrides,
  };
}

test('null snapshot → a single empty-state entry at now', () => {
  const entries = buildNextBusTimeline(null, NOW);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.date.getTime(), NOW);
  assert.equal(entries[0]!.props.state, 'empty');
  assert.deepEqual(entries[0]!.props.departures, []);
});

test('one entry now plus one at each departure; each lists departures still ahead', () => {
  const entries = buildNextBusTimeline(snap(), NOW);
  assert.deepEqual(
    entries.map((e) => e.date.getTime()),
    [NOW, NOW + 12 * MIN, NOW + 42 * MIN, NOW + 72 * MIN],
  );
  assert.deepEqual(
    entries.map((e) => e.props.departures.map((d) => d.epochMs)),
    [
      [NOW + 12 * MIN, NOW + 42 * MIN, NOW + 72 * MIN],
      [NOW + 42 * MIN, NOW + 72 * MIN],
      [NOW + 72 * MIN],
      [],
    ],
  );
  assert.deepEqual(
    entries.map((e) => e.props.state),
    ['service', 'service', 'service', 'ended'],
  );
  for (const e of entries) {
    assert.equal(e.props.routeCode, 'T816');
    assert.equal(e.props.stopName, 'Hotel Lisa De Inn');
    assert.equal(e.props.updatedAtMs, NOW - 30_000);
  }
});

test('departures are sorted, de-duplicated and past ones dropped', () => {
  const entries = buildNextBusTimeline(
    snap({
      departures: [
        { epochMs: NOW + 40 * MIN, live: false },
        { epochMs: NOW - 5 * MIN, live: false },
        { epochMs: NOW + 10 * MIN, live: false },
        { epochMs: NOW + 10 * MIN, live: true },
        { epochMs: Number.NaN, live: false },
      ],
    }),
    NOW,
  );
  assert.deepEqual(
    entries[0]!.props.departures,
    [
      { epochMs: NOW + 10 * MIN, live: true },
      { epochMs: NOW + 40 * MIN, live: false },
    ],
  );
});

test('live flag is kept only on the first entry’s first departure', () => {
  const entries = buildNextBusTimeline(
    snap({
      departures: [
        { epochMs: NOW + 5 * MIN, live: true },
        { epochMs: NOW + 9 * MIN, live: true },
        { epochMs: NOW + 35 * MIN, live: false },
      ],
    }),
    NOW,
  );
  assert.deepEqual(
    entries[0]!.props.departures.map((d) => d.live),
    [true, false, false],
  );
  for (const e of entries.slice(1)) {
    assert.ok(e.props.departures.every((d) => d.live === false), 'later entries are scheduled-only');
  }
});

test('a scheduled first departure is never promoted to live', () => {
  const entries = buildNextBusTimeline(
    snap({ departures: [{ epochMs: NOW + 5 * MIN, live: false }, { epochMs: NOW + 9 * MIN, live: true }] }),
    NOW,
  );
  assert.deepEqual(entries[0]!.props.departures.map((d) => d.live), [false, false]);
});

test('stale data is demoted to scheduled', () => {
  const entries = buildNextBusTimeline(snap({ updatedAtMs: NOW - LIVE_FRESH_MS - 1 }), NOW);
  assert.equal(entries[0]!.props.departures[0]!.live, false);
});

test('caps entries and departures per entry', () => {
  const departures = Array.from({ length: 40 }, (_, i) => ({ epochMs: NOW + (i + 1) * 15 * MIN, live: false }));
  const entries = buildNextBusTimeline(snap({ departures }), NOW);
  assert.equal(entries.length, MAX_TIMELINE_ENTRIES);
  for (const e of entries) {
    assert.ok(e.props.departures.length <= MAX_DEPARTURES_PER_ENTRY);
    assert.equal(e.props.state, 'service', 'capped timeline never claims service ended');
  }
  const times = entries.map((e) => e.date.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'entries are chronological');
});

test('adds a countdown switch-over entry one hour before a far departure', () => {
  const far = NOW + 3 * 60 * MIN;
  const entries = buildNextBusTimeline(snap({ departures: [{ epochMs: far, live: false }] }), NOW);
  assert.deepEqual(
    entries.map((e) => e.date.getTime()),
    [NOW, far - COUNTDOWN_WINDOW_MS, far],
  );
  assert.deepEqual(entries[1]!.props.departures, [{ epochMs: far, live: false }]);
  assert.equal(entries[2]!.props.state, 'ended');
});

test('end of day: ended state carries first bus tomorrow when provided', () => {
  const firstBus = Date.UTC(2026, 9, 20, 21, 30); // 05:30 KL next day
  const entries = buildNextBusTimeline(snap({ departures: [], firstBusTomorrowMs: firstBus }), NOW);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.props.state, 'ended');
  assert.equal(entries[0]!.props.firstBusMs, firstBus);

  const withoutHint = buildNextBusTimeline(snap({ departures: [], firstBusTomorrowMs: null }), NOW);
  assert.equal(withoutHint[0]!.props.firstBusMs, 0, 'props stay plist-safe: no null');
});

test('a list that stops short of the last bus ends in "stale", not "ended"', () => {
  const entries = buildNextBusTimeline(
    snap({ lastBusTodayMs: NOW + 15 * 60 * MIN }),
    NOW,
  );
  assert.equal(entries.at(-1)!.props.state, 'stale');

  const complete = buildNextBusTimeline(snap({ lastBusTodayMs: NOW + 72 * MIN }), NOW);
  assert.equal(complete.at(-1)!.props.state, 'ended');
});

test('props never contain null or undefined (UserDefaults must stay plist-safe)', () => {
  const entries = buildNextBusTimeline(
    snap({ firstBusTomorrowMs: undefined, lastBusTodayMs: null }),
    NOW,
  );
  const walk = (value: unknown, path: string) => {
    assert.ok(value !== null && value !== undefined, `${path} is ${String(value)}`);
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as object)) walk(v, `${path}.${k}`);
    }
  };
  for (const e of entries) walk(e.props, 'props');
});

test('timeline key ignores updatedAt and sub-minute jitter but tracks real changes', () => {
  const a = snap();
  assert.equal(nextBusTimelineKey(a), nextBusTimelineKey({ ...a, updatedAtMs: a.updatedAtMs + 30_000 }));
  const jitter = {
    ...a,
    departures: a.departures.map((d) => ({ ...d, epochMs: d.epochMs + 1_000 })),
  };
  assert.equal(nextBusTimelineKey(a), nextBusTimelineKey(jitter));
  assert.notEqual(
    nextBusTimelineKey(a),
    nextBusTimelineKey({ ...a, departures: a.departures.slice(1) }),
  );
  assert.notEqual(nextBusTimelineKey(a), nextBusTimelineKey({ ...a, stopName: 'Other' }));
  assert.equal(nextBusTimelineKey(null), 'empty');
});

test('isLastBus is set only when the single remaining departure is known to be the last', () => {
  const entries = buildNextBusTimeline(snap(), NOW);
  assert.deepEqual(entries.map((e) => e.props.isLastBus), [false, false, true, false]);

  const incomplete = buildNextBusTimeline(snap({ lastBusTodayMs: NOW + 15 * 60 * MIN }), NOW);
  assert.ok(incomplete.every((e) => e.props.isLastBus === false));
});

// --- Home line (plan 15/07) ---------------------------------------------------

const HOME = { label: 'Home', leaveMs: NOW + 30 * MIN, arriveMs: NOW + 64 * MIN };

test('home line is kept until leave time', () => {
  const entries = buildNextBusTimeline(snap({ home: HOME }), NOW);
  for (const e of entries.filter((x) => x.date.getTime() < HOME.leaveMs)) {
    assert.equal(e.props.homeLabel, 'Home');
    assert.equal(e.props.homeLeaveMs, HOME.leaveMs);
    assert.equal(e.props.homeArriveMs, HOME.arriveMs);
  }
  // Now and the 12-min departure both carry it.
  assert.deepEqual(
    entries.slice(0, 2).map((e) => e.props.homeLabel),
    ['Home', 'Home'],
  );
});

test('an entry at leave time drops it', () => {
  const entries = buildNextBusTimeline(snap({ home: HOME }), NOW);
  assert.deepEqual(
    entries.map((e) => e.date.getTime()),
    [NOW, NOW + 12 * MIN, HOME.leaveMs, NOW + 42 * MIN, NOW + 72 * MIN],
  );
  const atLeave = entries.find((e) => e.date.getTime() === HOME.leaveMs)!;
  assert.deepEqual(
    [atLeave.props.homeLabel, atLeave.props.homeLeaveMs, atLeave.props.homeArriveMs],
    ['', 0, 0],
  );
  // It still shows the buses ahead at that moment.
  assert.deepEqual(atLeave.props.departures.map((d) => d.epochMs), [NOW + 42 * MIN, NOW + 72 * MIN]);
  for (const e of entries.filter((x) => x.date.getTime() >= HOME.leaveMs)) assert.equal(e.props.homeLabel, '');

  // A leave time on a departure reuses that entry.
  const onDeparture = buildNextBusTimeline(snap({ home: { ...HOME, leaveMs: NOW + 42 * MIN } }), NOW);
  assert.equal(onDeparture.length, 4);
  assert.equal(onDeparture[2]!.props.homeLabel, '');
  assert.equal(onDeparture[1]!.props.homeLabel, 'Home');

  // A plan whose leave time has passed is no line at all.
  const past = buildNextBusTimeline(snap({ home: { ...HOME, leaveMs: NOW - MIN } }), NOW);
  assert.ok(past.every((e) => e.props.homeLabel === ''));
});

test('home never exceeds the entry cap', () => {
  const departures = Array.from({ length: 40 }, (_, i) => ({ epochMs: NOW + (i + 1) * 15 * MIN, live: false }));
  const without = buildNextBusTimeline(snap({ departures }), NOW);
  const leaveMs = NOW + 37 * MIN;
  const entries = buildNextBusTimeline(snap({ departures, home: { ...HOME, leaveMs, arriveMs: leaveMs + 30 * MIN } }), NOW);
  assert.equal(entries.length, MAX_TIMELINE_ENTRIES);
  const times = entries.map((e) => e.date.getTime());
  assert.ok(times.includes(leaveMs), 'the entry that clears home is kept');
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // The furthest departure entry made room.
  assert.ok(!times.includes(without.at(-1)!.date.getTime()));
  assert.deepEqual(
    times.filter((t) => t !== leaveMs),
    without.slice(0, -1).map((e) => e.date.getTime()),
  );
});

test('no home gives empty plist-safe fields', () => {
  for (const home of [undefined, null, { label: '', leaveMs: NOW + MIN, arriveMs: NOW + 2 * MIN }]) {
    for (const e of buildNextBusTimeline(snap({ home }), NOW)) {
      assert.equal(e.props.homeLabel, '');
      assert.equal(e.props.homeLeaveMs, 0);
      assert.equal(e.props.homeArriveMs, 0);
    }
  }
  const empty = buildNextBusTimeline(null, NOW)[0]!.props;
  assert.deepEqual([empty.homeLabel, empty.homeLeaveMs, empty.homeArriveMs], ['', 0, 0]);
  const nan = buildNextBusTimeline(snap({ home: { label: 'Home', leaveMs: Number.NaN, arriveMs: Number.NaN } }), NOW);
  assert.ok(nan.every((e) => e.props.homeLeaveMs === 0 && e.props.homeArriveMs === 0));
});

test('key changes when the home plan changes', () => {
  const a = snap({ home: HOME });
  assert.notEqual(nextBusTimelineKey(a), nextBusTimelineKey(snap()));
  assert.notEqual(nextBusTimelineKey(a), nextBusTimelineKey({ ...a, home: { ...HOME, leaveMs: HOME.leaveMs + MIN } }));
  assert.notEqual(nextBusTimelineKey(a), nextBusTimelineKey({ ...a, home: { ...HOME, label: 'Work' } }));
  assert.equal(nextBusTimelineKey(a), nextBusTimelineKey({ ...a, home: { ...HOME, leaveMs: HOME.leaveMs + 1_000 } }));
});
