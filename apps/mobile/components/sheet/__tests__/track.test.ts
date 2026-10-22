import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trackPlan } from '../nearby/track';

test('already a favourite switches stop', () => {
  assert.deepEqual(trackPlan('780', 'kl:1005840', ['T816', '780'], 10), {
    kind: 'already',
    code: '780',
    stopId: 'kl:1005840',
  });
  // Even with the list full: nothing is added, so nothing overflows.
  const full = Array.from({ length: 9 }, (_, i) => `R${i}`).concat('780');
  assert.equal(trackPlan('780', 'kl:1005840', full, 10).kind, 'already');
});

test('adds with the stop id tracking stores', () => {
  assert.deepEqual(trackPlan('780', 'kl:1005840', ['T816'], 10), {
    kind: 'add',
    code: '780',
    stopId: 'kl:1005840',
  });
  // The static database keeps the network's ids: kl: prefixed, feeder raw.
  assert.deepEqual(trackPlan('T816', '12000759', [], 10), { kind: 'add', code: 'T816', stopId: '12000759' });
});

test('full at 10 says so', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `R${i}`);
  assert.deepEqual(trackPlan('780', 'kl:1005840', ten, 10), { kind: 'full' });
  assert.equal(trackPlan('780', 'kl:1005840', ten.slice(0, 9), 10).kind, 'add');
});
