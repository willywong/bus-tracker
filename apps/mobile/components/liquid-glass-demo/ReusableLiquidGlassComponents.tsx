import {
  Alert as SwiftUIAlert,
  BottomSheet,
  Button,
  Chart,
  ColorPicker,
  ConfirmationDialog,
  ContentUnavailableView,
  ContextMenu,
  ControlGroup,
  DatePicker,
  DisclosureGroup,
  Form,
  Gauge,
  GlassEffectContainer,
  Grid,
  Group,
  HStack,
  Host,
  Image,
  Label,
  LabeledContent,
  LazyHStack,
  Link as SwiftUILink,
  Menu,
  Picker,
  Popover,
  ProgressView,
  ScrollView as SwiftUIScrollView,
  Section,
  SecureField,
  ShareLink,
  Slider,
  SwipeActions,
  Stepper,
  TabView,
  Text,
  TextField,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import type { ButtonProps } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  labelStyle,
  listRowBackground,
  opacity,
  padding,
  pickerStyle,
  progressViewStyle,
  scrollIndicators,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useState, type ReactElement } from 'react';
import { Alert as RNAlert, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  DemoCard,
  InfoText,
  PlatformFallback,
  demoColors,
} from '@/components/liquid-glass-demo/DemoScaffold';

type SheetSize = 'compact' | 'medium' | 'expanded';
type DemoCategory =
  | 'Messaging & Input'
  | 'Sheets & Dialogs'
  | 'Controls & Pickers'
  | 'Status & Data'
  | 'Lists & Actions'
  | 'Navigation & Sharing';

export type ReusableComponentDemo = {
  slug: string;
  title: string;
  category: DemoCategory;
  description: string;
  apis: string[];
  iosNote: string;
  Component: () => ReactElement;
};

export function ReusableComponentsUnavailable() {
  return <PlatformFallback feature="@expo/ui reusable Liquid Glass components" />;
}

export const reusableComponentCategories: DemoCategory[] = [
  'Messaging & Input',
  'Sheets & Dialogs',
  'Controls & Pickers',
  'Status & Data',
  'Lists & Actions',
  'Navigation & Sharing',
];

export const reusableComponentDemos: ReusableComponentDemo[] = [
  {
    slug: 'message-composer',
    title: 'Message composer',
    category: 'Messaging & Input',
    description: 'Typical chat, support, or comment composer with attachment and send actions.',
    apis: ['Host', 'TextField', 'Menu', 'Button', 'GlassEffectContainer'],
    iosNote: 'Uses SwiftUI controls and iOS 26 glass button styles on supported builds.',
    Component: GlassMessageComposer,
  },
  {
    slug: 'secure-input',
    title: 'Secure input',
    category: 'Messaging & Input',
    description: 'Protected-code or password entry with a glass action button.',
    apis: ['Host', 'SecureField', 'Button', 'glassEffect'],
    iosNote: 'SecureField is rendered by @expo/ui SwiftUI on iOS.',
    Component: GlassSecureInput,
  },
  {
    slug: 'bottom-action-sheet',
    title: 'Bottom action sheet',
    category: 'Sheets & Dialogs',
    description: 'Command sheet for filters, route actions, or quick actions.',
    apis: ['Host', 'BottomSheet', 'Group', 'Button'],
    iosNote: 'BottomSheet uses native SwiftUI sheet presentation on iOS.',
    Component: GlassBottomActionSheet,
  },
  {
    slug: 'confirmation-action',
    title: 'Confirmation action',
    category: 'Sheets & Dialogs',
    description: 'Destructive or high-impact action with native confirmation chrome.',
    apis: ['Host', 'ConfirmationDialog', 'Button'],
    iosNote: 'ConfirmationDialog is native SwiftUI and guarded to iOS.',
    Component: GlassConfirmationAction,
  },
  {
    slug: 'alert-banner',
    title: 'Alert banner',
    category: 'Sheets & Dialogs',
    description: 'Native alert trigger for route delays or important notices.',
    apis: ['Host', 'Alert', 'Button'],
    iosNote: 'Alert uses native SwiftUI alert presentation on iOS.',
    Component: GlassAlertBanner,
  },
  {
    slug: 'popover-tip',
    title: 'Popover tip',
    category: 'Sheets & Dialogs',
    description: 'Inline contextual help or stop guidance with a popover.',
    apis: ['Host', 'Popover', 'Button', 'VStack'],
    iosNote: 'Popover is a native SwiftUI presentation surface.',
    Component: GlassPopoverTip,
  },
  {
    slug: 'settings-controls',
    title: 'Settings controls',
    category: 'Controls & Pickers',
    description: 'Settings group with native toggle, slider, and segmented picker.',
    apis: ['Host', 'Toggle', 'Slider', 'Picker', 'LabeledContent'],
    iosNote: 'The glass wrapper uses iOS 26 glassEffect on supported builds.',
    Component: GlassSettingsControls,
  },
  {
    slug: 'schedule-picker',
    title: 'Schedule picker',
    category: 'Controls & Pickers',
    description: 'Reminder or trip scheduling control with native date and time selection.',
    apis: ['Host', 'DatePicker', 'LabeledContent', 'Button'],
    iosNote: 'DatePicker is native SwiftUI and rendered only on iOS.',
    Component: GlassSchedulePicker,
  },
  {
    slug: 'theme-color-picker',
    title: 'Theme color picker',
    category: 'Controls & Pickers',
    description: 'Appearance customization control with ColorPicker and a segmented picker.',
    apis: ['Host', 'ColorPicker', 'Picker', 'LabeledContent'],
    iosNote: 'ColorPicker uses the native iOS SwiftUI color picker.',
    Component: GlassThemeColorPicker,
  },
  {
    slug: 'quick-control-group',
    title: 'Quick control group',
    category: 'Controls & Pickers',
    description: 'Compact action cluster with buttons and a passenger stepper.',
    apis: ['Host', 'ControlGroup', 'Stepper', 'Button'],
    iosNote: 'Glass styles require iOS 26 for the native Liquid Glass look.',
    Component: GlassQuickControlGroup,
  },
  {
    slug: 'filter-form',
    title: 'Filter form',
    category: 'Controls & Pickers',
    description: 'Native form for route filters with toggles and segmented sorting.',
    apis: ['Host', 'Form', 'Section', 'Toggle', 'Picker'],
    iosNote: 'Form and Section render as native SwiftUI on iOS.',
    Component: GlassFilterForm,
  },
  {
    slug: 'stepper-panel',
    title: 'Stepper panel',
    category: 'Controls & Pickers',
    description: 'Small numeric control for stops, riders, or quantity selection.',
    apis: ['Host', 'Stepper', 'LabeledContent'],
    iosNote: 'Stepper is native SwiftUI and guarded to iOS.',
    Component: GlassStepperPanel,
  },
  {
    slug: 'metric-status-card',
    title: 'Metric status card',
    category: 'Status & Data',
    description: 'Dashboard card with Gauge and ProgressView.',
    apis: ['Host', 'Gauge', 'ProgressView', 'Label'],
    iosNote: 'The card uses iOS 26 glassEffect on supported builds.',
    Component: GlassMetricStatusCard,
  },
  {
    slug: 'leave-now-coach',
    title: 'Leave-now coach',
    category: 'Status & Data',
    description: 'Decision coach for whether to leave, hurry, or wait for the next bus.',
    apis: ['Host', 'Gauge', 'ProgressView', 'ControlGroup', 'Button'],
    iosNote: 'Uses SwiftUI status controls and iOS 26 glassEffect on supported builds.',
    Component: GlassLeaveNowCoach,
  },
  {
    slug: 'stop-approach-coach',
    title: 'Stop approach coach',
    category: 'Status & Data',
    description: 'Live-stop approach panel with arrived, approaching, passed, and stale states.',
    apis: ['Host', 'DisclosureGroup', 'LabeledContent', 'ProgressView', 'Label'],
    iosNote: 'Uses native SwiftUI disclosure and progress controls on iOS.',
    Component: GlassStopApproachCoach,
  },
  {
    slug: 'chart-card',
    title: 'Chart card',
    category: 'Status & Data',
    description: 'Swift Charts card for boardings, demand, or performance metrics.',
    apis: ['Host', 'Chart', 'VStack'],
    iosNote: 'Chart uses native Swift Charts through @expo/ui on iOS.',
    Component: GlassChartCard,
  },
  {
    slug: 'progress-checklist',
    title: 'Progress checklist',
    category: 'Status & Data',
    description: 'Checklist with progress feedback for multi-step setup.',
    apis: ['Host', 'ProgressView', 'Toggle'],
    iosNote: 'ProgressView and Toggle render as native SwiftUI controls.',
    Component: GlassProgressChecklist,
  },
  {
    slug: 'empty-state',
    title: 'Empty state',
    category: 'Status & Data',
    description: 'Native empty state for missing saved routes or empty search results.',
    apis: ['Host', 'ContentUnavailableView', 'Button'],
    iosNote: 'ContentUnavailableView is available on modern iOS via SwiftUI.',
    Component: GlassEmptyState,
  },
  {
    slug: 'swipe-action-row',
    title: 'Swipe action row',
    category: 'Lists & Actions',
    description: 'Task, inbox, or reminder row with swipe actions and a context menu.',
    apis: ['Host', 'SwipeActions', 'ContextMenu', 'Button'],
    iosNote: 'SwipeActions and ContextMenu are native iOS interaction patterns.',
    Component: GlassSwipeActionRow,
  },
  {
    slug: 'trip-details-disclosure',
    title: 'Trip details disclosure',
    category: 'Lists & Actions',
    description: 'Expandable trip detail panel for secondary information.',
    apis: ['Host', 'DisclosureGroup', 'Label'],
    iosNote: 'DisclosureGroup renders as native SwiftUI on iOS.',
    Component: GlassTripDetailsDisclosure,
  },
  {
    slug: 'grid-launcher',
    title: 'Grid launcher',
    category: 'Lists & Actions',
    description: 'Quick launcher grid for common app destinations.',
    apis: ['Host', 'Grid', 'Image', 'Text'],
    iosNote: 'Grid and glassEffect render natively on iOS.',
    Component: GlassGridLauncher,
  },
  {
    slug: 'scroll-shelf',
    title: 'Scroll shelf',
    category: 'Lists & Actions',
    description: 'Horizontal shelf for saved routes or transport modes.',
    apis: ['Host', 'ScrollView', 'LazyHStack', 'glassEffect'],
    iosNote: 'Uses SwiftUI ScrollView and LazyHStack on iOS.',
    Component: GlassScrollShelf,
  },
  {
    slug: 'context-menu-card',
    title: 'Context menu card',
    category: 'Lists & Actions',
    description: 'Long-press action card with a native context menu.',
    apis: ['Host', 'ContextMenu', 'Button', 'Label'],
    iosNote: 'ContextMenu is a native iOS interaction surface.',
    Component: GlassContextMenuCard,
  },
  {
    slug: 'route-save-flow',
    title: 'Route save flow',
    category: 'Lists & Actions',
    description: 'Mini add-bus flow showing route, stop, favorite limit, and save states.',
    apis: ['Host', 'Form', 'Section', 'Picker', 'ConfirmationDialog', 'Button'],
    iosNote: 'Uses native SwiftUI form, picker, and confirmation dialog on iOS.',
    Component: GlassRouteSaveFlow,
  },
  {
    slug: 'share-card',
    title: 'Share card',
    category: 'Navigation & Sharing',
    description: 'Native share surface for ETA, route, or stop information.',
    apis: ['Host', 'ShareLink', 'Label'],
    iosNote: 'ShareLink uses native iOS sharing behavior.',
    Component: GlassShareCard,
  },
  {
    slug: 'tab-preview',
    title: 'Tab preview',
    category: 'Navigation & Sharing',
    description: 'Inline native TabView preview for segmented content.',
    apis: ['Host', 'TabView', 'TabView.Tab'],
    iosNote: 'TabView is native SwiftUI; routed tabs should still use Expo Router NativeTabs.',
    Component: GlassTabPreview,
  },
  {
    slug: 'native-link-card',
    title: 'Native link card',
    category: 'Navigation & Sharing',
    description: 'Native SwiftUI Link card for external destinations.',
    apis: ['Host', 'Link', 'Image', 'Text'],
    iosNote: 'SwiftUI Link opens URLs using native platform behavior.',
    Component: GlassNativeLinkCard,
  },
  {
    slug: 'compact-menu-bar',
    title: 'Compact menu bar',
    category: 'Navigation & Sharing',
    description: 'Compact command bar with Menu and icon-only glass buttons.',
    apis: ['Host', 'ControlGroup', 'Menu', 'Button'],
    iosNote: 'Glass button styles require iOS 26 for the native Liquid Glass look.',
    Component: GlassCompactMenuBar,
  },
];

export function getReusableComponentDemo(slug: string | string[] | undefined) {
  const normalizedSlug = Array.isArray(slug) ? slug[0] : slug;
  return reusableComponentDemos.find((demo) => demo.slug === normalizedSlug);
}

export function GlassMessageComposer() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Message composer" />;
  }

  return (
    <Host style={styles.hostComposer} useViewportSizeMeasurement>
      <GlassEffectContainer spacing={14}>
        <HStack spacing={8} modifiers={[padding({ horizontal: 10, vertical: 6 })]}>
          {/* iOS 26-only: buttonStyle('glass') renders with Liquid Glass when built with Xcode 26. */}
          <Menu
            label="Attach"
            systemImage="plus"
            modifiers={[
              buttonStyle('glass'),
              labelStyle('iconOnly'),
              controlSize('regular'),
            ]}
          >
            <Button label="Photo" systemImage="photo" onPress={() => alertAction('Photo')} />
            <Button label="Location" systemImage="location" onPress={() => alertAction('Location')} />
          </Menu>
          <TextField
            placeholder="Message"
            axis="vertical"
            maxLength={180}
            modifiers={[
              frame({ minWidth: 190, maxWidth: 260, minHeight: 34 }),
              padding({ horizontal: 10, vertical: 6 }),
              glassEffect({
                glass: { variant: 'clear', interactive: true },
                shape: 'roundedRectangle',
                cornerRadius: 18,
              }),
            ]}
          />
          <Button
            label="Send"
            systemImage="arrow.up"
            onPress={() => alertAction('Send message')}
            modifiers={[
              buttonStyle('glassProminent'),
              labelStyle('iconOnly'),
              controlSize('regular'),
            ]}
          />
        </HStack>
      </GlassEffectContainer>
    </Host>
  );
}

export function GlassBottomActionSheet() {
  const [isPresented, setIsPresented] = useState(false);
  const [sheetSize, setSheetSize] = useState<SheetSize>('medium');

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Bottom action sheet" />;
  }

  return (
    <View>
      <Host style={styles.hostButtonGroup} useViewportSizeMeasurement>
        <HStack spacing={10} modifiers={[padding({ horizontal: 4, vertical: 8 })]}>
          <SheetTrigger
            label="Compact"
            icon="rectangle.bottomthird.inset.filled"
            onPress={() => {
              setSheetSize('compact');
              setIsPresented(true);
            }}
          />
          <SheetTrigger
            label="Medium"
            icon="rectangle.inset.filled"
            onPress={() => {
              setSheetSize('medium');
              setIsPresented(true);
            }}
          />
          <SheetTrigger
            label="Expanded"
            icon="rectangle.portrait.bottomthird.inset.filled"
            prominent
            onPress={() => {
              setSheetSize('expanded');
              setIsPresented(true);
            }}
          />
        </HStack>
      </Host>
      <Host style={styles.sheetHost}>
        <BottomSheet
          isPresented={isPresented}
          onIsPresentedChange={setIsPresented}
          fitToContents
        >
          <Group
            modifiers={[padding({ all: 0 })]}
          >
            <SheetContent size={sheetSize} />
          </Group>
        </BottomSheet>
      </Host>
    </View>
  );
}

function SheetTrigger({
  label,
  icon,
  prominent,
  onPress,
}: {
  label: string;
  icon: ButtonProps['systemImage'];
  prominent?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      label={label}
      systemImage={icon}
      onPress={onPress}
      modifiers={[
        // iOS 26-only: glass button styles render as Liquid Glass on supported builds.
        buttonStyle(prominent ? 'glassProminent' : 'glass'),
        controlSize('regular'),
      ]}
    />
  );
}

function SheetContent({ size }: { size: SheetSize }) {
  const title =
    size === 'compact'
      ? 'Quick action'
      : size === 'medium'
        ? 'Route actions'
        : 'Expanded route panel';

  return (
    <VStack spacing={size === 'compact' ? 10 : 14} modifiers={[padding({ all: 20 })]}>
      <Text modifiers={[font({ size: 20, weight: 'bold' })]}>{title}</Text>
      <Button
        label="Share ETA"
        systemImage="square.and.arrow.up"
        onPress={() => alertAction('Share ETA')}
        modifiers={[buttonStyle('glass')]}
      />
      {size !== 'compact' ? (
        <Button
          label="Mute route alerts"
          systemImage="bell.slash"
          onPress={() => alertAction('Mute route alerts')}
          modifiers={[buttonStyle('glass')]}
        />
      ) : null}
      <Button
        label="Start navigation"
        systemImage="location.north.fill"
        onPress={() => alertAction('Start navigation')}
        modifiers={[buttonStyle('glassProminent'), tint('#0A84FF')]}
      />
      {size === 'expanded' ? (
        <>
          <LabeledContent label="Next stop">
            <Text>Central Station</Text>
          </LabeledContent>
          <LabeledContent label="Crowding">
            <Text>Moderate</Text>
          </LabeledContent>
          <Button
            label="Open full route"
            systemImage="map"
            onPress={() => alertAction('Open full route')}
            modifiers={[buttonStyle('glass')]}
          />
        </>
      ) : null}
    </VStack>
  );
}

export function GlassSettingsControls() {
  const [alerts, setAlerts] = useState(true);
  const [radius, setRadius] = useState(3);
  const [mode, setMode] = useState('eta');

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Settings controls" />;
  }

  return (
    <Host style={styles.hostSettings} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          // iOS 26-only: glassEffect() requires the SwiftUI Liquid Glass APIs.
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Toggle
          label="Smart alerts"
          systemImage="bell.badge"
          isOn={alerts}
          onIsOnChange={setAlerts}
        />
        <LabeledContent label="Alert radius">
          <Text>{radius.toFixed(0)} km</Text>
        </LabeledContent>
        <Slider
          value={radius}
          min={1}
          max={8}
          step={1}
          onValueChange={setRadius}
          minimumValueLabel={<Text>1</Text>}
          maximumValueLabel={<Text>8</Text>}
          modifiers={[tint('#30D158')]}
        />
        <Picker
          label="Priority"
          selection={mode}
          onSelectionChange={setMode}
          modifiers={[pickerStyle('segmented')]}
        >
          <Text modifiers={[tag('eta')]}>ETA</Text>
          <Text modifiers={[tag('nearby')]}>Nearby</Text>
          <Text modifiers={[tag('saved')]}>Saved</Text>
        </Picker>
      </VStack>
    </Host>
  );
}

export function GlassMetricStatusCard() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Metric status card" />;
  }

  return (
    <Host style={styles.hostMetric} useViewportSizeMeasurement>
      <VStack
        spacing={14}
        modifiers={[
          padding({ all: 16 }),
          glassEffect({
            glass: { variant: 'clear', tint: '#0A84FF', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <HStack spacing={10}>
          <Image systemName="bus.fill" size={26} />
          <VStack spacing={2}>
            <Text modifiers={[font({ size: 17, weight: 'bold' })]}>Route 501</Text>
            <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
              4 min away
            </Text>
          </VStack>
        </HStack>
        <Gauge
          value={0.68}
          currentValueLabel={<Text>68%</Text>}
          minimumValueLabel={<Text>Low</Text>}
          maximumValueLabel={<Text>Full</Text>}
          modifiers={[tint('#FF9500')]}
        >
          <Text>Passenger load</Text>
        </Gauge>
        <ProgressView
          value={0.74}
          modifiers={[progressViewStyle('linear'), tint('#30D158')]}
        >
          <Text>ETA confidence</Text>
        </ProgressView>
      </VStack>
    </Host>
  );
}

export function GlassLeaveNowCoach() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Leave-now coach" />;
  }

  return (
    <Host style={styles.hostLeaveNowCoach} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 16 }),
          glassEffect({
            glass: { variant: 'regular', tint: '#30D158', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 24,
          }),
        ]}
      >
        <HStack spacing={12}>
          <Image systemName="figure.walk.motion" size={28} />
          <VStack spacing={2}>
            <Text modifiers={[font({ size: 17, weight: 'bold' })]}>
              Leave-now coach
            </Text>
            <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
              Bus in 7 min · walk is 5 min
            </Text>
          </VStack>
        </HStack>
        <Gauge
          value={0.72}
          currentValueLabel={<Text>2 min</Text>}
          minimumValueLabel={<Text>Late</Text>}
          maximumValueLabel={<Text>Safe</Text>}
          modifiers={[tint('#30D158')]}
        >
          <Text>Walking buffer</Text>
        </Gauge>
        <HStack spacing={8}>
          <CoachStatePill title="Safe" icon="checkmark.circle.fill" color="#30D158" />
          <CoachStatePill title="Leave now" icon="figure.walk" color="#FF9500" emphasized />
          <CoachStatePill title="Too late" icon="xmark.circle" color="#FF453A" />
        </HStack>
        <ControlGroup label="Next action">
          <Button
            label="Start walk"
            systemImage="location.north.line"
            onPress={() => alertAction('Start walk')}
            modifiers={[buttonStyle('glassProminent')]}
          />
          <Button
            label="Track next"
            systemImage="arrow.clockwise"
            onPress={() => alertAction('Track next bus')}
            modifiers={[buttonStyle('glass')]}
          />
        </ControlGroup>
      </VStack>
    </Host>
  );
}

export function GlassStopApproachCoach() {
  const [expanded, setExpanded] = useState(true);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Stop approach coach" />;
  }

  return (
    <Host style={styles.hostStopApproach} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 16 }),
          glassEffect({
            glass: { variant: 'clear', tint: '#0A84FF', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 24,
          }),
        ]}
      >
        <Label title="Approaching your stop" systemImage="bus.fill" />
        <LabeledContent label="Seats likely available">
          <Text>2 min · 310 m</Text>
        </LabeledContent>
        <ProgressView
          value={0.82}
          modifiers={[progressViewStyle('linear'), tint('#0A84FF')]}
        >
          <Text>Along-route progress</Text>
        </ProgressView>
        <HStack spacing={8}>
          <ApproachStatusChip title="Arriving" icon="dot.radiowaves.left.and.right" color="#30D158" active />
          <ApproachStatusChip title="Arrived" icon="door.left.hand.open" color="#0A84FF" />
          <ApproachStatusChip title="Passed" icon="arrow.forward.circle" color="#8E8E93" />
          <ApproachStatusChip title="Stale" icon="wifi.slash" color="#FF9500" />
        </HStack>
        <DisclosureGroup
          label="Live signal details"
          isExpanded={expanded}
          onIsExpandedChange={setExpanded}
        >
          <VStack spacing={8} modifiers={[padding({ top: 8 })]}>
            <LabeledContent label="Vehicle">
              <Text>WVB 5012</Text>
            </LabeledContent>
            <LabeledContent label="Speed">
              <Text>18 km/h</Text>
            </LabeledContent>
            <LabeledContent label="Last ping">
              <Text>12 sec ago</Text>
            </LabeledContent>
          </VStack>
        </DisclosureGroup>
      </VStack>
    </Host>
  );
}

export function GlassSwipeActionRow() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Swipe action row" />;
  }

  return (
    <Host style={styles.hostSwipe} useViewportSizeMeasurement>
      <VStack spacing={10} modifiers={[padding({ all: 12 })]}>
        <SwipeActions>
          <ContextMenu>
            <ContextMenu.Trigger>
              <HStack
                spacing={12}
                modifiers={[
                  padding({ horizontal: 14, vertical: 12 }),
                  glassEffect({
                    glass: { variant: 'regular', interactive: true },
                    shape: 'roundedRectangle',
                    cornerRadius: 18,
                  }),
                ]}
              >
                <Image systemName="clock.badge.checkmark" size={24} />
                <VStack spacing={2}>
                  <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>
                    Station reminder
                  </Text>
                  <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                    Swipe or long press for actions
                  </Text>
                </VStack>
              </HStack>
            </ContextMenu.Trigger>
            <ContextMenu.Items>
              <Button label="Pin" systemImage="pin.fill" onPress={() => alertAction('Pin')} />
              <Button
                label="Archive"
                systemImage="archivebox"
                onPress={() => alertAction('Archive')}
              />
            </ContextMenu.Items>
          </ContextMenu>
          <SwipeActions.Actions edge="leading">
            <Button
              label="Pin"
              systemImage="pin.fill"
              onPress={() => alertAction('Pin')}
              modifiers={[tint('#0A84FF')]}
            />
          </SwipeActions.Actions>
          <SwipeActions.Actions edge="trailing">
            <Button
              label="Done"
              systemImage="checkmark"
              onPress={() => alertAction('Done')}
              modifiers={[tint('#30D158')]}
            />
            <Button
              label="Delete"
              role="destructive"
              systemImage="trash"
              onPress={() => alertAction('Delete')}
            />
          </SwipeActions.Actions>
        </SwipeActions>
        <Section title="Also useful with native lists">
          <Label title="SwipeActions" systemImage="hand.draw" modifiers={[listRowBackground('#00000000')]} />
        </Section>
      </VStack>
    </Host>
  );
}

export function GlassRouteSaveFlow() {
  const [route, setRoute] = useState('501');
  const [stop, setStop] = useState('central');
  const [notify, setNotify] = useState(true);
  const [confirming, setConfirming] = useState(false);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Route save flow" />;
  }

  return (
    <Host style={styles.hostRouteSaveFlow} useViewportSizeMeasurement>
      <Form
        modifiers={[
          padding({ all: 16 }),
          glassEffect({
            glass: { variant: 'regular', tint: '#FF9500', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 24,
          }),
        ]}
      >
        <Section title="Add bus">
          <Picker
            label="Route"
            selection={route}
            onSelectionChange={setRoute}
            modifiers={[pickerStyle('segmented')]}
          >
            <Text modifiers={[tag('501')]}>501</Text>
            <Text modifiers={[tag('612')]}>612</Text>
            <Text modifiers={[tag('88')]}>88</Text>
          </Picker>
          <Picker
            label="Stop"
            selection={stop}
            onSelectionChange={setStop}
          >
            <Text modifiers={[tag('central')]}>Central Station</Text>
            <Text modifiers={[tag('museum')]}>Museum Stop</Text>
            <Text modifiers={[tag('harbor')]}>Harbor Front</Text>
          </Picker>
          <Toggle
            label="Notify when close"
            systemImage="bell.badge"
            isOn={notify}
            onIsOnChange={setNotify}
          />
          <RouteSaveVariant title="Available slot" value="4 of 5 saved" color="#30D158" />
          <RouteSaveVariant title="Already saved" value="501 · Central Station" color="#0A84FF" />
          <RouteSaveVariant title="Limit reached" value="Remove one in Settings" color="#FF453A" />
          <ConfirmationDialog
            title="Save route 501?"
            isPresented={confirming}
            onIsPresentedChange={setConfirming}
          >
            <ConfirmationDialog.Trigger>
              <Button
                label="Save this bus"
                systemImage="plus.circle.fill"
                onPress={() => setConfirming(true)}
                modifiers={[buttonStyle('glassProminent')]}
              />
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Message>
              <Text>This adds the selected route and stop to your tracker.</Text>
            </ConfirmationDialog.Message>
            <ConfirmationDialog.Actions>
              <Button label="Save" onPress={() => alertAction('Save route')} />
              <Button label="Cancel" role="cancel" onPress={() => setConfirming(false)} />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </Section>
      </Form>
    </Host>
  );
}

export function GlassSchedulePicker() {
  const [date, setDate] = useState(() => {
    const next = new Date();
    next.setMinutes(next.getMinutes() + 18);
    return next;
  });

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Schedule picker" />;
  }

  return (
    <Host style={styles.hostSchedule} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          // iOS 26-only: glassEffect() renders as Liquid Glass on supported builds.
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <LabeledContent label="Reminder">
          <Text>{formatTime(date)}</Text>
        </LabeledContent>
        <DatePicker
          title="Notify me"
          selection={date}
          displayedComponents={['date', 'hourAndMinute']}
          onDateChange={setDate}
        />
        <Button
          label="Save reminder"
          systemImage="calendar.badge.plus"
          onPress={() => alertAction('Save reminder')}
          modifiers={[buttonStyle('glassProminent')]}
        />
      </VStack>
    </Host>
  );
}

export function GlassThemeColorPicker() {
  const [color, setColor] = useState('#0A84FF');
  const [tone, setTone] = useState('accent');

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Theme color picker" />;
  }

  return (
    <Host style={styles.hostTheme} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'clear', tint: color, interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <ColorPicker
          label="Accent color"
          selection={color}
          onSelectionChange={setColor}
          supportsOpacity={false}
        />
        <Picker
          label="Theme tone"
          selection={tone}
          onSelectionChange={setTone}
          modifiers={[pickerStyle('segmented')]}
        >
          <Text modifiers={[tag('accent')]}>Accent</Text>
          <Text modifiers={[tag('calm')]}>Calm</Text>
          <Text modifiers={[tag('urgent')]}>Urgent</Text>
        </Picker>
        <LabeledContent label="Selected">
          <Text>{color}</Text>
        </LabeledContent>
      </VStack>
    </Host>
  );
}

export function GlassConfirmationAction() {
  const [isPresented, setIsPresented] = useState(false);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Confirmation action" />;
  }

  return (
    <Host style={styles.hostConfirmation} useViewportSizeMeasurement>
      <ConfirmationDialog
        title="Clear saved route?"
        isPresented={isPresented}
        onIsPresentedChange={setIsPresented}
      >
        <ConfirmationDialog.Trigger>
          <Button
            label="Clear saved route"
            systemImage="trash"
            onPress={() => setIsPresented(true)}
            modifiers={[
              // iOS 26-only: glass button styles render as Liquid Glass on supported builds.
              buttonStyle('glass'),
              tint('#FF453A'),
            ]}
          />
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Message>
          <Text>This removes the route from quick access.</Text>
        </ConfirmationDialog.Message>
        <ConfirmationDialog.Actions>
          <Button
            label="Clear Route"
            role="destructive"
            onPress={() => alertAction('Clear route')}
          />
          <Button label="Cancel" role="cancel" onPress={() => setIsPresented(false)} />
        </ConfirmationDialog.Actions>
      </ConfirmationDialog>
    </Host>
  );
}

export function GlassTripDetailsDisclosure() {
  const [isExpanded, setIsExpanded] = useState(false);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Trip details disclosure" />;
  }

  return (
    <Host style={styles.hostDisclosure} useViewportSizeMeasurement>
      <VStack
        spacing={10}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <DisclosureGroup
          label="Trip details"
          isExpanded={isExpanded}
          onIsExpandedChange={setIsExpanded}
        >
          <VStack spacing={8} modifiers={[padding({ top: 8 })]}>
            <Label title="Central Station" systemImage="mappin.and.ellipse" />
            <Label title="Platform B" systemImage="tram.fill" />
            <Label title="Arrives in 4 min" systemImage="clock" />
          </VStack>
        </DisclosureGroup>
      </VStack>
    </Host>
  );
}

export function GlassQuickControlGroup() {
  const [passengers, setPassengers] = useState(1);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Quick control group" />;
  }

  return (
    <Host style={styles.hostControlGroup} useViewportSizeMeasurement>
      <VStack spacing={12} modifiers={[padding({ all: 12 })]}>
        <ControlGroup
          label="Trip tools"
          systemImage="slider.horizontal.3"
          modifiers={[
            // iOS 26-only: glassEffect() gives the compact controls Liquid Glass chrome.
            glassEffect({
              glass: { variant: 'clear', interactive: true },
              shape: 'capsule',
            }),
          ]}
        >
          <Button
            label="Favorite"
            systemImage="star"
            onPress={() => alertAction('Favorite')}
            modifiers={[buttonStyle('glass'), labelStyle('iconOnly')]}
          />
          <Button
            label="Share"
            systemImage="square.and.arrow.up"
            onPress={() => alertAction('Share')}
            modifiers={[buttonStyle('glass'), labelStyle('iconOnly')]}
          />
          <Button
            label="Navigate"
            systemImage="location.north"
            onPress={() => alertAction('Navigate')}
            modifiers={[buttonStyle('glassProminent'), labelStyle('iconOnly')]}
          />
        </ControlGroup>
        <Stepper
          label={`Passengers: ${passengers}`}
          value={passengers}
          min={1}
          max={6}
          step={1}
          onValueChange={setPassengers}
        />
      </VStack>
    </Host>
  );
}

export function GlassAlertBanner() {
  const [isPresented, setIsPresented] = useState(false);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Alert banner" />;
  }

  return (
    <Host style={styles.hostAlert} useViewportSizeMeasurement>
      <SwiftUIAlert
        title="Route delayed"
        isPresented={isPresented}
        onIsPresentedChange={setIsPresented}
      >
        <SwiftUIAlert.Trigger>
          <Button
            label="Show route alert"
            systemImage="exclamationmark.triangle"
            onPress={() => setIsPresented(true)}
            modifiers={[
              // iOS 26-only: glass button styles render as Liquid Glass on supported builds.
              buttonStyle('glassProminent'),
              tint('#FF9500'),
            ]}
          />
        </SwiftUIAlert.Trigger>
        <SwiftUIAlert.Message>
          <Text>The next bus is running 6 minutes late.</Text>
        </SwiftUIAlert.Message>
        <SwiftUIAlert.Actions>
          <Button label="OK" role="cancel" onPress={() => setIsPresented(false)} />
        </SwiftUIAlert.Actions>
      </SwiftUIAlert>
    </Host>
  );
}

export function GlassPopoverTip() {
  const [isPresented, setIsPresented] = useState(false);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Popover tip" />;
  }

  return (
    <Host style={styles.hostPopover} useViewportSizeMeasurement>
      <Popover
        isPresented={isPresented}
        onIsPresentedChange={setIsPresented}
        attachmentAnchor="top"
        arrowEdge="bottom"
      >
        <Popover.Trigger>
          <Button
            label="Show stop tip"
            systemImage="info.circle"
            onPress={() => setIsPresented(true)}
            modifiers={[buttonStyle('glass')]}
          />
        </Popover.Trigger>
        <Popover.Content>
          <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
            <Text modifiers={[font({ size: 17, weight: 'bold' })]}>Boarding tip</Text>
            <Text>Use the north entrance for the shortest walk.</Text>
          </VStack>
        </Popover.Content>
      </Popover>
    </Host>
  );
}

export function GlassSecureInput() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Secure input" />;
  }

  return (
    <Host style={styles.hostSecureInput} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>Protected route</Text>
        <SecureField
          placeholder="Access code"
          maxLength={8}
          modifiers={[frame({ minHeight: 38 }), padding({ horizontal: 10, vertical: 6 })]}
        />
        <Button
          label="Unlock"
          systemImage="lock.open"
          onPress={() => alertAction('Unlock')}
          modifiers={[buttonStyle('glassProminent')]}
        />
      </VStack>
    </Host>
  );
}

export function GlassShareCard() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Share card" />;
  }

  return (
    <Host style={styles.hostShare} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'clear', tint: '#0A84FF', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Label title="Route 501 ETA" systemImage="bus.fill" />
        <Text>Central Station in 4 minutes</Text>
        <ShareLink
          item="https://expo.dev"
          subject="Route 501 ETA"
          message="Route 501 arrives at Central Station in 4 minutes."
          modifiers={[buttonStyle('glassProminent')]}
        >
          <Text>Share ETA</Text>
        </ShareLink>
      </VStack>
    </Host>
  );
}

export function GlassEmptyState() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Empty state" />;
  }

  return (
    <Host style={styles.hostEmptyState} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 12 }),
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <ContentUnavailableView
          title="No saved routes"
          systemImage="tray"
          description="Save a route to see it here."
        />
        <Button
          label="Browse routes"
          systemImage="magnifyingglass"
          onPress={() => alertAction('Browse routes')}
          modifiers={[buttonStyle('glass')]}
        />
      </VStack>
    </Host>
  );
}

export function GlassFilterForm() {
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState('eta');

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Filter form" />;
  }

  return (
    <Host style={styles.hostFilterForm} useViewportSizeMeasurement>
      <Form
        modifiers={[
          glassEffect({
            glass: { variant: 'clear', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Section title="Route filters">
          <Toggle
            label="Favorites only"
            systemImage="star"
            isOn={favoritesOnly}
            onIsOnChange={setFavoritesOnly}
          />
          <Picker
            label="Sort"
            selection={sort}
            onSelectionChange={setSort}
            modifiers={[pickerStyle('segmented')]}
          >
            <Text modifiers={[tag('eta')]}>ETA</Text>
            <Text modifiers={[tag('load')]}>Load</Text>
            <Text modifiers={[tag('name')]}>Name</Text>
          </Picker>
        </Section>
      </Form>
    </Host>
  );
}

export function GlassChartCard() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Chart card" />;
  }

  return (
    <Host style={styles.hostChart} useViewportSizeMeasurement>
      <VStack
        spacing={10}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>Boardings by hour</Text>
        <Chart
          data={[
            { x: '8', y: 42 },
            { x: '9', y: 58 },
            { x: '10', y: 35 },
            { x: '11', y: 46 },
          ]}
          type="bar"
          showGrid
          barStyle={{ cornerRadius: 6 }}
          modifiers={[frame({ height: 132 })]}
        />
      </VStack>
    </Host>
  );
}

export function GlassTabPreview() {
  const [selection, setSelection] = useState('eta');

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Tab preview" />;
  }

  return (
    <Host style={styles.hostTabPreview} useViewportSizeMeasurement>
      <TabView selection={selection} onSelectionChange={setSelection}>
        <TabView.Tab value="eta" label="ETA" systemImage="clock">
          <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
            <Text modifiers={[font({ size: 20, weight: 'bold' })]}>4 min</Text>
            <Text>Next arrival</Text>
          </VStack>
        </TabView.Tab>
        <TabView.Tab value="load" label="Load" systemImage="person.3">
          <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
            <Text modifiers={[font({ size: 20, weight: 'bold' })]}>Moderate</Text>
            <Text>Passenger load</Text>
          </VStack>
        </TabView.Tab>
      </TabView>
    </Host>
  );
}

export function GlassGridLauncher() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Grid launcher" />;
  }

  return (
    <Host style={styles.hostGrid} useViewportSizeMeasurement>
      <Grid horizontalSpacing={12} verticalSpacing={12} modifiers={[padding({ all: 14 })]}>
        <Grid.Row>
          <GridTile icon="bus.fill" title="Tracker" />
          <GridTile icon="map.fill" title="Map" />
        </Grid.Row>
        <Grid.Row>
          <GridTile icon="bell.fill" title="Alerts" />
          <GridTile icon="gear" title="Settings" />
        </Grid.Row>
      </Grid>
    </Host>
  );
}

export function GlassNativeLinkCard() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Native link card" />;
  }

  return (
    <Host style={styles.hostNativeLink} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'clear', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>Transit help</Text>
        <SwiftUILink destination="https://expo.dev">
          <HStack spacing={8}>
            <Image systemName="safari" size={18} />
            <Text>Open native link</Text>
          </HStack>
        </SwiftUILink>
      </VStack>
    </Host>
  );
}

export function GlassProgressChecklist() {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(false);
  const progress = first && second ? 1 : first || second ? 0.5 : 0;

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Progress checklist" />;
  }

  return (
    <Host style={styles.hostChecklist} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'regular', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <ProgressView value={progress} modifiers={[progressViewStyle('linear')]}>
          <Text>Trip setup</Text>
        </ProgressView>
        <Toggle label="Choose route" isOn={first} onIsOnChange={setFirst} />
        <Toggle label="Enable alerts" isOn={second} onIsOnChange={setSecond} />
      </VStack>
    </Host>
  );
}

export function GlassStepperPanel() {
  const [stops, setStops] = useState(3);

  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Stepper panel" />;
  }

  return (
    <Host style={styles.hostStepperPanel} useViewportSizeMeasurement>
      <VStack
        spacing={12}
        modifiers={[
          padding({ all: 14 }),
          glassEffect({
            glass: { variant: 'clear', interactive: true },
            shape: 'roundedRectangle',
            cornerRadius: 22,
          }),
        ]}
      >
        <LabeledContent label="Stops ahead">
          <Text>{stops}</Text>
        </LabeledContent>
        <Stepper
          label="Stops"
          value={stops}
          min={1}
          max={12}
          step={1}
          onValueChange={setStops}
        />
      </VStack>
    </Host>
  );
}

export function GlassScrollShelf() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Scroll shelf" />;
  }

  return (
    <Host style={styles.hostScrollShelf} useViewportSizeMeasurement>
      <SwiftUIScrollView axes="horizontal" showsIndicators={false}>
        <LazyHStack
          spacing={12}
          modifiers={[padding({ horizontal: 14, vertical: 12 }), scrollIndicators('hidden')]}
        >
          <ShelfChip icon="bus.fill" title="501" />
          <ShelfChip icon="tram.fill" title="Blue" />
          <ShelfChip icon="ferry.fill" title="Harbor" />
          <ShelfChip icon="figure.walk" title="Walk" />
        </LazyHStack>
      </SwiftUIScrollView>
    </Host>
  );
}

export function GlassContextMenuCard() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Context menu card" />;
  }

  return (
    <Host style={styles.hostContextMenu} useViewportSizeMeasurement>
      <ContextMenu>
        <ContextMenu.Trigger>
          <VStack
            spacing={8}
            modifiers={[
              padding({ all: 16 }),
              glassEffect({
                glass: { variant: 'regular', interactive: true },
                shape: 'roundedRectangle',
                cornerRadius: 22,
              }),
            ]}
          >
            <Label title="Long press route" systemImage="hand.tap" />
            <Text>Open native context actions.</Text>
          </VStack>
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          <Button label="Pin" systemImage="pin" onPress={() => alertAction('Pin')} />
          <Button label="Share" systemImage="square.and.arrow.up" onPress={() => alertAction('Share')} />
          <Button label="Remove" role="destructive" systemImage="trash" onPress={() => alertAction('Remove')} />
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

export function GlassCompactMenuBar() {
  if (Platform.OS !== 'ios') {
    return <FallbackCard title="Compact menu bar" />;
  }

  return (
    <Host style={styles.hostMenuBar} useViewportSizeMeasurement>
      <ControlGroup
        label="Route commands"
        modifiers={[
          padding({ all: 12 }),
          glassEffect({
            glass: { variant: 'clear', interactive: true },
            shape: 'capsule',
          }),
        ]}
      >
        <Menu
          label="More"
          systemImage="ellipsis"
          modifiers={[buttonStyle('glass'), labelStyle('iconOnly')]}
        >
          <Button label="Refresh" systemImage="arrow.clockwise" onPress={() => alertAction('Refresh')} />
          <Button label="Report issue" systemImage="exclamationmark.bubble" onPress={() => alertAction('Report issue')} />
        </Menu>
        <Button
          label="Favorite"
          systemImage="star"
          onPress={() => alertAction('Favorite')}
          modifiers={[buttonStyle('glass'), labelStyle('iconOnly')]}
        />
        <Button
          label="Go"
          systemImage="arrow.up.right"
          onPress={() => alertAction('Go')}
          modifiers={[buttonStyle('glassProminent'), labelStyle('iconOnly')]}
        />
      </ControlGroup>
    </Host>
  );
}

function FallbackCard({ title }: { title: string }) {
  return (
    <DemoCard title={title}>
      <InfoText>
        This reusable example uses @expo/ui SwiftUI components on iOS. Android,
        web, and older unsupported environments can render a React Native
        fallback instead.
      </InfoText>
    </DemoCard>
  );
}

function GridTile({
  icon,
  title,
}: {
  icon: ButtonProps['systemImage'];
  title: string;
}) {
  return (
    <VStack
      spacing={8}
      modifiers={[
        frame({ width: 112, height: 76 }),
        padding({ all: 10 }),
        glassEffect({
          glass: { variant: 'regular', interactive: true },
          shape: 'roundedRectangle',
          cornerRadius: 18,
        }),
      ]}
    >
      <Image systemName={icon} size={24} />
      <Text>{title}</Text>
    </VStack>
  );
}

function ShelfChip({
  icon,
  title,
}: {
  icon: ButtonProps['systemImage'];
  title: string;
}) {
  return (
    <HStack
      spacing={8}
      modifiers={[
        padding({ horizontal: 14, vertical: 10 }),
        glassEffect({
          glass: { variant: 'regular', interactive: true },
          shape: 'capsule',
        }),
      ]}
    >
      <Image systemName={icon} size={18} />
      <Text>{title}</Text>
    </HStack>
  );
}

function CoachStatePill({
  title,
  icon,
  color,
  emphasized,
}: {
  title: string;
  icon: ButtonProps['systemImage'];
  color: string;
  emphasized?: boolean;
}) {
  return (
    <VStack
      spacing={4}
      modifiers={[
        frame({ width: 86, height: 54 }),
        padding({ all: 8 }),
        opacity(emphasized ? 1 : 0.74),
        glassEffect({
          glass: { variant: emphasized ? 'regular' : 'clear', tint: color, interactive: true },
          shape: 'roundedRectangle',
          cornerRadius: 16,
        }),
      ]}
    >
      <Image systemName={icon} size={18} modifiers={[foregroundStyle(color)]} />
      <Text modifiers={[font({ size: 11, weight: 'semibold' })]}>{title}</Text>
    </VStack>
  );
}

function ApproachStatusChip({
  title,
  icon,
  color,
  active,
}: {
  title: string;
  icon: ButtonProps['systemImage'];
  color: string;
  active?: boolean;
}) {
  return (
    <VStack
      spacing={4}
      modifiers={[
        frame({ width: 64, height: 50 }),
        padding({ all: 7 }),
        opacity(active ? 1 : 0.66),
        glassEffect({
          glass: { variant: active ? 'regular' : 'clear', tint: color, interactive: true },
          shape: 'roundedRectangle',
          cornerRadius: 15,
        }),
      ]}
    >
      <Image systemName={icon} size={16} modifiers={[foregroundStyle(color)]} />
      <Text modifiers={[font({ size: 10, weight: 'semibold' })]}>{title}</Text>
    </VStack>
  );
}

function RouteSaveVariant({
  title,
  value,
  color,
}: {
  title: string;
  value: string;
  color: string;
}) {
  return (
    <HStack
      spacing={10}
      modifiers={[
        padding({ horizontal: 12, vertical: 9 }),
        glassEffect({
          glass: { variant: 'clear', tint: color, interactive: true },
          shape: 'roundedRectangle',
          cornerRadius: 14,
        }),
      ]}
    >
      <Image systemName="circle.fill" size={8} modifiers={[foregroundStyle(color)]} />
      <VStack spacing={1}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>{title}</Text>
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          {value}
        </Text>
      </VStack>
    </HStack>
  );
}

function TimelineRow({
  time,
  title,
  subtitle,
  active,
}: {
  time: string;
  title: string;
  subtitle: string;
  active?: boolean;
}) {
  return (
    <HStack spacing={12}>
      <VStack spacing={4} modifiers={[frame({ width: 52 })]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' })]}>{time}</Text>
        <Image
          systemName={active ? 'circle.fill' : 'circle'}
          size={10}
          modifiers={[foregroundStyle(active ? '#FF9500' : '#8E8E93')]}
        />
      </VStack>
      <VStack spacing={3}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{title}</Text>
        <Text
        modifiers={[
          foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          opacity(active ? 1 : 0.78),
        ]}
      >
          {subtitle}
        </Text>
      </VStack>
    </HStack>
  );
}

function alertAction(action: string) {
  RNAlert.alert('Liquid Glass demo', action);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function RNComposerFallbackPreview() {
  return (
    <View style={styles.rnComposer}>
      <Pressable style={styles.rnIconButton}>
        <InfoText>+</InfoText>
      </Pressable>
      <View style={styles.rnInput}>
        <InfoText>Message</InfoText>
      </View>
      <Pressable style={styles.rnSendButton}>
        <InfoText>Send</InfoText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hostComposer: {
    height: 68,
  },
  hostButtonGroup: {
    height: 64,
  },
  sheetHost: {
    height: 1,
  },
  hostSettings: {
    height: 238,
  },
  hostMetric: {
    height: 226,
  },
  hostLeaveNowCoach: {
    height: 266,
  },
  hostStopApproach: {
    height: 318,
  },
  hostSwipe: {
    height: 178,
  },
  hostSchedule: {
    height: 190,
  },
  hostTheme: {
    height: 172,
  },
  hostConfirmation: {
    height: 76,
  },
  hostDisclosure: {
    height: 154,
  },
  hostControlGroup: {
    height: 142,
  },
  hostAlert: {
    height: 76,
  },
  hostPopover: {
    height: 76,
  },
  hostSecureInput: {
    height: 174,
  },
  hostShare: {
    height: 152,
  },
  hostEmptyState: {
    height: 214,
  },
  hostFilterForm: {
    height: 190,
  },
  hostChart: {
    height: 230,
  },
  hostTabPreview: {
    height: 190,
  },
  hostGrid: {
    height: 190,
  },
  hostNativeLink: {
    height: 132,
  },
  hostChecklist: {
    height: 184,
  },
  hostStepperPanel: {
    height: 128,
  },
  hostScrollShelf: {
    height: 88,
  },
  hostContextMenu: {
    height: 128,
  },
  hostRouteSaveFlow: {
    height: 420,
  },
  hostMenuBar: {
    height: 86,
  },
  rnComposer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  rnIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: demoColors.grouped,
  },
  rnInput: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
    backgroundColor: demoColors.grouped,
  },
  rnSendButton: {
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
    backgroundColor: demoColors.grouped,
  },
});
