import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Itinerary, Place } from '@bus-tracker/shared';

import { isLiveSkipped, isStale, networkFor, placeKey, queryKey, updatedIds } from '../session';

const HERE: Place = { kind: 'here', name: 'My location', lat: Number.NaN, lng: Number.NaN };
const KLCC: Place = { kind: 'station', name: 'KLCC', lat: 3.1589, lng: 101.7133, ref: 'klcc' };
const SPOT: Place = { kind: 'place', name: 'Cafe', lat: 3.123456789, lng: 101.6 };
/** 2026-10-23 04:30 MYT. */
const NOW = Date.UTC(2026, 9, 22, 20, 30);
const H = 3600_000;

test('query key: ids for stations, coordinates for places, now or the minute', () => {
  assert.equal(placeKey(KLCC), 'station:klcc');
  assert.equal(placeKey(SPOT), 'place:3.12346,101.60000');
  assert.equal(queryKey(HERE, KLCC, { kind: 'now' }), 'here|station:klcc|now');
  const at = NOW + 3.5 * H;
  assert.equal(queryKey(HERE, KLCC, { kind: 'depart', at }), queryKey(HERE, KLCC, { kind: 'depart', at: at + 30_000 }));
  assert.notEqual(queryKey(HERE, KLCC, { kind: 'depart', at }), queryKey(HERE, KLCC, { kind: 'depart', at: at + 60_000 }));
});

test('network: today in memory, tomorrow loaded, beyond that none', () => {
  assert.equal(networkFor(NOW, '20261023', NOW), 'loaded');
  assert.equal(networkFor(NOW + 3.5 * H, '20261023', NOW), 'loaded'); // 08:00 same day
  assert.equal(networkFor(NOW + 22.5 * H, '20261023', NOW), 'loaded'); // 03:00 next morning: still today's service day
  assert.deepEqual(networkFor(NOW + 27.5 * H, '20261023', NOW), { date: '20261024' }); // 08:00 tomorrow
  assert.equal(networkFor(NOW + 50 * H, '20261023', NOW), null);
  // Nothing in memory yet: today's date must be loaded too.
  assert.deepEqual(networkFor(NOW, null, NOW), { date: '20261023' });
});

const it = (id: string, arriveAt: number, previousArriveAt?: number): Itinerary => ({
  id,
  departAt: 0,
  arriveAt,
  legs: [],
  rides: 1,
  walkMeters: 0,
  tags: [],
  warnings: [],
  ...(previousArriveAt != null ? { previousArriveAt } : {}),
});

test('updated ids: moved by a minute against what the row showed', () => {
  const base = [it('a', 1000 * 60_000), it('b', 1010 * 60_000)];
  const first = [it('a', 1003 * 60_000, 1000 * 60_000), it('b', 1010 * 60_000)];
  assert.deepEqual(updatedIds(base, first), ['a']);
  // Same retime again: nothing new to flash.
  assert.deepEqual(updatedIds(first, first), []);
  // A tail re-plan renamed the row; matched by position.
  const replanned = [it('a2', 1005 * 60_000, 1000 * 60_000), it('b', 1010 * 60_000)];
  assert.deepEqual(updatedIds(first, replanned), ['a2']);
  // Under a minute from what was shown: quiet.
  assert.deepEqual(updatedIds(first, [it('a', 1003 * 60_000 + 30_000, 1000 * 60_000), it('b', 1010 * 60_000)]), []);
});

test('live skipped only for a needed category', () => {
  assert.equal(isLiveSkipped([{ category: 'rapid-bus-kl' }], ['rapid-bus-mrtfeeder']), false);
  assert.equal(isLiveSkipped([{ category: 'rapid-bus-mrtfeeder' }], ['rapid-bus-mrtfeeder']), true);
  assert.equal(isLiveSkipped([], ['rapid-bus-kl']), false);
});

test('leave-now results go stale after two minutes; depart-at never', () => {
  assert.equal(isStale({ kind: 'now' }, NOW, NOW + 60_000), false);
  assert.equal(isStale({ kind: 'now' }, NOW, NOW + 3 * 60_000), true);
  assert.equal(isStale({ kind: 'depart', at: NOW }, NOW, NOW + H), false);
  assert.equal(isStale({ kind: 'now' }, null, NOW), false);
});
