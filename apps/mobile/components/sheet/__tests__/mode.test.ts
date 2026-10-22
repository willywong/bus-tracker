import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sheetMode } from '../mode';

test('go wins over ride', () => {
  assert.equal(sheetMode({ go: true, riding: true, detail: true }), 'go');
});

test('ride wins over detail', () => {
  assert.equal(sheetMode({ go: false, riding: true, detail: true }), 'ride');
});

test('detail wins over sections', () => {
  assert.equal(sheetMode({ go: false, riding: false, detail: true }), 'detail');
});

test('nothing active is sections', () => {
  assert.equal(sheetMode({ go: false, riding: false, detail: false }), 'sections');
});
