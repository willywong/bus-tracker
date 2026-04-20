import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { API_BASE_URL } from '@/config/env';
import { bootstrapStaticGtfs } from '@/db/bootstrap';
import { openDb } from '@/db/database';
import { getRoutePolyline, getRoutes, getStops, type StopRow } from '@/db/queries';
import { useStaticGtfs } from '@/hooks/useStaticGtfs';

interface DbSnapshot {
  routeCount: number;
  stopCount: number;
  polylineCount: number;
  primaryCode: string | null;
  stops: StopRow[];
}

export default function GtfsDebugScreen() {
  const gtfs = useStaticGtfs();
  const [snap, setSnap] = useState<DbSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadSnapshot = useCallback(async () => {
    try {
      setSnapError(null);
      const db = await openDb();
      const routes = await getRoutes(db);
      const stops = await getStops(db);
      const primary = routes.find((r) => r.code === 'T816') ?? routes[0] ?? null;
      const polyline = primary ? await getRoutePolyline(db, primary.route_id) : [];
      setSnap({
        routeCount: routes.length,
        stopCount: stops.length,
        polylineCount: polyline.length,
        primaryCode: primary?.code ?? null,
        stops,
      });
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (gtfs.ready) void loadSnapshot();
  }, [gtfs.ready, gtfs.result?.generatedAt, loadSnapshot]);

  const onForceRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await bootstrapStaticGtfs({ force: true });
      await loadSnapshot();
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [loadSnapshot]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>GTFS Static Debug</Text>
      <Text style={styles.subtitle}>{API_BASE_URL}</Text>

      <Section title="Bootstrap">
        <Row label="ready" value={String(gtfs.ready)} />
        <Row label="error" value={gtfs.error?.message ?? '—'} />
        <Row
          label="refreshed this launch"
          value={gtfs.result ? String(gtfs.result.refreshed) : '—'}
        />
        <Row label="generatedAt" value={fmtTs(gtfs.result?.generatedAt ?? null)} />
        {!gtfs.ready && !gtfs.error ? (
          <ActivityIndicator style={{ marginTop: 8 }} />
        ) : null}
      </Section>

      <Section title="SQLite cache">
        {snapError ? <Row label="query error" value={snapError} /> : null}
        <Row label="routes" value={snap ? String(snap.routeCount) : '…'} />
        <Row label="stops" value={snap ? String(snap.stopCount) : '…'} />
        <Row
          label={`polyline (${snap?.primaryCode ?? '—'})`}
          value={snap ? String(snap.polylineCount) : '…'}
        />
      </Section>

      {snap?.stops.length ? (
        <Section title={`Stops (${snap.stops.length})`}>
          {snap.stops.map((s) => (
            <View key={s.stop_id} style={styles.stopRow}>
              <Text style={styles.stopName}>{s.stop_name}</Text>
              <Text style={styles.stopMeta}>
                {s.stop_lat.toFixed(4)}, {s.stop_lon.toFixed(4)}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      <Pressable
        onPress={onForceRefresh}
        disabled={refreshing}
        style={({ pressed }) => [
          styles.btn,
          (pressed || refreshing) && styles.btnPressed,
        ]}
      >
        <Text style={styles.btnText}>
          {refreshing ? 'Refreshing…' : 'Force refresh'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function fmtTs(ms: number | null): string {
  if (ms == null) return '—';
  const d = new Date(ms);
  const deltaSec = Math.round((Date.now() - ms) / 1000);
  const rel =
    deltaSec < 60
      ? `${deltaSec}s ago`
      : deltaSec < 3600
        ? `${Math.round(deltaSec / 60)}m ago`
        : `${Math.round(deltaSec / 3600)}h ago`;
  return `${d.toLocaleString()} (${rel})`;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 48, gap: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 12, opacity: 0.6, marginTop: -8 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', opacity: 0.7, textTransform: 'uppercase' },
  sectionBody: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 2,
    gap: 12,
  },
  rowLabel: { fontSize: 13, opacity: 0.7 },
  rowValue: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  stopRow: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8882',
  },
  stopName: { fontSize: 14 },
  stopMeta: { fontSize: 11, opacity: 0.6, fontVariant: ['tabular-nums'] },
  btn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.6 },
  btnText: { color: 'white', fontWeight: '600' },
});
