/**
 * Throwaway (plan 12/00 step 4): times a whole-network build on the device.
 * Fetches the four fixture zips from a fixture server on the dev machine
 * (`python3 -m http.server 8787` in packages/shared/src/transit/__fixtures__/2026-10-23),
 * then runs the sync and the sliced pass and shows the timings. Dev builds
 * only. `t816://dev-network?auto=3&slice=12` runs three times on open with 12 ms
 * slices (default 8) and logs to Metro.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import {
  BENCH_FEEDS,
  formatTimings,
  runInSlicesMeasured,
  runSyncPass,
  slicedPassSteps,
  type BenchFeed,
} from '../../../packages/shared/scripts/network-bench';

const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';
const FIXTURE_BASE = 'http://localhost:8787/';
const SERVICE_DATE = '20261028';

type Zips = Array<{ feed: BenchFeed; zip: Uint8Array }>;

async function fetchZips(log: (s: string) => void): Promise<Zips> {
  const out: Zips = [];
  for (const feed of BENCH_FEEDS) {
    const t0 = performance.now();
    const res = await fetch(FIXTURE_BASE + feed.file);
    if (!res.ok) throw new Error(`${feed.file}: HTTP ${res.status}`);
    const zip = new Uint8Array(await res.arrayBuffer());
    log(`fetched ${feed.file} ${zip.length} B in ${(performance.now() - t0).toFixed(0)} ms`);
    out.push({ feed, zip });
  }
  return out;
}

/** Longest gap between animation frames while `work` runs. */
async function withFrameGaps<T>(work: () => Promise<T>): Promise<{ value: T; longestGapMs: number }> {
  let running = true;
  let last = performance.now();
  let longest = 0;
  const frame = () => {
    const t = performance.now();
    longest = Math.max(longest, t - last);
    last = t;
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  try {
    return { value: await work(), longestGapMs: longest };
  } finally {
    running = false;
  }
}

async function runOnce(zips: Zips, run: number, sliceMs: number): Promise<string> {
  const lines = [`— run ${run} —`];
  const sync = runSyncPass(zips, SERVICE_DATE);
  lines.push(formatTimings('sync pass', sync));
  // Let a frame or two through before the sliced pass.
  await new Promise((r) => setTimeout(r, 100));
  const stages: Array<[string, number]> = [];
  const { value, longestGapMs } = await withFrameGaps(() =>
    runInSlicesMeasured(slicedPassSteps(zips, SERVICE_DATE, stages), sliceMs),
  );
  lines.push(formatTimings(`sliced pass (${sliceMs} ms slices)`, { stages, net: value.value }));
  const s = value.stats;
  lines.push(
    `  wall ${s.wallMs.toFixed(0)} ms, busy ${s.busyMs.toFixed(0)} ms, ${s.slices} slices, ` +
      `longest slice ${s.longestSliceMs.toFixed(1)} ms, longest frame gap ${longestGapMs.toFixed(1)} ms`,
  );
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
    .HermesInternal;
  const heap = hermes?.getInstrumentedStats?.();
  if (heap) lines.push(`  hermes heap ${((heap.js_heapSize ?? 0) / 1e6).toFixed(1)} MB`);
  return lines.join('\n');
}

export default function DevNetwork() {
  const { auto, slice } = useLocalSearchParams<{ auto?: string; slice?: string }>();
  const sliceMs = Number(slice) || 8;
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const zips = useRef<Zips | null>(null);
  const append = useCallback((s: string) => {
    console.log(`[dev-network] ${s}`);
    setOut((o) => (o ? `${o}\n${s}` : s));
  }, []);

  const run = useCallback(
    async (times: number) => {
      setBusy(true);
      try {
        zips.current ??= await fetchZips(append);
        for (let i = 1; i <= times; i++) append(await runOnce(zips.current, i, sliceMs));
      } catch (e) {
        append(`error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [append, sliceMs],
  );

  useEffect(() => {
    if (ENABLED && auto) void run(Number(auto) || 1);
  }, [auto, run]);

  if (!ENABLED) return null;
  return (
    <>
      <Stack.Screen options={{ title: 'Network build' }} />
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
