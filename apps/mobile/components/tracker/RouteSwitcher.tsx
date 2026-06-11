import {
  Button,
  Host,
  HStack,
  Image,
  Menu,
  Text,
} from '@expo/ui/swift-ui';
import {
  fixedSize,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { Pressable, StyleSheet } from 'react-native';

interface RouteSwitcherProps {
  selected: string | null;
  options: readonly string[];
  onSelect: (code: string) => void;
  onAddBus: () => void;
}

export function RouteSwitcher({
  selected,
  options,
  onSelect,
  onAddBus,
}: RouteSwitcherProps) {
  if (options.length === 0) {
    return (
      <Pressable
        onPress={onAddBus}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add your first bus"
        style={({ pressed }) => ({
          alignSelf: 'center',
          flexShrink: 1,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Host matchContents>
          <HStack
            spacing={6}
            modifiers={[
              fixedSize(),
              frame({ maxWidth: 170 }),
              padding({ horizontal: 14, vertical: 8 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'capsule',
              }),
            ]}
          >
            <Image systemName="plus" size={13} />
            <Text
              modifiers={[
                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
              ]}
            >
              Add bus
            </Text>
          </HStack>
        </Host>
      </Pressable>
    );
  }

  const triggerLabel = selected ?? options[0] ?? 'Bus';

  return (
    <Host matchContents style={styles.host}>
      <Menu
        label={
          <HStack
            spacing={6}
            modifiers={[
              fixedSize(),
              frame({ maxWidth: 170 }),
              padding({ horizontal: 14, vertical: 8 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'capsule',
              }),
            ]}
          >
            <Image systemName="bus.fill" size={14} />
            <Text
              modifiers={[
                foregroundStyle({ type: 'hierarchical', style: 'primary' }),
              ]}
            >
              {triggerLabel}
            </Text>
            <Image systemName="chevron.down" size={11} />
          </HStack>
        }
      >
        {options.map((code) => (
          <Button
            key={code}
            systemImage={code === selected ? 'checkmark' : undefined}
            label={code}
            onPress={() => onSelect(code)}
          />
        ))}
        <Button
          key="__add_bus"
          systemImage="plus"
          label="Add bus…"
          onPress={onAddBus}
        />
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'center',
    flexShrink: 1,
  },
});
