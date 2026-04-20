import type { RouteId } from '@bus-tracker/shared';
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
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';

interface RouteSwitcherProps {
  selected: RouteId;
  options: readonly RouteId[];
  onSelect: (code: RouteId) => void;
}

export function RouteSwitcher({
  selected,
  options,
  onSelect,
}: RouteSwitcherProps) {
  return (
    <Host matchContents style={{ alignSelf: 'center' }}>
      <Menu
        label={
          <HStack
            spacing={6}
            modifiers={[
              fixedSize(),
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
              {selected}
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
      </Menu>
    </Host>
  );
}
