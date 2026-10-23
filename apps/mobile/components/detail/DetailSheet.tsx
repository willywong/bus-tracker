import { nearbyRailStations } from '@bus-tracker/shared';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Bus3D, hasBus3D } from '@/components/detail/Bus3D';
import { busKindOf } from '@/modules/bus-model';
import { BusStateLine, BusStatus } from '@/components/detail/BusStatus';
import type { DetailModel } from '@/components/detail/model';
import { openStreetView, StopPhoto } from '@/components/detail/StopPhoto';
import { formatClockHHMM } from '@/components/tracker/logic';
import { Connections } from '@/components/trip/Connections';
import { Facts } from '@/components/trip/Facts';
import { HeroNumber, StatusLine } from '@/components/trip/Hero';
import { AllStopsButton, OnTheWay } from '@/components/trip/OnTheWay';
import { GlassAction, PeekCard } from '@/components/trip/PeekCard';
import { Hairline, LinkRow, ROW_ICON_INSET } from '@/components/trip/Rows';
import { Section, SECTION_RULE, SheetBody } from '@/components/trip/SheetBody';
import { DetailHeader, RouteBadge } from '@/components/trip/SheetHeader';
import { Timetable } from '@/components/trip/Timetable';
import { useBusDetail, useStopDetail } from '@/hooks/useMapDetail';
import { useTrip } from '@/state/TripContext';
import { color, MARGIN, space, type } from '@/theme/design';

interface DetailSheetProps {
  peek: boolean;
  onBack: () => void;
  onStopPress: (stopId: string) => void;
}

/**
 * A stop picked on the map or in the sheet: when the next bus calls here
 * (live when one is approaching), today's times, where it sits on the route
 * relative to yours, a Street View photo (with a key), other routes, rail
 * nearby, walking directions and Street View.
 */
export function StopDetailSheet({ stopId, peek, onBack }: DetailSheetProps & { stopId: string }) {
  const trip = useTrip();
  const router = useRouter();
  const { model, stop, departures, otherRoutes } = useStopDetail(stopId);
  const openStation = (station: string) => router.push({ pathname: '/station', params: { station } });
  const point = useMemo(
    () => (stop ? { lat: stop.stop_lat, lng: stop.stop_lon } : null),
    [stop],
  );
  const hasRail = useMemo(
    () => (point ? nearbyRailStations(point).length > 0 : false),
    [point],
  );

  return (
    <>
      <DetailHeader
        title={model.title}
        subtitle={model.subtitle}
        peek={peek}
        peekContent={
          <View style={styles.peek}>
            <DetailPeek
              model={model}
              railEnd={stopId === trip.stopId ? 'you' : 'stop'}
              action={
                point ? (
                  <GlassAction
                    icon="figure.walk"
                    label="Directions"
                    onPress={() => openWalkingDirections(point)}
                    hint="Opens walking directions in Apple Maps"
                  />
                ) : null
              }
              trailing={nextScheduled(model)}
            />
            <StopPeekLine
              routes={otherRoutes}
              stepFree={model.facts.find((f) => f.id === 'access')?.value ?? null}
            />
          </View>
        }
        onBack={onBack}
      />
      <SheetBody peek={peek}>
        <DetailHero model={model} />
        <Facts facts={model.facts} />
        {point ? (
          <StopPhoto lat={point.lat} lng={point.lng} onOpen={() => openStreetView(point)} />
        ) : null}

        {departures.length > 0 ? (
          <Section title="Today at this stop">
            <Timetable
              departures={departures}
              formatClock={formatClockHHMM}
              arrivingTripId={null}
              firstBusToday={null}
              lastBusToday={null}
            />
          </Section>
        ) : null}

        {otherRoutes.length > 0 ? (
          <Section title="Also stops here">
            <View style={styles.badges}>
              {otherRoutes.map((code) => (
                <RouteBadge key={code} code={code} />
              ))}
            </View>
          </Section>
        ) : null}

        {point && hasRail ? (
          <Section title="Rail nearby">
            <Connections stop={point} onOpenStation={openStation} />
          </Section>
        ) : null}

        {point ? (
          <View style={styles.options}>
            <LinkRow
              icon="figure.walk"
              title="Walking directions"
              external
              onPress={() => openWalkingDirections(point)}
              accessibilityHint="Opens Apple Maps"
            />
            <Hairline inset={ROW_ICON_INSET} />
            <LinkRow
              icon="binoculars"
              title="Street View"
              external
              onPress={() => openStreetView(point)}
              accessibilityHint="Opens Google Maps at this stop"
            />
            <Hairline inset={ROW_ICON_INSET} />
          </View>
        ) : null}
      </SheetBody>
    </>
  );
}

/**
 * A live bus picked on the map, led by what it's doing. The 3D bus on the
 * left turns while the real one moves and comes to rest when it stops; on
 * the right, how long it is from your stop and when it gets there. Under
 * them it says what it's doing now (on the move, in slow traffic, at a
 * light or a stop) and how far it has to go, then its stops from here to
 * yours, and every stop on the route with this bus marked.
 */
export function BusDetailSheet({
  vehicleId,
  peek,
  onBack,
  onStopPress,
}: DetailSheetProps & { vehicleId: string }) {
  const trip = useTrip();
  const router = useRouter();
  const { model, journey, destination } = useBusDetail(vehicleId);
  const stopCount = trip.route?.stops.length ?? 0;
  const openAllStops = () => router.push('/stops');
  const journeyShown = !!(model.hero && journey.ready && journey.userStop && journey.busStop);
  const arrival = model.hero
    ? model.hero.unit
      ? `${model.hero.text} ${model.hero.unit}`
      : model.hero.text
    : null;
  // Mounted only above peek, so the 3D scene never renders unseen.
  const showBus = !peek && hasBus3D;
  const state = model.bus?.state.kind;
  const moving = state === 'moving' || state === 'slow' || state === 'on-route';

  return (
    <>
      <DetailHeader
        title={model.title}
        subtitle={model.subtitle}
        peek={peek}
        peekContent={
          // What it's doing under the card: the room the search row left.
          <View style={styles.peek}>
            <DetailPeek
              model={model}
              railEnd="you"
              action={
                stopCount > 0 ? (
                  <GlassAction
                    icon="list.bullet"
                    label={`All ${stopCount} stops`}
                    onPress={openAllStops}
                  />
                ) : null
              }
              trailing={distance(model)}
            />
            {model.bus ? <BusStateLine journey={model.bus} /> : null}
          </View>
        }
        onBack={onBack}
      />
      <SheetBody peek={peek}>
        <View style={showBus ? styles.heroRow : null}>
          {showBus ? (
            <Bus3D
              kind={busKindOf(trip.stopId)}
              routeCode={trip.routeCode}
              destination={destination}
              style={styles.bus}
              still={!moving}
              opens={{ vehicleId }}
            />
          ) : null}
          <BusHero model={model} align={showBus ? 'end' : 'start'} />
        </View>
        {model.bus ? <BusStatus journey={model.bus} /> : null}

        {journeyShown ? (
          <Section title="On the way to your stop">
            <OnTheWay journey={journey} arrivalLabel={arrival} onStopPress={onStopPress} />
            {stopCount > 0 ? <AllStopsButton count={stopCount} onPress={openAllStops} /> : null}
          </Section>
        ) : stopCount > 0 ? (
          <View style={styles.options}>
            <LinkRow
              icon="list.bullet"
              title={`All stops on ${trip.routeCode}`}
              value={String(stopCount)}
              onPress={openAllStops}
            />
            <Hairline inset={ROW_ICON_INSET} />
          </View>
        ) : null}
      </SheetBody>
    </>
  );
}

/**
 * The detail sheets' peek: the shared PeekCard, with the number, the bus's
 * rail when one is live (else the status line beside the number), and the
 * sheet's own glass action.
 */
function DetailPeek({
  model,
  railEnd,
  action,
  trailing,
}: {
  model: DetailModel;
  railEnd: 'you' | 'stop';
  action: ReactNode;
  trailing: { label: string; value: string } | null;
}) {
  return (
    <PeekCard
      hero={model.hero}
      source={model.hero ? model.source : null}
      stopsAhead={model.hero ? model.stopsAhead : null}
      railEnd={railEnd}
      aside={model.hero ? (model.line[0] ?? null) : model.peek}
      action={action}
      trailing={trailing}
    />
  );
}

/** Badges shown on the stop's peek line before "+N". */
const PEEK_ROUTES = 4;

/**
 * Under the stop's peek card: the other routes that call here, as badges,
 * and whether it's step-free. Nothing when there's neither.
 */
function StopPeekLine({ routes, stepFree }: { routes: string[]; stepFree: string | null }) {
  if (routes.length === 0 && !stepFree) return null;
  const shown = routes.slice(0, PEEK_ROUTES);
  const more = routes.length - shown.length;
  return (
    <View>
      <Hairline />
      <View style={styles.peekLine}>
        {routes.length > 0 ? (
          <View
            style={styles.peekRoutes}
            accessible
            accessibilityLabel={`Also stops here: ${routes.join(', ')}`}
          >
            <Text style={styles.peekLabel}>Also here</Text>
            {shown.map((code) => (
              <RouteBadge key={code} code={code} size="small" />
            ))}
            {more > 0 ? <Text style={styles.peekLabel}>{`+${more}`}</Text> : null}
          </View>
        ) : (
          <View style={styles.peekRoutes} />
        )}
        {stepFree ? (
          <View style={styles.peekAccess} accessible accessibilityLabel={`Wheelchair: ${stepFree}`}>
            <SymbolView name="figure.roll" size={14} tintColor={color.secondaryLabel} />
            <Text style={styles.peekLabel}>{stepFree}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The next timetabled bus at a stop: "Then 12:42 PM", or "Scheduled …" beside a live one. */
function nextScheduled(model: DetailModel) {
  const f = model.facts.find((x) => x.id === 'next');
  return f ? { label: model.source === 'live' ? 'Scheduled' : 'Then', value: f.value } : null;
}

/** How far the bus has to go to your stop, along the route. */
function distance(model: DetailModel) {
  const f = model.facts.find((x) => x.id === 'distance');
  return f ? { label: 'To go', value: f.value } : null;
}

function openWalkingDirections(point: { lat: number; lng: number }) {
  void Linking.openURL(`https://maps.apple.com/?daddr=${point.lat},${point.lng}&dirflg=w`);
}

/**
 * The bus's hero: the minutes to your stop with the live dot, and when it
 * gets there (or that it has passed you). What it's doing is the card's.
 */
function BusHero({ model, align }: { model: DetailModel; align: 'start' | 'end' }) {
  const caption = model.bus?.caption ?? null;
  if (!model.hero && !caption) return null;
  const end = align === 'end';
  return (
    <View style={[styles.hero, end && styles.heroEnd]}>
      <HeroNumber hero={model.hero} source="live" accessibilityLabel={model.accessibilityLabel} />
      {caption ? <StatusLine source={null} lead={null} rest={[caption]} stacked={end} /> : null}
    </View>
  );
}

/** The detail hero: the number with its live dot, and one status line. */
function DetailHero({ model }: { model: DetailModel }) {
  const source = model.source === 'live' ? 'live' : 'scheduled';
  const lead =
    model.source === 'live' ? 'Live' : model.source === 'scheduled' ? 'Scheduled' : model.line[0];
  const rest = model.source ? model.line : model.line.slice(1);
  if (!model.hero && !lead) return null;
  return (
    <View style={styles.hero}>
      <HeroNumber hero={model.hero} source={source} accessibilityLabel={model.accessibilityLabel} />
      {lead ? <StatusLine source={model.source} lead={lead} rest={rest} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The bus bleeding off the left edge, the minutes on the right.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  bus: {
    flex: 1,
    height: 150,
    marginLeft: -MARGIN,
  },
  peek: {
    gap: space.sm,
  },
  peekLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
  },
  peekRoutes: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peekLabel: {
    ...type.status,
    color: color.secondaryLabel,
  },
  peekAccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hero: {
    gap: 2,
  },
  heroEnd: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    paddingVertical: space.xs,
  },
  options: {
    marginHorizontal: -MARGIN,
    paddingHorizontal: MARGIN,
    borderTopWidth: SECTION_RULE,
    borderTopColor: color.hairline,
  },
});
