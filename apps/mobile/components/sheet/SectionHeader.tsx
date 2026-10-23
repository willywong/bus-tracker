import { Button, Host, HStack, Image, Menu, Text, Toggle } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, useColorScheme, View } from 'react-native';

import {
  SECTION_LABEL,
  SECTION_SYMBOL,
  SHEET_SECTIONS,
  type SheetSection,
} from '@/components/sheet/sections';
import { hex, MARGIN, pick, SECTION_HEADER_ROW_HEIGHT } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/**
 * The top of a section opened from the bus bar: its name as a menu of the
 * sections, then search and close as Liquid Glass circles (the iOS 26 sheet
 * controls). Close puts the sheet away, back to the bar.
 */
export function SectionHeader({
  section,
  onSection,
  onSearch,
  onClose,
}: {
  section: SheetSection;
  onSection: (next: SheetSection) => void;
  onSearch: () => void;
  onClose: () => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const ink = pick(hex.ink, scheme);
  const circle = (label: string) => [
    buttonStyle('glass'),
    buttonBorderShape('circle'),
    controlSize('large'),
    tint(ink),
    accessibilityLabel(label),
  ];
  return (
    <View style={styles.row} accessibilityRole="header">
      <Host matchContents>
        <Menu
          label={
            <HStack
              spacing={6}
              modifiers={[
                accessibilityLabel(`${SECTION_LABEL[section]}. Sections`),
                accessibilityHint('Switch between Plan, Nearby and Saved'),
              ]}
            >
              <Text modifiers={[font({ size: 22, weight: 'bold' })]}>{SECTION_LABEL[section]}</Text>
              <Image systemName="chevron.down" size={13} color={ink} />
            </HStack>
          }
        >
          {SHEET_SECTIONS.map((s) => (
            <Toggle
              key={s}
              label={SECTION_LABEL[s]}
              systemImage={SECTION_SYMBOL[s]}
              isOn={s === section}
              onIsOnChange={() => {
                if (s === section) return;
                haptics.selection();
                onSection(s);
              }}
            />
          ))}
        </Menu>
      </Host>
      <View style={styles.spacer} />
      <Host matchContents>
        <HStack spacing={10}>
          <Button
            onPress={() => {
              haptics.selection();
              onSearch();
            }}
            modifiers={circle('Search')}
          >
            <Image systemName="magnifyingglass" size={17} />
          </Button>
          <Button onPress={onClose} modifiers={circle('Close')}>
            <Image systemName="xmark" size={15} />
          </Button>
        </HStack>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MARGIN,
    minHeight: SECTION_HEADER_ROW_HEIGHT - 8,
    marginBottom: 8,
  },
  spacer: {
    flex: 1,
  },
});
