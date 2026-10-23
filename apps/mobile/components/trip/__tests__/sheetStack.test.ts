import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPresentTrip, topRoute, type NavStateLike } from '../sheetStack';

const stack = (...names: string[]): NavStateLike => ({ routes: names.map((name) => ({ name })) });

test('presents trip on a bare [index] stack when wanted', () => {
  assert.equal(shouldPresentTrip(stack('index')), true);
  assert.equal(shouldPresentTrip(stack('index'), false), false);
});

test('waits while any other sheet is over the map', () => {
  assert.equal(shouldPresentTrip(stack('index', 'station')), false);
  assert.equal(shouldPresentTrip(stack('index', 'line')), false);
  assert.equal(shouldPresentTrip(stack('index', 'station', 'line')), false);
  assert.equal(shouldPresentTrip(stack('index', 'network')), false);
  assert.equal(shouldPresentTrip(stack('index', 'plan')), false);
  assert.equal(shouldPresentTrip(stack('index', 'settings')), false);
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

test('the top route follows nested stacks', () => {
  assert.equal(topRoute(stack('index', 'trip')), 'trip');
  assert.equal(
    topRoute({ routes: [{ name: '__root', state: { routes: [{ name: 'index' }, { name: 'plan' }] } }] }),
    'plan',
  );
  assert.equal(topRoute(undefined), null);
});
