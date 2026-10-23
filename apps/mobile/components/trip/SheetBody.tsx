import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { SectionLabel } from '@/components/trip/Rows';
import {
  color,
  CSS_EASE_OUT,
  MARGIN,
  motion,
  SHEET_REVEAL_SHIFT,
  space,
} from '@/theme/design';

const BodyHidden = createContext(false);

/**
 * True while the body is mounted but hidden at peek: looping decoration
 * inside it (the "Arriving" sweep) should hold still rather than animate
 * unseen.
 */
export function useSheetBodyHidden(): boolean {
  return useContext(BodyHidden);
}

/**
 * Everything under the header. At peek it stays mounted (no SwiftUI host
 * re-creation) but invisible and untouchable, so nothing peeks out clipped
 * under the header and the peek strip can sit over its top edge.
 *
 * The detent only reports once a drag is released, as the native sheet
 * starts its snap, so the crossfade runs alongside the snap rather than
 * tracking the finger: the body rises a few points and fades in as the sheet
 * grows out of peek, and fades out faster as it collapses. Opacity and
 * transform only, on the UI thread; reduced motion keeps just the fade.
 */
export function SheetBody({ peek, children }: { peek: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      style={[
        styles.body,
        {
          opacity: peek ? 0 : 1,
          transform: [{ translateY: peek && !reduceMotion ? SHEET_REVEAL_SHIFT : 0 }],
          transitionProperty: ['opacity', 'transform'],
          transitionDuration: peek ? motion.sheetOut : motion.sheetIn,
          transitionTimingFunction: CSS_EASE_OUT,
        },
      ]}
      pointerEvents={peek ? 'none' : 'auto'}
      accessibilityElementsHidden={peek}
      importantForAccessibility={peek ? 'no-hide-descendants' : 'auto'}
    >
      <BodyHidden.Provider value={peek}>{children}</BodyHidden.Provider>
    </Animated.View>
  );
}

/**
 * A titled section under a full-width rule. `accessory` sits on the title's
 * line, trailing (a line's running hours beside its name).
 */
export function Section({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {accessory ? (
        <View style={styles.titleRow}>
          <SectionLabel>{title}</SectionLabel>
          {accessory}
        </View>
      ) : (
        <SectionLabel>{title}</SectionLabel>
      )}
      {children}
    </View>
  );
}

/** Section rules are a full point, so they read above the row hairlines. */
export const SECTION_RULE = 1;

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: MARGIN,
    paddingTop: space.xxs,
    gap: space.lg,
  },
  section: {
    gap: space.xxs,
    marginHorizontal: -MARGIN,
    paddingHorizontal: MARGIN,
    paddingTop: space.lg,
    borderTopWidth: SECTION_RULE,
    borderTopColor: color.hairline,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: space.sm,
  },
});
