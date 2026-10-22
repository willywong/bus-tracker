import assert from 'node:assert/strict';
import test from 'node:test';

import { isBareLink, railDeepLink } from '../deepLink';

test('station path with and without scheme maps to /station?station=', () => {
  assert.equal(railDeepLink('station/pasar-seni'), '/station?station=pasar-seni');
  assert.equal(railDeepLink('t816://station/pasar-seni'), '/station?station=pasar-seni');
  assert.equal(railDeepLink('/station/pasar-seni'), '/station?station=pasar-seni');
  assert.equal(railDeepLink('t816:///station/kl-sentral/'), '/station?station=kl-sentral');
  // Unknown slugs still open the sheet, which says "Station not found".
  assert.equal(railDeepLink('t816://station/nowhere'), '/station?station=nowhere');
});

test('line path maps routeId and dir, encoding preserved', () => {
  assert.equal(railDeepLink('line/rail%3AKJ/1'), '/line?line=rail%3AKJ&dir=1');
  assert.equal(railDeepLink('t816://line/rail%3AKJ/0'), '/line?line=rail%3AKJ&dir=0');
  assert.equal(railDeepLink('t816://line/rail:KJ/1'), '/line?line=rail%3AKJ&dir=1');
  assert.equal(railDeepLink('line/ktm%3AKC05_KB18/1'), '/line?line=ktm%3AKC05_KB18&dir=1');
});

test('bare t816:// and unknown paths return null', () => {
  for (const path of [
    't816://',
    't816:///',
    '',
    '/',
    'station',
    't816://station/',
    't816://station?station=pasar-seni',
    't816://line?line=rail:KJ&dir=1',
    't816://station/a/b',
    't816://stops',
    't816://trip',
    'https://example.com/station/pasar-seni',
    'station/%E0%A4%A',
  ]) {
    assert.equal(railDeepLink(path), null, path);
  }
});

test('invalid dir (not 0/1) returns null', () => {
  for (const path of ['line/rail%3AKJ/2', 'line/rail%3AKJ/', 'line/rail%3AKJ', 'line/rail%3AKJ/x', 'line//1']) {
    assert.equal(railDeepLink(path), null, path);
  }
});

test('isBareLink: only the scheme, with or without slashes', () => {
  for (const path of ['t816://', 'T816:///', ' t816:// ', '/', '']) assert.equal(isBareLink(path), true, path);
  for (const path of ['t816://station/kl-sentral', 't816://line/rail:KJ/1', '/trip', 't816://?x=1']) {
    assert.equal(isBareLink(path), false, path);
  }
});
