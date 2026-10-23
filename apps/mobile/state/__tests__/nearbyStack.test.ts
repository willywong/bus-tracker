import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NEARBY_ROOT, nearbyStack, viewKey, type NearbyView } from '../nearbyStack';

const stop: NearbyView = { kind: 'stop', key: 'stop:kl:1000944' };
const route: NearbyView = { kind: 'route', route: 3, pattern: 7, fromStopIndex: 120 };

test('push adds a view on top', () => {
  const s = nearbyStack(nearbyStack(NEARBY_ROOT, { type: 'push', view: stop }), { type: 'push', view: route });
  assert.deepEqual(s.map((v) => v.kind), ['list', 'stop', 'route']);
});

test('pushing the current top again is a no-op', () => {
  const once = nearbyStack(NEARBY_ROOT, { type: 'push', view: stop });
  const twice = nearbyStack(once, { type: 'push', view: { kind: 'stop', key: 'stop:kl:1000944' } });
  assert.equal(twice, once);
});

test('pop returns to the view below, and is a no-op at the root', () => {
  const s = nearbyStack(NEARBY_ROOT, { type: 'push', view: stop });
  assert.deepEqual(nearbyStack(s, { type: 'pop' }), NEARBY_ROOT);
  assert.equal(nearbyStack(NEARBY_ROOT, { type: 'pop' }), NEARBY_ROOT);
});

test('reset goes back to the list', () => {
  const s = nearbyStack(nearbyStack(NEARBY_ROOT, { type: 'push', view: stop }), { type: 'push', view: route });
  assert.deepEqual(nearbyStack(s, { type: 'reset' }), [{ kind: 'list' }]);
  assert.equal(nearbyStack(NEARBY_ROOT, { type: 'reset' }), NEARBY_ROOT);
});

test('view keys tell views apart', () => {
  assert.equal(viewKey({ kind: 'list' }), 'list');
  assert.equal(viewKey(stop), 'stop:stop:kl:1000944');
  assert.equal(viewKey({ kind: 'station', stationId: 'kj-taman-paramount' }), 'station:kj-taman-paramount');
  assert.notEqual(viewKey(route), viewKey({ ...route, fromStopIndex: 121 } as NearbyView));
});
