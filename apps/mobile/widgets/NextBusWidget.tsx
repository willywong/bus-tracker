import {
  AccessoryWidgetBackground,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  background,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  shapes,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type Widget, type WidgetEnvironment } from 'expo-widgets';
import { Platform } from 'react-native';

import {
  EMPTY_WIDGET_PROPS,
  buildNextBusTimeline,
  nextBusTimelineKey,
  type NextBusSnapshot,
  type NextBusWidgetProps,
} from './nextBusTimeline';

export type { NextBusSnapshot, NextBusWidgetProps } from './nextBusTimeline';

/** Must match the `name` of the widget entry in app.json's `expo-widgets` plugin config. */
export const NEXT_BUS_WIDGET_NAME = 'NextBusWidget';

/**
 * "Next bus" Home Screen + Lock Screen widget.
 *
 *   systemSmall          route badge · stop · ticking countdown · "Then 09:12" · live/scheduled · Updated
 *   systemMedium         same on the left, the next three clock times on the right
 *   accessoryCircular    route + ticking countdown (clock time when ≥ 1 h away)
 *   accessoryRectangular glyph "T816 · 08:42" · countdown · stop / then
 *   accessoryInline      "T816 · 08:42"
 *
 * The countdown is SwiftUI `Text(timerInterval:)`, so it ticks with no
 * timeline reloads. Timeline entries (see nextBusTimeline.ts) move the hero to
 * the next bus as each one leaves.
 *
 * IMPORTANT: babel-preset-expo serializes this function to a string at build
 * time ('widget' directive). Only the @expo/ui/swift-ui components +
 * modifiers, React / jsx-runtime and JS built-ins exist when the extension
 * evaluates it, so every helper and constant below must stay INSIDE the
 * function. Module-scope references are `undefined` at widget runtime.
 */
const NextBusWidget = (
  props: NextBusWidgetProps,
  environment: WidgetEnvironment,
) => {
  'widget';

  // --- Palette (inlined) ----------------------------------------------------
  // Calm Mono: ink on paper, green only for "live".
  const liveGreen = '#30D158';

  const family = environment.widgetFamily ?? 'systemSmall';
  const fullColor = (environment.widgetRenderingMode ?? 'fullColor') === 'fullColor';
  const dimmed = environment.isLuminanceReduced === true;
  const dark = environment.colorScheme === 'dark';
  const ink = dark ? '#F5F5F7' : '#111114';
  const paper = dark ? '#0E0E10' : '#FFFFFF';
  const at = environment.date ? environment.date.getTime() : Date.now();

  // Asia/Kuala_Lumpur is UTC+8 with no DST: plain arithmetic, no Intl needed
  // in the extension's JSContext.
  const clock = (ms: number) => {
    const d = new Date(ms + 8 * 3600000);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
  };

  const state = props.state ?? 'empty';
  const routeCode = props.routeCode ?? '';
  const stopName = props.stopName ?? '';
  const departures = (props.departures ?? []).filter((d) => d && d.epochMs > at);
  const next = state === 'service' && departures.length > 0 ? departures[0] : null;
  const following = next ? departures.slice(1) : [];
  const isLive = next != null && next.live === true;
  const withinCountdown = next != null && next.epochMs - at <= 60 * 60000;
  const nextClock = next ? clock(next.epochMs) : '';
  const updatedText = props.updatedAtMs > 0 ? `Updated ${clock(props.updatedAtMs)}` : '';
  const firstBusText = props.firstBusMs > 0 ? `First bus ${clock(props.firstBusMs)}` : '';

  // Colour only reinforces glyph + word; in tinted / clear / Lock Screen
  // modes everything falls back to hierarchical styles the system can tint.
  const primary = { type: 'hierarchical', style: 'primary' } as const;
  const secondary = { type: 'hierarchical', style: 'secondary' } as const;
  const tertiary = { type: 'hierarchical', style: 'tertiary' } as const;
  const statusIcon = isLive ? 'dot.radiowaves.left.and.right' : 'clock';
  const statusWord = isLive ? 'Live' : 'Scheduled';
  const statusTint = isLive && fullColor && !dimmed ? liveGreen : secondary;

  // Hero: ticking countdown under an hour, clock time beyond.
  const hero = (size: number, align: 'leading' | 'center') =>
    next == null ? null : withinCountdown ? (
      <Text
        timerInterval={{ lower: new Date(Math.min(at, next.epochMs)), upper: new Date(next.epochMs) }}
        countsDown
        modifiers={[
          font({ size, weight: 'light' }),
          monospacedDigit(),
          multilineTextAlignment(align),
          foregroundStyle(primary),
          lineLimit(1),
          minimumScaleFactor(0.6),
        ]}
      />
    ) : (
      <Text
        modifiers={[
          font({ size, weight: 'semibold'}),
          monospacedDigit(),
          multilineTextAlignment(align),
          foregroundStyle(primary),
          lineLimit(1),
          minimumScaleFactor(0.6),
        ]}
      >
        {nextClock}
      </Text>
    );

  const badge = (size: number) => (
    <Text
      modifiers={[
        font({ size, weight: 'semibold' }),
        monospacedDigit(),
        foregroundStyle(fullColor && !dimmed ? paper : primary),
        padding({ horizontal: size * 0.5, vertical: size * 0.2 }),
        background(
          fullColor && !dimmed ? ink : { type: 'hierarchical', style: 'quaternary' },
          shapes.roundedRectangle({ cornerRadius: size * 0.4 }),
        ),
        lineLimit(1),
      ]}
    >
      {routeCode}
    </Text>
  );

  const statusRow = (size: number) => (
    <HStack spacing={4}>
      <Image systemName={statusIcon} size={size} modifiers={[foregroundStyle(statusTint)]} />
      <Text
        modifiers={[
          font({ size: size + 1, weight: isLive ? 'semibold' : 'medium' }),
          foregroundStyle(isLive ? primary : secondary),
          lineLimit(1),
        ]}
      >
        {statusWord}
      </Text>
    </HStack>
  );

  const caption = (text: string, size: number, style: typeof secondary | typeof tertiary) => (
    <Text modifiers={[font({ size }), monospacedDigit(), foregroundStyle(style), lineLimit(1)]}>
      {text}
    </Text>
  );

  // A message state (empty / ended / stale) for the system families.
  const message = (icon: string, title: string, detail: string) => (
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' })]}>
      {routeCode ? (
        <HStack spacing={6}>
          {badge(12)}
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{stopName}</Text>
        </HStack>
      ) : null}
      <Spacer />
      <Image systemName={icon as 'moon.zzz'} size={22} modifiers={[foregroundStyle(secondary)]} />
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), lineLimit(3)]}>{title}</Text>
      {detail ? caption(detail, 13, secondary) : null}
    </VStack>
  );

  const messageFor = () => {
    if (state === 'ended') return message('moon.zzz', 'No more buses today', firstBusText);
    if (state === 'stale') return message('arrow.clockwise', 'Open BusBuddy for later buses', updatedText);
    return message('bus', 'Open BusBuddy to choose a route', '');
  };

  const systemBackground = fullColor ? paper : 'clear';
  const systemRoot = (content: ReturnType<typeof messageFor>) => (
    <VStack
      alignment="leading"
      modifiers={[
        frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' }),
        containerBackground(systemBackground, 'widget'),
        widgetURL('t816://'),
      ]}
    >
      {content}
    </VStack>
  );
  const accessoryRoot = (content: ReturnType<typeof messageFor>) => (
    <ZStack modifiers={[containerBackground('clear', 'widget'), widgetURL('t816://')]}>
      {content}
    </ZStack>
  );

  // --- Lock Screen ------------------------------------------------------------
  if (family === 'accessoryInline') {
    let line = 'BusBuddy · Choose a route';
    if (next) line = `${routeCode} · ${nextClock}`;
    else if (state === 'ended') line = firstBusText ? `${routeCode} · ${firstBusText}` : `${routeCode} · No more buses`;
    else if (state === 'stale') line = `${routeCode} · Open BusBuddy`;
    return (
      <Text modifiers={[containerBackground('clear', 'widget'), widgetURL('t816://')]}>{line}</Text>
    );
  }

  if (family === 'accessoryCircular') {
    let body;
    if (next) {
      body = (
        <VStack spacing={0}>
          <Text modifiers={[font({ size: 11, weight: 'bold'}), lineLimit(1), minimumScaleFactor(0.6)]}>
            {routeCode}
          </Text>
          {hero(withinCountdown ? 15 : 16, 'center')}
          <Image systemName={statusIcon} size={9} modifiers={[foregroundStyle(secondary)]} />
        </VStack>
      );
    } else {
      body = (
        <VStack spacing={1}>
          <Image systemName={state === 'ended' ? 'moon.zzz' : 'bus'} size={15} />
          {state === 'ended' && props.firstBusMs > 0 ? (
            <Text modifiers={[font({ size: 12, weight: 'semibold'}), monospacedDigit()]}>
              {clock(props.firstBusMs)}
            </Text>
          ) : null}
        </VStack>
      );
    }
    return accessoryRoot(
      <ZStack>
        <AccessoryWidgetBackground />
        <VStack modifiers={[padding({ horizontal: 4 })]}>{body}</VStack>
      </ZStack>,
    );
  }

  if (family === 'accessoryRectangular') {
    if (!next) {
      const title = state === 'ended' ? 'No more buses today' : state === 'stale' ? 'Open BusBuddy for later buses' : 'Open BusBuddy to choose a route';
      return accessoryRoot(
        <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: 10000, alignment: 'leading' })]}>
          {routeCode ? (
            <Text modifiers={[font({ size: 15, weight: 'bold'}), lineLimit(1)]}>{routeCode}</Text>
          ) : null}
          <Text modifiers={[font({ size: 13, weight: 'medium' }), lineLimit(2)]}>{title}</Text>
          {state === 'ended' && firstBusText ? caption(firstBusText, 12, secondary) : null}
        </VStack>,
      );
    }
    return accessoryRoot(
      <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: 10000, alignment: 'leading' })]}>
        <HStack spacing={4}>
          <Image systemName={statusIcon} size={11} />
          <Text modifiers={[font({ size: 15, weight: 'bold'}), monospacedDigit(), lineLimit(1)]}>
            {`${routeCode} · ${nextClock}`}
          </Text>
        </HStack>
        {withinCountdown ? hero(22, 'leading') : caption(stopName, 13, secondary)}
        {following.length > 0
          ? caption(`Then ${clock(following[0].epochMs)}`, 12, secondary)
          : props.isLastBus
            ? caption('Last bus today', 12, secondary)
            : withinCountdown
              ? caption(stopName, 12, secondary)
              : null}
      </VStack>,
    );
  }

  // --- Home Screen ------------------------------------------------------------
  if (!next) return systemRoot(messageFor());

  const header = (
    <HStack spacing={6}>
      {badge(12)}
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{stopName}</Text>
    </HStack>
  );

  if (family === 'systemMedium' || family === 'systemLarge' || family === 'systemExtraLarge') {
    const rows = following.slice(0, 3);
    return systemRoot(
      <HStack spacing={16} alignment="top">
        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' })]}>
          {header}
          <Spacer />
          {caption(withinCountdown ? 'Next bus in' : 'Next bus at', 12, secondary)}
          {hero(40, 'leading')}
          {statusRow(11)}
        </VStack>
        <VStack alignment="leading" spacing={6} modifiers={[frame({ maxHeight: 10000, alignment: 'topLeading' })]}>
          {caption('Then', 12, secondary)}
          {rows.length > 0
            ? rows.map((d) => (
                <HStack key={`dep-${d.epochMs}`} spacing={5}>
                  <Image systemName="clock" size={11} modifiers={[foregroundStyle(tertiary)]} />
                  <Text modifiers={[font({ size: 17, weight: 'semibold'}), monospacedDigit(), lineLimit(1)]}>
                    {clock(d.epochMs)}
                  </Text>
                </HStack>
              ))
            : props.isLastBus
              ? caption('Last bus today', 13, secondary)
              : null}
          <Spacer />
          {updatedText ? caption(updatedText, 11, tertiary) : null}
        </VStack>
      </HStack>,
    );
  }

  // systemSmall (default)
  return systemRoot(
    <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' })]}>
      {header}
      <Spacer />
      {hero(34, 'leading')}
      {following.length > 0
        ? caption(`Then ${following.slice(0, 2).map((d) => clock(d.epochMs)).join(' · ')}`, 12, secondary)
        : props.isLastBus
          ? caption('Last bus today', 12, secondary)
          : null}
      <Spacer />
      {statusRow(10)}
      {updatedText ? caption(updatedText, 10, tertiary) : null}
    </VStack>,
  );
};

let widget: Widget<NextBusWidgetProps> | null = null;
try {
  // Registers the layout with the extension (stored in the App Group). Also
  // evaluated at build time by expo-widgets' layout registry (`ios.initialLayout`),
  // which renders EMPTY_WIDGET_PROPS before the app has ever run.
  widget = createWidget<NextBusWidgetProps>(NEXT_BUS_WIDGET_NAME, NextBusWidget, EMPTY_WIDGET_PROPS);
} catch (err) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[widget] createWidget failed', err);
}

export default widget;

/** Skip reloads unless the content changed, or the "Updated" line is this old. */
const FORCE_REFRESH_MS = 15 * 60_000;
let lastKey: string | null = null;
let lastPushAt = 0;

/**
 * Write the "Next bus" timeline for the widget. Call it whenever the
 * favourite route / stop or its departures change (and on app foreground).
 * Cheap to call often: unchanged departures are skipped (except every
 * {@link FORCE_REFRESH_MS} so "Updated hh:mm" stays honest), which keeps
 * WidgetKit's reload budget for real changes. Never throws.
 */
export function syncNextBusWidget(snapshot: NextBusSnapshot, now: number = Date.now()): void {
  if (Platform.OS !== 'ios' || widget == null) return;
  try {
    const key = nextBusTimelineKey(snapshot);
    if (key === lastKey && now - lastPushAt < FORCE_REFRESH_MS) return;
    widget.updateTimeline(buildNextBusTimeline(snapshot, now));
    lastKey = key;
    lastPushAt = now;
  } catch (err) {
    if (__DEV__) console.warn('[widget] updateTimeline failed', err);
  }
}
