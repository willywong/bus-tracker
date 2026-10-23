import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPlate } from '@/components/detail/busSpec';

test('bus plate: a feed vehicle id reads as its number plate', () => {
  assert.equal(formatPlate('VH4652'), 'VH 4652');
  assert.equal(formatPlate('wmg 1234'), 'WMG 1234');
  assert.equal(formatPlate('kl:BQB2275'), 'BQB 2275');
  assert.equal(formatPlate('WA 12 C'), 'WA 12C');
});

test('bus plate: ids that are not plates show none', () => {
  assert.equal(formatPlate('260425_T8160_1_0700'), null);
  assert.equal(formatPlate('12345'), null);
  assert.equal(formatPlate(''), null);
});
