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
  font,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';

interface RouteSwitcherProps {
  selected: RouteId;
  options: readonly RouteId[];
  onSelect: (code: RouteId) => void;
}

/**
 * Glass is applied to the HStack inside the Menu's label builder — not to
 * the Menu itself. When glass sits on the Menu, SwiftUI collapses the
 * built-in `Label(_:systemImage:)` trigger to icon-only and the route
 * code disappears. Composing a custom HStack label sidesteps that.
 */
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
              padding({ horizontal: 14, vertical: 8 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'capsule',
              }),
            ]}
          >
            <Image systemName="bus.fill" size={14} />
            <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>
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
