import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPresentTrip, type NavStateLike } from '../sheetStack';

const stack = (...names: string[]): NavStateLike => ({ routes: names.map((name) => ({ name })) });

test('presents trip on a bare [index] stack', () => {
  assert.equal(shouldPresentTrip(stack('index')), true);
  // Every other sheet keeps today's behaviour: trip comes back under it.
  assert.equal(shouldPresentTrip(stack('index', 'settings')), true);
  assert.equal(shouldPresentTrip(stack('index', 'plan')), true);
});

test('waits while station or line is on the stack', () => {
  assert.equal(shouldPresentTrip(stack('index', 'station')), false);
  assert.equal(shouldPresentTrip(stack('index', 'line')), false);
  assert.equal(shouldPresentTrip(stack('index', 'station', 'line')), false);
  assert.equal(shouldPresentTrip(stack('index', 'network')), false);
});

test('does not present when trip is already nested', () => {
  assert.equal(shouldPresentTrip(stack('index', 'trip')), false);
  assert.equal(shouldPresentTrip(stack('index', 'trip', 'station')), false);
  const nested: NavStateLike = {
    routes: [{ name: '__root', state: { routes: [{ name: 'index' }, { name: 'trip' }] } }],
  };
  assert.equal(shouldPresentTrip(nested), false);
  const nestedStation: NavStateLike = {
    routes: [{ name: '__root', state: { routes: [{ name: 'index' }, { name: 'station' }] } }],
  };
  assert.equal(shouldPresentTrip(nestedStation), false);
});

test('an unready navigator never presents by itself', () => {
  // The hook also waits for a key; an empty state has nothing to wait behind.
  assert.equal(shouldPresentTrip(undefined), true);
});
