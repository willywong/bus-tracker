import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Completion, MapsErrorCode, Region, ResolvedPlace } from '@/modules/transit-maps';

import {
  COMPLETE_DEBOUNCE_MS,
  createPlaceSearch,
  RESOLVE_IDLE_MS,
  type PlaceSearchDeps,
  type PlaceSearchState,
} from '../placeSearch';

const KLANG_VALLEY: Region = { lat: 3.1, lng: 101.6, latDelta: 0.75, lngDelta: 0.7 };

class CodedError extends Error {
  constructor(readonly code: MapsErrorCode) {
    super(code);
  }
}

/** A manual clock: timers run only when `advance` passes them. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  return {
    schedule(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t.id !== due.id);
        now = due.at;
        due.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const completions = (q: string, n = 5): Completion[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${q}-${i}`, title: `${q} ${i}`, subtitle: 'Kuala Lumpur' }));

const placeFor = (id: string): ResolvedPlace => ({
  name: id,
  address: 'Kuala Lumpur',
  lat: 3.158,
  lng: 101.712,
  category: 'MKPOICategoryStore',
});

function setup(overrides: Partial<PlaceSearchDeps> = {}) {
  const clock = fakeClock();
  const calls = { complete: [] as string[], resolve: [] as string[], regions: [] as Region[] };
  const states: PlaceSearchState[] = [];
  const deps: PlaceSearchDeps = {
    complete: async (q, region) => {
      calls.complete.push(q);
      calls.regions.push(region);
      return { results: completions(q), superseded: false };
    },
    resolve: async (id) => {
      calls.resolve.push(id);
      return placeFor(id);
    },
    schedule: clock.schedule,
    errorCode: (e) => (e instanceof CodedError ? e.code : 'ERR_NOT_FOUND'),
    fallbackRegion: KLANG_VALLEY,
    ...overrides,
  };
  const search = createPlaceSearch(deps, (s) => states.push(s));
  const last = () => states[states.length - 1];
  return { clock, calls, search, last };
}

test('debounces keystrokes', async () => {
  const { clock, calls, search, last } = setup();
  search.setQuery('k', null);
  assert.equal(last().loading, false); // under two characters: no call
  for (const q of ['kl', 'klc', 'klcc']) {
    search.setQuery(q, null);
    await clock.advance(COMPLETE_DEBOUNCE_MS - 20);
  }
  assert.deepEqual(calls.complete, []);
  assert.equal(last().loading, true);
  await clock.advance(20);
  assert.deepEqual(calls.complete, ['klcc']);
  assert.equal(last().loading, false);
  assert.deepEqual(
    last().places.map((p) => p.id),
    completions('klcc').map((c) => c.id),
  );
  assert.deepEqual(calls.regions[0], KLANG_VALLEY);
  // A known position searches a 20 km box around it.
  search.setQuery('pavilion', { lat: 3.149, lng: 101.713 });
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  assert.equal(calls.regions[1].lat, 3.149);
  assert.ok(Math.abs(calls.regions[1].latDelta - 0.18) < 0.01);
});

test('drops superseded batches', async () => {
  const pending: Record<string, ReturnType<typeof deferred<{ results: Completion[]; superseded: boolean }>>> = {};
  const { clock, search, last } = setup({
    complete: (q) => (pending[q] = deferred()).promise,
  });
  search.setQuery('kl', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  search.setQuery('klcc', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  // The newer batch lands first, then the stale one.
  pending.klcc.resolve({ results: completions('klcc'), superseded: false });
  await flush();
  pending.kl.resolve({ results: completions('kl'), superseded: false });
  await flush();
  assert.ok(last().places.every((p) => p.id.startsWith('klcc-')));
  // A batch the native side marks superseded is dropped too.
  search.setQuery('pavilion', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  pending.pavilion.resolve({ results: completions('pavilion'), superseded: true });
  await flush();
  assert.ok(last().places.every((p) => p.id.startsWith('klcc-')));
  assert.equal(last().loading, true);
});

test('resolves only the top three after idle', async () => {
  const { clock, calls, search, last } = setup();
  search.setQuery('klcc', { lat: 3.1579, lng: 101.7116 });
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  assert.deepEqual(calls.resolve, []);
  assert.equal(last().places[0].symbol, 'mappin');
  await clock.advance(RESOLVE_IDLE_MS - COMPLETE_DEBOUNCE_MS - 1);
  assert.deepEqual(calls.resolve, []);
  await clock.advance(1);
  assert.deepEqual(calls.resolve, ['klcc-0', 'klcc-1', 'klcc-2']);
  const [a, b, c, d] = last().places;
  for (const p of [a, b, c]) {
    assert.equal(p.symbol, 'bag.fill');
    assert.ok(p.meters != null && p.meters < 100);
    assert.equal(p.resolved?.name, p.id);
  }
  assert.equal(d.resolved, undefined);
  assert.equal(d.meters, null);
  // Typing again before idle never resolves the earlier query.
  search.setQuery('pav', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  search.setQuery('pavi', null);
  await clock.advance(RESOLVE_IDLE_MS);
  assert.deepEqual(calls.resolve.slice(3), ['pavi-0', 'pavi-1', 'pavi-2']);
  // No position: resolved, but no distance.
  assert.equal(last().places[0].meters, null);
});

test('offline error clears places', async () => {
  let offline = false;
  const { clock, search, last } = setup({
    complete: async (q) => {
      if (offline) throw new CodedError('ERR_OFFLINE');
      return { results: completions(q), superseded: false };
    },
  });
  search.setQuery('klcc', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  assert.equal(last().places.length, 5);
  offline = true;
  search.setQuery('klcc tower', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  assert.deepEqual(last(), { places: [], offline: true, loading: false });
  // Back online, the next query clears the flag.
  offline = false;
  search.setQuery('klcc towers', null);
  await clock.advance(COMPLETE_DEBOUNCE_MS);
  assert.equal(last().offline, false);
  assert.equal(last().places.length, 5);
  // A pick's own resolve failing offline shows the offline row too.
  search.reportOffline();
  assert.deepEqual(last(), { places: [], offline: true, loading: false });
});

test('offline resolve clears places', async () => {
  const { clock, search, last } = setup({
    resolve: async () => {
      throw new CodedError('ERR_OFFLINE');
    },
  });
  search.setQuery('klcc', null);
  await clock.advance(RESOLVE_IDLE_MS);
  assert.deepEqual(last(), { places: [], offline: true, loading: false });
});
