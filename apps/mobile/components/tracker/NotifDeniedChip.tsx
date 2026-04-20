import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { heroStateColor, surfaceColor, trackerSpacing } from './tokens';

export function NotifDeniedChip() {
  const tint = heroStateColor.waiting;

  return (
    <View style={[styles.chip, { backgroundColor: surfaceColor.amberTint }]}>
      <SymbolView
        name="bell.slash.fill"
        size={15}
        tintColor={tint}
        resizeMode="scaleAspectFit"
        style={styles.icon}
      />
      <Text style={[styles.text, { color: tint }]} numberOfLines={2} selectable>
        Notifications disabled — enable in Settings to get “Leave now” alerts.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: trackerSpacing.cardRadius,
    borderCurve: 'continuous',
  },
  icon: { width: 15, height: 15 },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
  },
});
