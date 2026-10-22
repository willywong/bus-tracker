import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SavedPlace } from '@/hooks/useSettings';

import { placeTiles, routeRows } from '../savedModel';

function place(kind: SavedPlace['kind'], name: string, createdAt: number): SavedPlace {
  const id = kind === 'pin' ? `pin-${createdAt}` : kind;
  return { id, kind, name, address: null, lat: 3.1, lng: 101.6, ref: null, createdAt };
}

const labels = (saved: SavedPlace[]) =>
  placeTiles(saved).map((t) => (t.kind === 'place' ? t.label : 'Add'));

test('home and work lead', () => {
  const saved = [place('pin', 'Gym', 1), place('work', 'Office Tower', 5), place('home', 'Flat', 9)];
  assert.deepEqual(labels(saved), ['Home', 'Work', 'Gym', 'Add']);
  const tiles = placeTiles(saved);
  assert.equal(tiles[0].kind === 'place' && tiles[0].symbol, 'house.fill');
  assert.equal(tiles[1].kind === 'place' && tiles[1].symbol, 'briefcase.fill');
  assert.equal(tiles[2].kind === 'place' && tiles[2].symbol, 'mappin');
});

test('pins follow by createdAt', () => {
  const saved = [place('pin', 'Later', 30), place('home', 'Flat', 50), place('pin', 'First', 10), place('pin', 'Middle', 20)];
  assert.deepEqual(labels(saved), ['Home', 'First', 'Middle', 'Later', 'Add']);
  assert.deepEqual(labels([]), ['Add']);
});

test('add tile is full at 6 pins', () => {
  const five = [1, 2, 3, 4, 5].map((n) => place('pin', `P${n}`, n));
  assert.deepEqual(placeTiles(five).at(-1), { kind: 'add', full: false });
  const six = [...five, place('pin', 'P6', 6), place('home', 'Flat', 7)];
  assert.deepEqual(placeTiles(six).at(-1), { kind: 'add', full: true });
});

test('active route is marked', () => {
  const rows = routeRows(['T816', 'T815', 'T789'], 'T815', { T816: 'Hotel Lisa De Inn' });
  assert.deepEqual(rows, [
    { code: 'T816', stopName: 'Hotel Lisa De Inn', active: false },
    { code: 'T815', stopName: null, active: true },
    { code: 'T789', stopName: null, active: false },
  ]);
  assert.ok(routeRows(['T816'], null, {}).every((r) => !r.active));
});
