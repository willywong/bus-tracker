import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMMUTE_MAX_PENDING,
  IOS_MAX_PENDING_NOTIFICATIONS,
  commuteReminderId,
  formatMalaysiaClock,
  isCommuteReminderId,
  isSameMoment,
  lastBusLeaveBy,
  malaysiaDateKey,
  malaysiaMidnightMs,
  malaysiaWeekday,
  planCommuteReminders,
  upcomingServiceDates,
  type CommuteRules,
} from '../plan';

const MIN = 60_000;
const DAY = 86_400_000;

/** Epoch ms for a Malaysia-local wall-clock time (UTC+8). */
function my(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00+08:00`);
}

/** Departures every 30 min from 06:00 to 23:30 on `date` (Malaysia). */
function halfHourly(date: string): number[] {
  const out: number[] = [];
  for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    out.push(my(date, `${hh}:${mm}`));
  }
  return out;
}

function week(dates: string[]): Record<string, number[]> {
  return Object.fromEntries(dates.map((d) => [d, halfHourly(d)]));
}

const WEEKDAYS: CommuteRules = {
  enabled: true,
  weekdays: [1, 2, 3, 4, 5],
  targetMinuteOfDay: 8 * 60,
};

// 2026-10-19 is a Monday.
const DATES = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
  '2026-10-26',
];

// --- Malaysia time helpers -------------------------------------------------

test('Malaysia date key / weekday / midnight around UTC midnight', () => {
  // 2026-10-19 23:30 UTC is already Tuesday 07:30 in KL.
  const t = Date.parse('2026-10-19T23:30:00Z');
  assert.equal(malaysiaDateKey(t), '2026-10-20');
  assert.equal(malaysiaWeekday(t), 2);
  assert.equal(malaysiaMidnightMs(t), Date.parse('2026-10-19T16:00:00Z'));
  // 2026-10-19 15:59 UTC is still Monday 23:59 in KL.
  const u = Date.parse('2026-10-19T15:59:00Z');
  assert.equal(malaysiaDateKey(u), '2026-10-19');
  assert.equal(malaysiaWeekday(u), 1);
});

test('formatMalaysiaClock 24h and 12h', () => {
  assert.equal(formatMalaysiaClock(my('2026-10-19', '23:30')), '23:30');
  assert.equal(formatMalaysiaClock(my('2026-10-19', '07:05')), '07:05');
  assert.equal(formatMalaysiaClock(my('2026-10-19', '23:30'), false), '11:30 PM');
  assert.equal(formatMalaysiaClock(my('2026-10-19', '00:15'), false), '12:15 AM');
  assert.equal(formatMalaysiaClock(my('2026-10-19', '12:00'), false), '12:00 PM');
});

test('upcomingServiceDates starts today (Malaysia) and is contiguous', () => {
  const days = upcomingServiceDates(my('2026-10-19', '22:00'), 3);
  assert.deepEqual(
    days.map((d) => [d.date, d.weekday]),
    [
      ['2026-10-19', 1],
      ['2026-10-20', 2],
      ['2026-10-21', 3],
    ],
  );
  assert.equal(days[1].midnightMs - days[0].midnightMs, DAY);
  assert.equal(days[0].midnightMs, my('2026-10-19', '00:00'));
});

// --- planCommuteReminders ----------------------------------------------------

test('plans one reminder per enabled weekday, first bus at/after target', () => {
  const now = my('2026-10-19', '05:00'); // Monday early morning
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: week(DATES),
    walkMinutes: 6,
    bufferMinutes: 2,
    now,
    routeCode: 'T816',
    stopName: 'Hotel Lisa De Inn',
  });
  assert.deepEqual(
    plan.map((r) => r.date),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
  );
  const mon = plan[0];
  assert.equal(mon.id, 'commute-2026-10-19');
  assert.equal(mon.departureMs, my('2026-10-19', '08:00'));
  assert.equal(mon.fireAtMs, my('2026-10-19', '07:52'));
  assert.equal(mon.title, 'Leave by 07:52 for T816');
  assert.match(mon.body, /Scheduled bus at Hotel Lisa De Inn at 08:00/);
  assert.match(mon.body, /6 min walk/);
});

test('target between departures picks the next one', () => {
  const plan = planCommuteReminders({
    rules: { ...WEEKDAYS, targetMinuteOfDay: 8 * 60 + 10 },
    departuresByDay: week(DATES),
    walkMinutes: 10,
    bufferMinutes: 0,
    now: my('2026-10-19', '05:00'),
    days: 1,
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].departureMs, my('2026-10-19', '08:30'));
  assert.equal(plan[0].fireAtMs, my('2026-10-19', '08:20'));
});

test('weekend-only rules use Malaysia weekday, not UTC weekday', () => {
  // Sat 2026-10-24 07:00 KL = Fri 23:00 UTC. A UTC-based weekday would say Friday.
  const plan = planCommuteReminders({
    rules: { enabled: true, weekdays: [6, 0], targetMinuteOfDay: 7 * 60 + 30 },
    departuresByDay: week(DATES),
    walkMinutes: 5,
    bufferMinutes: 0,
    now: my('2026-10-19', '05:00'),
  });
  assert.deepEqual(
    plan.map((r) => r.date),
    ['2026-10-24', '2026-10-25'],
  );
  assert.equal(plan[0].fireAtMs, my('2026-10-24', '07:25'));
});

test('skips today when leave-by already passed, keeps later days', () => {
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: week(DATES),
    walkMinutes: 6,
    bufferMinutes: 2,
    now: my('2026-10-19', '07:55'), // after 07:52 leave-by
    days: 2,
  });
  assert.deepEqual(
    plan.map((r) => r.date),
    ['2026-10-20'],
  );
});

test('fire time exactly now is skipped (must be in the future)', () => {
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: week(DATES),
    walkMinutes: 6,
    bufferMinutes: 2,
    now: my('2026-10-19', '07:52'),
    days: 1,
  });
  assert.equal(plan.length, 0);
});

test('days without data or without a late-enough bus are skipped', () => {
  const deps = week(DATES);
  delete deps['2026-10-20']; // e.g. public holiday removed via calendar_dates
  deps['2026-10-21'] = [my('2026-10-21', '06:00'), my('2026-10-21', '07:00')];
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: deps,
    walkMinutes: 6,
    bufferMinutes: 2,
    now: my('2026-10-19', '05:00'),
    days: 3,
  });
  assert.deepEqual(
    plan.map((r) => r.date),
    ['2026-10-19'],
  );
});

test('unsorted and duplicated departures still pick the earliest qualifying', () => {
  const d = '2026-10-19';
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: {
      [d]: [my(d, '09:00'), my(d, '08:15'), my(d, '07:45'), my(d, '08:15')],
    },
    walkMinutes: 0,
    bufferMinutes: 0,
    now: my(d, '05:00'),
    days: 1,
  });
  assert.equal(plan[0].departureMs, my(d, '08:15'));
});

test('disabled rules or empty weekdays yield nothing', () => {
  const base = {
    departuresByDay: week(DATES),
    walkMinutes: 5,
    bufferMinutes: 2,
    now: my('2026-10-19', '05:00'),
  };
  assert.deepEqual(
    planCommuteReminders({ ...base, rules: { ...WEEKDAYS, enabled: false } }),
    [],
  );
  assert.deepEqual(
    planCommuteReminders({ ...base, rules: { ...WEEKDAYS, weekdays: [] } }),
    [],
  );
  assert.deepEqual(
    planCommuteReminders({
      ...base,
      rules: { ...WEEKDAYS, weekdays: [7, -1, 2.5] },
    }),
    [],
  );
});

test('caps at the iOS pending budget, keeping the earliest', () => {
  const start = my('2026-10-19', '00:00');
  const dates: string[] = [];
  for (let i = 0; i < 100; i++) dates.push(malaysiaDateKey(start + i * DAY + 12 * 3600_000));
  const plan = planCommuteReminders({
    rules: { enabled: true, weekdays: [0, 1, 2, 3, 4, 5, 6], targetMinuteOfDay: 480 },
    departuresByDay: week(dates),
    walkMinutes: 5,
    bufferMinutes: 2,
    now: my('2026-10-19', '05:00'),
    days: 100,
  });
  assert.equal(plan.length, COMMUTE_MAX_PENDING);
  assert.ok(COMMUTE_MAX_PENDING < IOS_MAX_PENDING_NOTIFICATIONS);
  assert.equal(plan[0].date, '2026-10-19');
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i].fireAtMs > plan[i - 1].fireAtMs);
  }
  const capped = planCommuteReminders({
    rules: { enabled: true, weekdays: [0, 1, 2, 3, 4, 5, 6], targetMinuteOfDay: 480 },
    departuresByDay: week(dates),
    walkMinutes: 5,
    bufferMinutes: 2,
    now: my('2026-10-19', '05:00'),
    days: 100,
    maxReminders: 3,
  });
  assert.deepEqual(
    capped.map((r) => r.date),
    ['2026-10-19', '2026-10-20', '2026-10-21'],
  );
});

test('custom clock formatter is used in copy', () => {
  const plan = planCommuteReminders({
    rules: WEEKDAYS,
    departuresByDay: week(DATES),
    walkMinutes: 6,
    bufferMinutes: 2,
    now: my('2026-10-19', '05:00'),
    days: 1,
    formatClock: (ms) => formatMalaysiaClock(ms, false),
  });
  assert.equal(plan[0].title, 'Leave by 7:52 AM');
});

test('after-midnight spillover departures count for their service date', () => {
  const d = '2026-10-19';
  // A 24:30 trip of Monday's service = Tuesday 00:30 wall clock.
  const plan = planCommuteReminders({
    rules: { enabled: true, weekdays: [1], targetMinuteOfDay: 23 * 60 + 45 },
    departuresByDay: { [d]: [my(d, '23:30'), my('2026-10-20', '00:30')] },
    walkMinutes: 10,
    bufferMinutes: 0,
    now: my(d, '20:00'),
    days: 1,
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 'commute-2026-10-19');
  assert.equal(plan[0].fireAtMs, my('2026-10-20', '00:20'));
});

// --- ids / dedupe ------------------------------------------------------------

test('commute ids and same-moment window', () => {
  assert.equal(commuteReminderId('2026-10-19'), 'commute-2026-10-19');
  assert.ok(isCommuteReminderId('commute-2026-10-19'));
  assert.ok(!isCommuteReminderId('bt.leave-now'));
  assert.ok(isSameMoment(0, 19 * MIN));
  assert.ok(!isSameMoment(0, 20 * MIN));
});

// --- lastBusLeaveBy ------------------------------------------------------------

test('lastBusLeaveBy: leave-by = last bus − walk, notify = leave-by − lead', () => {
  const last = my('2026-10-19', '23:30');
  const r = lastBusLeaveBy(last, 10, 15);
  assert.equal(r.leaveByMs, my('2026-10-19', '23:20'));
  assert.equal(r.notifyAtMs, my('2026-10-19', '23:05'));
  assert.equal(formatMalaysiaClock(r.leaveByMs), '23:20');
});

test('lastBusLeaveBy treats negative/NaN minutes as zero', () => {
  const last = my('2026-10-19', '23:30');
  const r = lastBusLeaveBy(last, -5, Number.NaN);
  assert.equal(r.leaveByMs, last);
  assert.equal(r.notifyAtMs, last);
});
