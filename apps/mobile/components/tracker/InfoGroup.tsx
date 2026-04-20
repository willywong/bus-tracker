import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { surfaceColor, trackerSpacing } from './tokens';

interface InfoGroupProps {
  children: ReactNode;
}

/**
 * iOS grouped-list card container. Renders children as rows with a hairline
 * between each (inset on the leading edge, matching Apple's Settings app).
 */
export function InfoGroup({ children }: InfoGroupProps) {
  const items = Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.card}>
      {items.map((child, idx) => (
        <Fragment key={idx}>
          {child}
          {idx < items.length - 1 ? <View style={styles.hairline} /> : null}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: surfaceColor.grouped,
    borderRadius: trackerSpacing.cardRadius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: surfaceColor.hairline,
    marginLeft: trackerSpacing.rowH,
  },
});
