import assert from 'node:assert/strict';
import test from 'node:test';

import { fareFor, isFeederRoute } from '@/components/detail/fares';
import { formatMinutes, nextStopsOf, type TimedStop } from '@/components/detail/nextStops';

/** A straight line of stops 0.01° apart, two minutes between each. */
function line(ids: string[], start = 7 * 3600): TimedStop[] {
  return ids.map((id, i) => ({
    stopId: id,
    name: `Stop ${id}`,
    sequence: i + 1,
    lat: 3.1,
    lng: 101.6 + i * 0.01,
    seconds: start + i * 120,
  }));
}

test('next stops: timed from the stop the bus is nearest', () => {
  const stops = line(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  const next = nextStopsOf(stops, { lat: 3.1, lng: 101.611 }, null);
  assert.equal(next?.near.stopId, 'b');
  assert.deepEqual(
    next?.ahead.map((s) => [s.stop.stopId, s.minutes]),
    [
      ['c', 2],
      ['d', 4],
      ['e', 6],
      ['f', 8],
    ],
  );
  assert.equal(next?.yours, null);
});

test('next stops: your stop is marked among them', () => {
  const next = nextStopsOf(line(['a', 'b', 'c', 'd']), { lat: 3.1, lng: 101.6 }, 'c');
  assert.deepEqual(
    next?.ahead.map((s) => s.yours),
    [false, true, false],
  );
  assert.equal(next?.yours, null);
});

test('next stops: your stop further on comes after a gap', () => {
  const stops = line(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  const next = nextStopsOf(stops, { lat: 3.1, lng: 101.6 }, 'h');
  assert.equal(next?.ahead.length, 4);
  assert.equal(next?.yours?.stop.stopId, 'h');
  assert.equal(next?.yours?.minutes, 14);
  assert.equal(next?.skipped, 2);
});

test('next stops: a loop takes your stop the first time from here', () => {
  const stops = line(['hub', 'a', 'b', 'c', 'd', 'e', 'f', 'hub']);
  stops[7] = { ...stops[7], lat: stops[0].lat, lng: stops[0].lng };
  const next = nextStopsOf(stops, { lat: 3.1, lng: 101.6 }, 'f');
  assert.equal(next?.near.stopId, 'hub');
  assert.equal(next?.near.sequence, 1);
  assert.equal(next?.yours?.stop.stopId, 'f');
});

test('next stops: none at the end of the trip, and no times without a timetable', () => {
  assert.equal(nextStopsOf(line(['a', 'b']), { lat: 3.1, lng: 101.61 }, null), null);
  assert.equal(nextStopsOf([], { lat: 3.1, lng: 101.6 }, null), null);
  const untimed = line(['a', 'b', 'c']).map((s) => ({ ...s, seconds: null }));
  assert.equal(nextStopsOf(untimed, { lat: 3.1, lng: 101.6 }, null)?.ahead[0].minutes, null);
});

test('next stops: a stop ahead is never 0 min away', () => {
  const stops = line(['a', 'b', 'c']);
  stops[1] = { ...stops[1], seconds: stops[0].seconds };
  assert.equal(nextStopsOf(stops, { lat: 3.1, lng: 101.6 }, null)?.ahead[0].minutes, 1);
});

test('next stops: minutes read as minutes, then hours', () => {
  assert.equal(formatMinutes(4), '4 min');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(75), '1 h 15 min');
});

test('fares: feeders are a flat RM1, other Rapid KL buses go by zone', () => {
  assert.ok(isFeederRoute('T816'));
  assert.ok(isFeederRoute(' t580 '));
  assert.ok(!isFeederRoute('780'));
  assert.ok(!isFeederRoute('GOKL-01'));
  assert.deepEqual(fareFor('T816'), { adult: 'RM1.00', concession: 'RM0.50' });
  assert.deepEqual(fareFor('300'), { adult: 'RM1 – RM5', concession: 'Half fare' });
});
