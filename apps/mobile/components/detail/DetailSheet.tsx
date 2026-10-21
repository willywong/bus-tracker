import { nearbyRailStations } from '@bus-tracker/shared';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

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
import { color, MARGIN, space } from '@/theme/design';

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
  const { model, stop, departures, otherRoutes } = useStopDetail(stopId);
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
            <Connections stop={point} />
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
 * A live bus picked on the map: how long it is from your stop (or that it
 * has passed it), how it's moving, its stops from here to yours, and every
 * stop on the route with this bus marked.
 */
export function BusDetailSheet({
  vehicleId,
  peek,
  onBack,
  onStopPress,
}: DetailSheetProps & { vehicleId: string }) {
  const trip = useTrip();
  const router = useRouter();
  const { model, journey } = useBusDetail(vehicleId);
  const stopCount = trip.route?.stops.length ?? 0;
  const openAllStops = () => router.push('/stops');
  const journeyShown = !!(model.hero && journey.ready && journey.userStop && journey.busStop);
  const arrival = model.hero
    ? model.hero.unit
      ? `${model.hero.text} ${model.hero.unit}`
      : model.hero.text
    : null;

  return (
    <>
      <DetailHeader
        title={model.title}
        subtitle={model.subtitle}
        peek={peek}
        peekContent={
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
        }
        onBack={onBack}
      />
      <SheetBody peek={peek}>
        <DetailHero model={model} />
        <Facts facts={model.facts} />

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
  hero: {
    gap: 2,
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
