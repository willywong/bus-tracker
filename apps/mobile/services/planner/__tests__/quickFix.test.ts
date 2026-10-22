import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FALLBACK_FIX_MAX_AGE_MS, FRESH_FIX_MAX_AGE_MS, quickFix } from '../quickFix';

/** Last-known fixes by age: `lastKnown(maxAge)` answers with the newest one that young. */
function deps(opts: { lastKnownAgeMs?: number; current?: () => Promise<string | null> }) {
  const asked: number[] = [];
  let currentCalls = 0;
  return {
    asked,
    get currentCalls() {
      return currentCalls;
    },
    lastKnown: async (maxAgeMs: number) => {
      asked.push(maxAgeMs);
      return opts.lastKnownAgeMs != null && opts.lastKnownAgeMs <= maxAgeMs ? `last@${opts.lastKnownAgeMs}` : null;
    },
    current: () => {
      currentCalls++;
      return opts.current ? opts.current() : Promise.resolve('current');
    },
  };
}

const never = () => new Promise<string | null>(() => {});
/** A fresh fix that comes in after the timeout. */
const late = () => new Promise<string | null>((resolve) => setTimeout(() => resolve('late'), 60));

test('a last-known fix under a minute old is used without asking for a new one', async () => {
  const d = deps({ lastKnownAgeMs: 30_000 });
  assert.equal(await quickFix(d), 'last@30000');
  assert.equal(d.currentCalls, 0);
  assert.deepEqual(d.asked, [FRESH_FIX_MAX_AGE_MS]);
});

test('otherwise a fresh fix that comes in time wins', async () => {
  const d = deps({ lastKnownAgeMs: 5 * 60_000 });
  assert.equal(await quickFix(d, { timeoutMs: 50 }), 'current');
  assert.deepEqual(d.asked, [FRESH_FIX_MAX_AGE_MS]);
});

test('on timeout an older last-known fix (≤ 10 min) is used', async () => {
  const d = deps({ lastKnownAgeMs: 5 * 60_000, current: never });
  const t0 = Date.now();
  assert.equal(await quickFix(d, { timeoutMs: 20 }), 'last@300000');
  assert.ok(Date.now() - t0 < 1_000);
  assert.deepEqual(d.asked, [FRESH_FIX_MAX_AGE_MS, FALLBACK_FIX_MAX_AGE_MS]);
});

test('on timeout with nothing recent enough it waits for the fresh fix', async () => {
  assert.equal(await quickFix(deps({ lastKnownAgeMs: 20 * 60_000, current: late }), { timeoutMs: 20 }), 'late');
  assert.equal(await quickFix(deps({ current: late }), { timeoutMs: 20 }), 'late');
});

test('a failing fresh fix with nothing else: null', async () => {
  const fail = () => Promise.reject(new Error('denied'));
  assert.equal(await quickFix(deps({ current: fail }), { timeoutMs: 1_000 }), null);
});

test('a failing fresh fix falls back like a timeout', async () => {
  const d = deps({ lastKnownAgeMs: 2 * 60_000, current: () => Promise.reject(new Error('denied')) });
  assert.equal(await quickFix(d, { timeoutMs: 1_000 }), 'last@120000');
});

test('a wider fresh window than the fallback skips the fallback', async () => {
  const d = deps({ lastKnownAgeMs: 20 * 60_000, current: never });
  assert.equal(await quickFix(d, { freshMaxAgeMs: 30 * 60_000, fallbackMaxAgeMs: 10 * 60_000, timeoutMs: 20 }), 'last@1200000');
  const e = deps({ current: late });
  assert.equal(await quickFix(e, { freshMaxAgeMs: 30 * 60_000, fallbackMaxAgeMs: 10 * 60_000, timeoutMs: 20 }), 'late');
  assert.deepEqual(e.asked, [30 * 60_000]);
});
