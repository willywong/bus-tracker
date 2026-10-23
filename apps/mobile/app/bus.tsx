import { Button, Host, Image as SwiftImage } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import {
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bus3D } from '@/components/detail/Bus3D';
import { BUS_SPECS, formatPlate } from '@/components/detail/busSpec';
import { BusStatus } from '@/components/detail/BusStatus';
import { fareFor } from '@/components/detail/fares';
import { formatClockHHMM } from '@/components/tracker/logic';
import { NextStopsLine } from '@/components/trip/OnTheWay';
import { Hairline, InfoRow, NoteRow, ROW_ICON_INSET } from '@/components/trip/Rows';
import { Section } from '@/components/trip/SheetBody';
import { RouteBadge } from '@/components/trip/SheetHeader';
import { useBusDetail } from '@/hooks/useMapDetail';
import { useNextStops } from '@/hooks/useNextStops';
import type { BusKind } from '@/modules/bus-model';
import { useTrip } from '@/state/TripContext';
import { color, hex, MARGIN, pick, space, type } from '@/theme/design';

/** The bus takes a little over two fifths of the screen; the rest scrolls below. */
const STAGE_SHARE = 0.44;
/** A large glass circle button's height. */
const CLOSE_SIZE = 48;

/**
 * The sheet's 3D bus, zoomed open full screen (Link.AppleZoom from Bus3D):
 * big enough to turn round and look at, with what we know of it underneath.
 *
 *   ─────────────── (bus, turning) ───────────────
 *                        ⟲
 *   [T816] to MRT Phileo Damansara - SS2
 *   MRT feeder bus                       VH 4307
 *   ───────────────────────────────────────────────
 *   ◔ Slow traffic                          5 km/h
 *     Near Bomba SS2
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   Next stops
 *   ●  Bomba SS2                                now
 *   ○  SS2/24                                 2 min
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   Fare & paying
 *   🎟  Adult                                 RM1.00
 *   ...
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   About this bus
 *   ⚙  Chassis                         Volvo B7RLE
 *   ...
 *
 * Swipe down or the close button zooms it back into the sheet.
 */
export default function BusScreen() {
  const params = useLocalSearchParams<{
    kind?: string;
    vehicleId?: string;
    destination?: string;
  }>();
  const kind: BusKind = params.kind === 'rapid' ? 'rapid' : 'feeder';
  const vehicleId = params.vehicleId ?? null;
  const router = useRouter();
  const trip = useTrip();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { model, vehicle, destination: tripDestination } = useBusDetail(vehicleId ?? '');
  const next = useNextStops({
    tripId: vehicleId ? (vehicle?.tripId ?? null) : null,
    routeCode: trip.routeCode,
    lat: vehicle?.lat ?? null,
    lng: vehicle?.lng ?? null,
    yourStopId: trip.stopId || null,
  });

  const spec = BUS_SPECS[kind];
  const plate = vehicleId ? formatPlate(vehicleId) : null;
  const destination = tripDestination ?? params.destination ?? null;
  const fresh = model.bus?.state.kind !== 'stale' && model.bus?.state.kind !== 'lost';
  const about: { icon: SFSymbol; title: string; value: string }[] = [
    { icon: 'engine.combustion', title: 'Chassis', value: spec.chassis },
    { icon: 'bus', title: 'Body', value: spec.body },
    { icon: 'ruler', title: 'Length', value: spec.length },
    { icon: 'building.2', title: 'Operator', value: spec.operator },
  ];
  const fare = fareFor(trip.routeCode);
  const fares: { icon: SFSymbol; title: string; value: string }[] = [
    { icon: 'ticket', title: 'Adult', value: fare.adult },
    { icon: 'graduationcap', title: 'Students & 60+', value: fare.concession },
    { icon: 'figure.roll', title: 'Disabled (OKU)', value: 'Free' },
    { icon: 'calendar', title: 'My50 pass', value: 'Included' },
  ];

  return (
    <View style={styles.screen}>
      <Link.AppleZoomTarget>
        <View
          style={[
            styles.stage,
            { marginTop: insets.top, height: Math.round(height * STAGE_SHARE) },
          ]}
          collapsable={false}
        >
          <Bus3D
            kind={kind}
            routeCode={trip.routeCode}
            destination={destination}
            style={StyleSheet.absoluteFill}
          />
          {/* It turns under a sideways drag: said with a glyph, not words, laid
              flat like the turntable it stands on. */}
          <View style={styles.turn} pointerEvents="none" accessibilityElementsHidden>
            <SymbolView
              name="arrow.trianglehead.2.clockwise.rotate.90"
              size={30}
              tintColor={color.tertiaryLabel}
            />
          </View>
        </View>
      </Link.AppleZoomTarget>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + space.lg }]}
      >
        <View style={styles.route}>
          <RouteBadge code={trip.routeCode} size="small" />
          {destination ? (
            <Text style={styles.destination} numberOfLines={1}>
              {`to ${destination}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.name} accessibilityRole="header">
            {spec.name}
          </Text>
          {plate ? (
            <View style={styles.plate} accessible accessibilityLabel={`Plate ${plate}`}>
              <Text style={styles.plateText}>{plate}</Text>
            </View>
          ) : null}
        </View>

        {/* What it's doing, without the way to your stop: that's the sheet's. */}
        {vehicleId && model.bus ? (
          <View style={styles.now}>
            <BusStatus journey={{ ...model.bus, toGo: null }} />
          </View>
        ) : null}

        {next ? (
          <Section title="Next stops">
            <NextStopsLine next={next} />
          </Section>
        ) : null}

        {/* Not in the feeds: MyRapid's fares, kept by hand (components/detail/fares.ts). */}
        <Section title="Fare & paying">
          {fares.map((row, i) => (
            <View key={row.title}>
              {i > 0 ? <Hairline inset={ROW_ICON_INSET} /> : null}
              <InfoRow icon={row.icon} title={row.title} value={row.value} />
            </View>
          ))}
          <View style={styles.paying}>
            <NoteRow icon="creditcard" text="Pay with a Touch 'n Go or concession card. No cash." />
            <NoteRow
              icon="person.text.rectangle"
              text="Half fare and free rides need a Rapid Pelajar, Emas or Mesra card. Fares from MyRapid."
            />
          </View>
        </Section>

        <Section title="About this bus">
          {about.map((row, i) => (
            <View key={row.title}>
              {i > 0 ? <Hairline inset={ROW_ICON_INSET} /> : null}
              <InfoRow icon={row.icon} title={row.title} value={row.value} />
            </View>
          ))}
        </Section>

        <View style={styles.note}>
          <SymbolView name="info.circle" size={14} tintColor={color.secondaryLabel} />
          <Text style={styles.noteText}>
            Drawn by us as the kind of bus that works {trip.routeCode}. The live feed names each bus
            by its plate alone.
          </Text>
        </View>
      </ScrollView>

      {/* When we last heard from it, as a feed's timestamp, opposite the close. */}
      {vehicle && model.bus ? (
        <View style={[styles.seen, { top: insets.top + space.xs }]}>
          <View
            style={[styles.seenDot, { backgroundColor: fresh ? color.live : color.tertiaryLabel }]}
          />
          <Text style={styles.seenText}>
            {`${fresh ? 'Live' : 'Last seen'} · ${formatClockHHMM(vehicle.observedAt)}`}
          </Text>
        </View>
      ) : null}

      <View style={[styles.close, { top: insets.top + space.xs }]}>
        <Host matchContents>
          <Button
            onPress={() => router.back()}
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('circle'),
              controlSize('large'),
              tint(pick(hex.ink, scheme)),
              accessibilityLabel('Close'),
            ]}
          >
            <SwiftImage systemName="xmark" size={17} />
          </Button>
        </Host>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.paper,
  },
  stage: {
    width: '100%',
  },
  turn: {
    position: 'absolute',
    bottom: space.xs,
    alignSelf: 'center',
    // A ring on the floor seen from just above. Squashed, not tipped back in
    // 3D: a real tilt sends its far half behind the bus's Metal layer.
    transform: [{ scaleY: 0.4 }],
  },
  panel: {
    flex: 1,
  },
  panelContent: {
    paddingHorizontal: MARGIN,
    paddingTop: space.md,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  destination: {
    ...type.status,
    flexShrink: 1,
    color: color.secondaryLabel,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  name: {
    ...type.title,
    flex: 1,
    color: color.label,
  },
  // A Malaysian plate is white on black whatever the theme.
  plate: {
    backgroundColor: '#000000',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.outline,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  plateText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  now: {
    paddingBottom: space.lg,
  },
  paying: {
    paddingTop: space.xs,
    paddingBottom: space.lg,
  },
  // Level with the close button (a large glass circle).
  seen: {
    position: 'absolute',
    left: MARGIN,
    height: CLOSE_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seenDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  seenText: {
    ...type.footnote,
    color: color.secondaryLabel,
    fontVariant: ['tabular-nums'],
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: space.lg,
  },
  noteText: {
    ...type.footnote,
    flex: 1,
    color: color.secondaryLabel,
  },
  close: {
    position: 'absolute',
    right: MARGIN,
  },
});
