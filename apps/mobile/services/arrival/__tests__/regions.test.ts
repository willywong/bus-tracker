import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goRegionId, MAX_REGIONS, mergeRegions, parseRegionId } from '../regions';

test('go region ids round-trip to their leg', () => {
  const id = goRegionId(3, '12000762');
  assert.equal(id, 'go|3|12000762');
  assert.deepEqual(parseRegionId(id), { kind: 'go', legIndex: 3 });
  // A stop key can't break the format.
  assert.deepEqual(parseRegionId(goRegionId(1, 'a|b')), { kind: 'go', legIndex: 1 });
});

test('favourite ids keep their old format', () => {
  assert.deepEqual(parseRegionId('T816|1000123'), { kind: 'favourite', routeCode: 'T816', stopId: '1000123' });
  assert.equal(parseRegionId(''), null);
  assert.equal(parseRegionId('T816|'), null);
  assert.equal(parseRegionId('go|x|1'), null);
  assert.equal(parseRegionId('go||1'), null);
  assert.equal(parseRegionId('a|b|c|d'), null);
});

test('go regions come first within the 20-region budget', () => {
  const region = (identifier: string) => ({ identifier });
  const go = [region('go|1|a'), region('go|3|b')];
  const favs = Array.from({ length: 25 }, (_, i) => region(`R${i}|${i}`));
  const merged = mergeRegions(go, favs);
  assert.equal(merged.length, MAX_REGIONS);
  assert.deepEqual(merged.slice(0, 2), go);
  assert.equal(merged[2].identifier, 'R0|0');
  // Deduped; a smaller cap holds.
  assert.equal(mergeRegions(go, [region('go|1|a'), region('T816|1')], 20).length, 3);
  assert.deepEqual(mergeRegions(go, favs, 1), [go[0]]);
});
