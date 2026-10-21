import assert from 'node:assert/strict';
import test from 'node:test';

import { moveItems } from '../reorder';

const routes = ['T816', 'T815', 'T786'];

test('moving the first row down one sits it after the second', () => {
  assert.deepEqual(moveItems(routes, [0], 2), ['T815', 'T816', 'T786']);
});

test('moving a row to the end uses destination = length', () => {
  assert.deepEqual(moveItems(routes, [0], 3), ['T815', 'T786', 'T816']);
});

test('moving the last row to the top', () => {
  assert.deepEqual(moveItems(routes, [2], 0), ['T786', 'T816', 'T815']);
});

test('dropping a row where it already is changes nothing', () => {
  assert.deepEqual(moveItems(routes, [1], 1), routes);
  assert.deepEqual(moveItems(routes, [1], 2), routes);
});

test('out-of-range sources are ignored', () => {
  assert.deepEqual(moveItems(routes, [5], 0), routes);
});
