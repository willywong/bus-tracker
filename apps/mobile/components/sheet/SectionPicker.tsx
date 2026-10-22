import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { SECTION_LABEL, SHEET_SECTIONS, type SheetSection } from '@/components/sheet/sections';
import { MARGIN, SECTION_PICKER_ROW_HEIGHT } from '@/theme/design';
import { haptics } from '@/utils/haptics';

/**
 * Plan · Nearby · Saved under "Where to?": the system segmented control,
 * untinted, so it reads as ink on a grey track like the rest of Calm Mono.
 */
export function SectionPicker({
  value,
  onChange,
}: {
  value: SheetSection;
  onChange: (next: SheetSection) => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <Picker<SheetSection>
        label="Sheet section"
        selection={value}
        onSelectionChange={(next) => {
          if (next === value || !SHEET_SECTIONS.includes(next)) return;
          haptics.selection();
          onChange(next);
        }}
        modifiers={[pickerStyle('segmented')]}
      >
        {SHEET_SECTIONS.map((s) => (
          <Text key={s} modifiers={[tag(s)]}>
            {SECTION_LABEL[s]}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    height: SECTION_PICKER_ROW_HEIGHT - 8,
    marginHorizontal: MARGIN,
    marginBottom: 8,
  },
});
