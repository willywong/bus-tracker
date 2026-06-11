import { Chart, Host } from '@expo/ui/swift-ui';
import { Platform, StyleSheet, View } from 'react-native';

import type { ApproachSample, ApproachTrend } from '@/hooks/useApproachHistory';
import { glassTokens, trendColor } from '@/components/tracker/tokens';

interface ApproachTrendChartProps {
  samples: readonly ApproachSample[];
  trend: ApproachTrend;
}

/** Below this many samples the line reads as noise rather than a trend. */
const MIN_SAMPLES = 3;

/**
 * A native Swift Charts sparkline of along-route distance to the user's stop
 * over the recent approach. The line falls to the right as the bus closes in,
 * so a steady downslope = approaching, a flat run = stalled, and an upslope =
 * the bus moving away. Lives inside the live card's glass surface as a small,
 * fixed-height SwiftUI Host island.
 */
export function ApproachTrendChart({ samples, trend }: ApproachTrendChartProps) {
  if (samples.length < MIN_SAMPLES || Platform.OS !== 'ios') {
    return <DistanceBars samples={samples} trend={trend} />;
  }

  const color = trendColor[trend] ?? trendColor.unknown;
  const data = samples.map((s, i) => ({ x: i, y: Math.max(0, Math.round(s.forwardMeters)) }));

  return (
    <Host style={styles.host} matchContents={false}>
      <Chart
        data={data}
        type="area"
        animate
        showGrid={false}
        areaStyle={{ color }}
        lineStyle={{ color, width: 2 }}
      />
    </Host>
  );
}

/**
 * Lightweight fallback used before enough samples exist, and on non-iOS where
 * Swift Charts is unavailable. Renders the same distance trajectory as a row of
 * proportional bars.
 */
function DistanceBars({
  samples,
  trend,
}: {
  samples: readonly ApproachSample[];
  trend: ApproachTrend;
}) {
  if (samples.length === 0) {
    return (
      <View style={styles.placeholder}>
        <View style={styles.placeholderLine} />
      </View>
    );
  }

  const color = trendColor[trend] ?? trendColor.unknown;
  const metersList = samples.map((s) => Math.max(0, s.forwardMeters));
  const max = Math.max(1, ...metersList);

  return (
    <View style={styles.bars}>
      {metersList.map((m, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: `${Math.max(8, (m / max) * 100)}%`,
              backgroundColor: color,
              opacity: 0.35 + (i / Math.max(1, metersList.length - 1)) * 0.5,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    height: glassTokens.trendChartHeight,
    alignSelf: 'stretch',
  },
  bars: {
    height: glassTokens.trendChartHeight,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingVertical: 6,
  },
  bar: {
    flex: 1,
    borderRadius: 3,
    minHeight: 4,
  },
  placeholder: {
    height: glassTokens.trendChartHeight,
    justifyContent: 'center',
  },
  placeholderLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: trendColor.unknown,
    opacity: 0.3,
  },
});
