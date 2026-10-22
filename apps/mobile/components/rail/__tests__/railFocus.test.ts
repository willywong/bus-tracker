import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimRailFocus,
  currentRailFocus,
  mapRailFocus,
  NO_RAIL_CLAIMS,
  railFocusKey,
  releaseRailFocus,
  type RailFocus,
} from '../railFocus';

const line: RailFocus = { stationId: null, routeIds: ['rail:KJ'], point: null };
const station: RailFocus = {
  stationId: 'pasar-seni',
  routeIds: ['rail:KJ', 'rail:KGL'],
  point: { lat: 3.1424, lng: 101.6955 },
};

test('the newest claim wins; releasing it restores the one below', () => {
  let c = claimRailFocus(NO_RAIL_CLAIMS, 'line', line);
  assert.deepEqual(currentRailFocus(c), line);
  c = claimRailFocus(c, 'station', station);
  assert.deepEqual(currentRailFocus(c), station);
  c = releaseRailFocus(c, 'station');
  assert.deepEqual(currentRailFocus(c), line);
  c = releaseRailFocus(c, 'line');
  assert.equal(currentRailFocus(c), null);
});

test('blur and focus effects in either order end on the focused screen', () => {
  // Station pushed over line: station focus runs before or after line blur.
  const base = claimRailFocus(NO_RAIL_CLAIMS, 'line', line);
  const a = releaseRailFocus(claimRailFocus(base, 'station', station), 'line');
  const b = claimRailFocus(releaseRailFocus(base, 'line'), 'station', station);
  assert.deepEqual(currentRailFocus(a), station);
  assert.deepEqual(currentRailFocus(b), station);
  // Station closed: line refocus runs before or after station cleanup.
  const c = releaseRailFocus(claimRailFocus(a, 'line', line), 'station');
  const d = claimRailFocus(releaseRailFocus(a, 'station'), 'line', line);
  assert.deepEqual(currentRailFocus(c), line);
  assert.deepEqual(currentRailFocus(d), line);
});

test('re-claiming moves an owner to the top; no-ops keep identity', () => {
  let c = claimRailFocus(NO_RAIL_CLAIMS, 'a', line);
  c = claimRailFocus(c, 'b', station);
  c = claimRailFocus(c, 'a', line);
  assert.deepEqual(c.map((x) => x.owner), ['b', 'a']);
  assert.equal(claimRailFocus(c, 'a', { ...line, routeIds: [...line.routeIds] }), c);
  assert.equal(releaseRailFocus(c, 'nobody'), c);
  // A changed focus under the same owner replaces it.
  const swapped = claimRailFocus(c, 'a', { ...line, routeIds: ['rail:AG'] });
  assert.deepEqual(currentRailFocus(swapped)?.routeIds, ['rail:AG']);
  assert.equal(swapped.length, 2);
});

test('railFocusKey separates station, lines and point', () => {
  assert.equal(railFocusKey(null), null);
  assert.notEqual(railFocusKey(line), railFocusKey(station));
  assert.notEqual(railFocusKey(station), railFocusKey({ ...station, point: null }));
  assert.equal(railFocusKey(station), railFocusKey({ ...station }));
});

test('map focus keeps only drawn lines and never dims everything', () => {
  const drawn = ['rail:KJ', 'rail:AG', 'rail:KGL'];
  assert.equal(mapRailFocus(null, drawn), null);
  assert.deepEqual(mapRailFocus(station, drawn), ['rail:KJ', 'rail:KGL']);
  // Bundled fallback lines are keyed by code: nothing matches, no focus.
  assert.equal(mapRailFocus(station, ['LRT KJ', 'MRT KG']), null);
  assert.equal(mapRailFocus({ stationId: 'x', routeIds: [], point: null }, drawn), null);
});
