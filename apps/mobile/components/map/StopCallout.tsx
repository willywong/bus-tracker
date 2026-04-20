import { StyleSheet, Text, View } from 'react-native';
import { Callout } from 'react-native-maps';

import type { UseEtaResult } from '@/hooks/useEta';

import { formatDistance, formatStopName } from './format';

interface StopCalloutProps {
  stopName: string;
  eta: UseEtaResult;
}

export function StopCallout({ stopName, eta }: StopCalloutProps) {
  const title = formatStopName(stopName);
  const { body, dimmed } = buildBody(eta);

  return (
    <Callout tooltip>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.body, dimmed ? styles.bodyDim : null]}
            numberOfLines={1}
          >
            {body}
          </Text>
        </View>
        <View style={styles.tail} />
      </View>
    </Callout>
  );
}

function buildBody(eta: UseEtaResult): { body: string; dimmed: boolean } {
  if (eta.minutesToStop == null) {
    return { body: 'Waiting for live ETA…', dimmed: true };
  }
  const min = eta.minutesToStop;
  const distance =
    eta.current?.forwardMeters != null
      ? ` · ${formatDistance(eta.current.forwardMeters)} away`
      : '';
  if (eta.isStale) {
    return { body: `Last seen · ${min} min${distance}`, dimmed: true };
  }
  if (min <= 0) {
    return { body: `Arriving now${distance}`, dimmed: false };
  }
  return { body: `Arriving in ${min} min${distance}`, dimmed: false };
}

const CARD_BG = '#FFFFFF';

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  card: {
    backgroundColor: CARD_BG,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
    minWidth: 180,
    maxWidth: 260,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.22)',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.1,
  },
  body: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    color: '#6E6E73',
  },
  bodyDim: {
    color: '#9A9AA2',
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CARD_BG,
    marginTop: -1,
  },
});
