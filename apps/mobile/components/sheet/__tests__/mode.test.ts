import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sheetMode, wantsSheet } from '../mode';

test('go wins over ride', () => {
  assert.equal(sheetMode({ go: true, riding: true, detail: true, nearby: 'route' }), 'go');
});

test('ride wins over detail', () => {
  assert.equal(sheetMode({ go: false, riding: true, detail: true, nearby: 'route' }), 'ride');
});

test('detail wins over a Nearby view', () => {
  assert.equal(sheetMode({ go: false, riding: false, detail: true, nearby: 'stop' }), 'detail');
});

test('Nearby views map to trip, place and preview', () => {
  const off = { go: false, riding: false, detail: false };
  assert.equal(sheetMode({ ...off, nearby: 'trip' }), 'trip');
  assert.equal(sheetMode({ ...off, nearby: 'stop' }), 'place');
  assert.equal(sheetMode({ ...off, nearby: 'station' }), 'place');
  assert.equal(sheetMode({ ...off, nearby: 'route' }), 'preview');
});

test('the list, or nothing active, is sections', () => {
  assert.equal(sheetMode({ go: false, riding: false, detail: false, nearby: 'list' }), 'sections');
});

test('the sheet rests down on the sections until you open one', () => {
  assert.equal(wantsSheet('sections', false), false);
  assert.equal(wantsSheet('sections', true), true);
  for (const m of ['go', 'ride', 'detail', 'trip', 'place', 'preview'] as const) {
    assert.equal(wantsSheet(m, false), true);
  }
});
