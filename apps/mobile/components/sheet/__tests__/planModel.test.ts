import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SavedPlace } from '@/hooks/useSettings';
import type { RecentPlace } from '@/services/places/recents';

import { planRows, type PlanRow } from '../planModel';

const NOW = Date.UTC(2026, 9, 23, 0, 0); // 08:00 in Kuala Lumpur

const HOME: SavedPlace = {
  id: 'home',
  kind: 'home',
  name: 'Taman Tun',
  address: 'Jalan Tun Mohd Fuad',
  lat: 3.1466,
  lng: 101.6276,
  ref: null,
  createdAt: 1,
};
const WORK: SavedPlace = {
  id: 'work',
  kind: 'work',
  name: 'KL Sentral',
  address: null,
  lat: 3.1343,
  lng: 101.6862,
  ref: { kind: 'station', id: 'kl-sentral' },
  createdAt: 2,
};

function recent(name: string, lat: number, extra: Partial<RecentPlace> = {}): RecentPlace {
  return { kind: 'place', name, lat, lng: 101.7, usedAt: 100, ...extra };
}

const KLCC = recent('Suria KLCC', 3.158, { lng: 101.712, address: 'Jalan Ampang' });

const ids = (rows: PlanRow[]) => rows.map((r) => r.id);

test('home then work then recents', () => {
  const rows = planRows([WORK, HOME], [KLCC], null, NOW);
  assert.deepEqual(ids(rows), ['home', 'work', 'recent:place:3.158,101.712']);
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Home', 'Work', 'Suria KLCC'],
  );
  const [home, work, klcc] = rows;
  assert.equal(home.kind === 'saved' && home.detail, 'Jalan Tun Mohd Fuad');
  // No address: the place's own name.
  assert.equal(work.kind === 'saved' && work.detail, 'KL Sentral');
  assert.equal(klcc.kind === 'recent' && klcc.detail, 'Jalan Ampang');
});

test('missing work shows add row', () => {
  const rows = planRows([HOME], [], null, NOW);
  assert.deepEqual(ids(rows), ['home', 'set-work']);
  assert.equal(rows[1].title, 'Add Work');
  assert.deepEqual(ids(planRows([], [], null, NOW)), ['set-home', 'set-work']);
});

test('recent equal to home is dropped', () => {
  // About 10 m from Home, by coordinates.
  const nearHome = recent('My place', HOME.lat + 0.00009, { lng: HOME.lng });
  // The same station as Work, by ref, a little way off.
  const sentral = recent('KL Sentral', 3.135, { kind: 'station', ref: 'kl-sentral', lng: 101.687 });
  const rows = planRows([HOME, WORK], [nearHome, sentral, KLCC], null, NOW);
  assert.deepEqual(ids(rows), ['home', 'work', 'recent:place:3.158,101.712']);
});

test('stale leave time falls back to address', () => {
  const plan = { label: 'Home', leaveMs: NOW + 40 * 60_000, arriveMs: NOW + 64 * 60_000 };
  const ahead = planRows([HOME], [], plan, NOW)[0];
  assert.equal(ahead.kind === 'saved' && ahead.detail, 'Leave 08:40 · 24 mins');

  const stale = planRows([HOME], [], plan, plan.leaveMs)[0];
  assert.equal(stale.kind === 'saved' && stale.detail, 'Jalan Tun Mohd Fuad');

  // A line for somewhere else isn't Home's.
  const other = planRows([HOME], [], { ...plan, label: 'Work' }, NOW)[0];
  assert.equal(other.kind === 'saved' && other.detail, 'Jalan Tun Mohd Fuad');
});

test('caps recents at 5', () => {
  const many = Array.from({ length: 6 }, (_, i) => recent(`Place ${i}`, 2 + i * 0.01));
  const rows = planRows([HOME, WORK], many, null, NOW);
  assert.equal(rows.filter((r) => r.kind === 'recent').length, 5);
  assert.deepEqual(
    rows.slice(2).map((r) => r.title),
    ['Place 0', 'Place 1', 'Place 2', 'Place 3', 'Place 4'],
  );
});
