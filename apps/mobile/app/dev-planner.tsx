/**
 * Throwaway (plan 14/00 step 4; deleted in 14/06): times `plan()` (14/04,
 * end to end) on the device. Fetches the four fixture zips from a fixture
 * server on the dev machine (`python3 -m http.server 8787` in
 * packages/shared/src/transit/__fixtures__/2026-10-23), compiles them for
 * 20261028 (with and without rail), then runs the five golden queries:
 * 2 warm-ups and 20 timed `planSync` runs (the 40-min `PLAN_WINDOW_SEC`), a
 * sliced pass (8 ms slices), and the Hermes heap around one query. Dev builds
 * or EXPO_PUBLIC_DEV_TOOLS=1 only. `t816://dev-planner?auto=3` runs three
 * times on open and logs to Metro with a `[dev-planner]` prefix.
 */
import { FEED_IDS, plan, PLAN_WINDOW_SEC, planSync, toServiceSeconds, type FeedId, type PlanResult } from '@bus-tracker/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { runInSlicesMeasured } from '../../../packages/shared/scripts/network-bench';
import {
  clock,
  compileFixtures,
  engineBytes,
  FIXTURE_ZIPS,
  networkBytes,
  percentiles,
  prepareQueries,
  readFixtureFeeds,
  type PreparedQuery,
} from '../../../packages/shared/scripts/raptor-queries';

const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';
const FIXTURE_BASE = 'http://localhost:8787/';
const WARMUP = 2;
const RUNS = 20;
const SLICED_RUNS = 5;
const SLICE_MS = 8;

type Zips = Record<FeedId, Uint8Array>;

async function fetchZips(log: (s: string) => void): Promise<Zips> {
  const out = {} as Zips;
  for (const feed of FEED_IDS) {
    const t0 = performance.now();
    const res = await fetch(FIXTURE_BASE + FIXTURE_ZIPS[feed]);
    if (!res.ok) throw new Error(`${FIXTURE_ZIPS[feed]}: HTTP ${res.status}`);
    out[feed] = new Uint8Array(await res.arrayBuffer());
    log(`fetched ${FIXTURE_ZIPS[feed]} ${out[feed].length} B in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return out;
}

function heapMB(): number | null {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
    .HermesInternal;
  const size = hermes?.getInstrumentedStats?.()?.js_heapSize;
  return size == null ? null : size / 1e6;
}

const pause = () => new Promise((r) => setTimeout(r, 50));
const ms = (n: number) => n.toFixed(1).padStart(6);

function build(zips: Zips, log: (s: string) => void): PreparedQuery[] {
  let t = performance.now();
  const feeds = readFixtureFeeds(zips);
  log(`read feeds ${(performance.now() - t).toFixed(0)} ms`);
  t = performance.now();
  const full = compileFixtures(feeds);
  log(`compile 20261028 ${(performance.now() - t).toFixed(0)} ms`);
  t = performance.now();
  const noRail = compileFixtures(feeds, ['rail']);
  log(`compile without rail ${(performance.now() - t).toFixed(0)} ms`);
  log(
    `net ${full.stops.count} stops, ${full.patterns.count} patterns, typed arrays ${(networkBytes(full) / 1e6).toFixed(2)} MB, ` +
      `engine workspace ${(engineBytes(full) / 1e6).toFixed(2)} MB`,
  );
  return prepareQueries(full, noRail);
}

/** `HH:MM` of the fastest itinerary's arrival, or `—`. */
function arrival(q: PreparedQuery, r: PlanResult): string {
  const first = r.itineraries[0];
  return first ? clock(toServiceSeconds(q.net, first.arriveAt)) : clock(Infinity);
}

async function runOnce(queries: PreparedQuery[], run: number, log: (s: string) => void): Promise<void> {
  log(`— run ${run} —`);
  log(`planSync, ${PLAN_WINDOW_SEC / 60}-min window: query | arrive | its | p50 | p95 | max (ms)`);
  for (const q of queries) {
    for (let i = 0; i < WARMUP; i++) planSync(q.net, q.plan);
    const samples: number[] = [];
    let r = planSync(q.net, q.plan);
    for (let i = 0; i < RUNS; i++) {
      const s = performance.now();
      r = planSync(q.net, q.plan);
      samples.push(performance.now() - s);
    }
    const p = percentiles(samples);
    log(
      `  ${q.query.name.padEnd(21)} | ${arrival(q, r).padStart(5)} | ${String(r.itineraries.length).padStart(3)} | ` +
        `${ms(p.p50)} | ${ms(p.p95)} | ${ms(p.max)}`,
    );
    await pause();
  }

  log(`sliced plan() (${SLICE_MS} ms slices), ${SLICED_RUNS} runs: query | wall p50 | busy p50 | longest slice (ms)`);
  for (const q of queries) {
    const wall: number[] = [];
    const busy: number[] = [];
    let longest = 0;
    for (let i = 0; i < SLICED_RUNS; i++) {
      const { stats } = await runInSlicesMeasured(plan(q.net, q.plan), SLICE_MS);
      wall.push(stats.wallMs);
      busy.push(stats.busyMs);
      longest = Math.max(longest, stats.longestSliceMs);
    }
    log(`  ${q.query.name.padEnd(21)} | ${ms(percentiles(wall).p50)} | ${ms(percentiles(busy).p50)} | ${ms(longest)}`);
  }

  log('hermes heap around one planSync: query | before | after (MB)');
  for (const q of queries) {
    const before = heapMB();
    const r = planSync(q.net, q.plan);
    const after = heapMB();
    log(
      `  ${q.query.name.padEnd(21)} | ${before == null ? 'n/a' : before.toFixed(2)} | ${after == null ? 'n/a' : after.toFixed(2)}` +
        (r.itineraries.length === 0 ? ' (no itinerary)' : ''),
    );
  }
}

export default function DevPlanner() {
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const queries = useRef<PreparedQuery[] | null>(null);
  const append = useCallback((s: string) => {
    console.log(`[dev-planner] ${s}`);
    setOut((o) => (o ? `${o}\n${s}` : s));
  }, []);

  const run = useCallback(
    async (times: number) => {
      setBusy(true);
      try {
        if (!queries.current) {
          const zips = await fetchZips(append);
          await pause();
          queries.current = build(zips, append);
        }
        for (let i = 1; i <= times; i++) {
          await pause();
          await runOnce(queries.current, i, append);
        }
        append('done');
      } catch (e) {
        append(`error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  useEffect(() => {
    if (ENABLED && auto) void run(Number(auto) || 1);
  }, [auto, run]);

  if (!ENABLED) return null;
  return (
    <>
      <Stack.Screen options={{ title: 'Planner timing' }} />
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.row}>
          <Pressable disabled={busy} onPress={() => void run(1)} style={styles.button}>
            <Text style={styles.buttonText}>{busy ? 'Running…' : 'Run'}</Text>
          </Pressable>
          <Pressable onPress={() => void Share.share({ message: out })} style={styles.button}>
            <Text style={styles.buttonText}>Copy</Text>
          </Pressable>
        </View>
        <Text selectable style={styles.mono}>
          {out || `Serve the fixtures at ${FIXTURE_BASE}, then Run.`}
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#8884' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  mono: { fontFamily: 'Menlo', fontSize: 11 },
});
