import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { DRAW_MS, drawSchedule, type Coord, type DrawLeg } from '@/components/map/drawOn';

export type { DrawLeg };

interface ItineraryLayerProps {
  legs: readonly DrawLeg[];
  /** Identity of the ride geometry: a new key is a fresh mount (the parent keys the layer by it). */
  drawKey: string;
  ink: string;
  /** Rail casing, and the fill of the end and change markers. */
  paper: string;
  /** Bus casing, as `RouteLayer`'s. */
  casing: string;
  reduceMotion: boolean;
  /** Draw the legs on (an itinerary just opened); false shows them finished at once. */
  animate: boolean;
  /** The camera has settled on the legs: the draw may begin. Ignored when not animating. */
  start: boolean;
  /** Called once the last chunk has landed (or at once when not animating). */
  onDrawn?: () => void;
}

/** End pins and change rings: fixed sizes, glyph centred (Apple Maps ignores `anchor`). */
const END_PIN = 20;
const END_DOT = 8;
const CHANGE_RING = 12;

/**
 * An itinerary's legs on the map (spec §6.3, §7.1): a bus as an ink line on
 * a casing (as `RouteLayer`), rail in its line colour on a paper casing, a
 * walk as ink dots. A ringed pin marks the start, a solid ink disc the
 * destination, and paper rings the changes.
 *
 * Drawing on: MapKit re-adds an overlay on every prop change, so the legs
 * are cut into at most 24 chunks (`drawSchedule`), each mounted once on its
 * frame of a `requestAnimationFrame` loop and never changed. When the last
 * one lands, every chunk is swapped for one polyline per leg in a single
 * remount. Walks appear at once; Reduce Motion draws everything at once.
 *
 * Apple Maps stacks overlays in add order and ignores `zIndex`, so the
 * parent mounts this after `RailLayer` and keys it with the rail layer's
 * key: a rail restyle re-adds the legs on top. A walk's path arriving later
 * remounts that walk's polyline alone.
 */
export const ItineraryLayer = memo(function ItineraryLayer({
  legs,
  drawKey,
  ink,
  paper,
  casing,
  reduceMotion,
  animate,
  start,
  onDrawn,
}: ItineraryLayerProps) {
  const instant = !animate || reduceMotion;
  // Ride chunk bounds only change with `drawKey` (a remount), so the
  // schedule is fixed for this mount; a walk's later path doesn't move it.
  const schedule = useMemo(
    () => drawSchedule(legs.map((l) => ({ kind: l.kind, points: l.coords.length })), DRAW_MS, reduceMotion),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawKey, reduceMotion],
  );
  const [landed, setLanded] = useState(0);
  const done = instant || landed >= schedule.length;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;

  useEffect(() => {
    if (instant || !start) return;
    const t0 = performance.now();
    let n = 0;
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - t0;
      let next = n;
      while (next < schedule.length && schedule[next].atMs <= elapsed) next++;
      if (next !== n) {
        n = next;
        setLanded(n);
      }
      if (n < schedule.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [instant, start, schedule]);

  useEffect(() => {
    if (done) onDrawnRef.current?.();
  }, [done]);

  if (legs.length === 0 || (!done && !start)) return null;

  const first = legs[0].coords[0];
  const lastLeg = legs[legs.length - 1];
  const last = lastLeg.coords[lastLeg.coords.length - 1];
  // A ring wherever a ride starts or ends mid-journey.
  const changes: { key: string; at: Coord }[] = [];
  if (done) {
    legs.forEach((l, i) => {
      if (l.kind === 'walk' || l.coords.length < 2) return;
      if (i > 0) changes.push({ key: `in-${i}`, at: l.coords[0] });
      if (i < legs.length - 1) changes.push({ key: `out-${i}`, at: l.coords[l.coords.length - 1] });
    });
  }

  return (
    <>
      {done ? (
        <Fragment key={`${drawKey}-final`}>
          {legs.map((l, i) => (
            <LegLine key={lineKey(l, i)} leg={l} coords={l.coords} ink={ink} paper={paper} casing={casing} />
          ))}
        </Fragment>
      ) : (
        schedule.slice(0, landed).map((c, j) => {
          const leg = legs[c.leg];
          // A walk is always whole: its path may have arrived since the schedule was made.
          const coords = leg.kind === 'walk' ? leg.coords : leg.coords.slice(c.from, c.to + 1);
          return (
            <LegLine
              key={leg.kind === 'walk' ? lineKey(leg, c.leg) : `chunk-${j}`}
              leg={leg}
              coords={coords}
              ink={ink}
              paper={paper}
              casing={casing}
              chunk
            />
          );
        })
      )}
      {first ? (
        <Marker
          coordinate={first}
          tracksViewChanges={false}
          zIndex={3}
          displayPriority="required"
          accessibilityLabel="Start"
        >
          <View collapsable={false} style={[styles.pin, { borderColor: ink, backgroundColor: paper }]}>
            <View style={[styles.pinDot, { backgroundColor: ink }]} />
          </View>
        </Marker>
      ) : null}
      {changes.map((c) => (
        <Marker
          key={c.key}
          coordinate={c.at}
          tracksViewChanges={false}
          zIndex={2}
          displayPriority="high"
          accessibilityLabel="Change"
        >
          <View collapsable={false} style={[styles.ring, { borderColor: ink, backgroundColor: paper }]} />
        </Marker>
      ))}
      {done && last ? (
        <Marker
          coordinate={last}
          tracksViewChanges={false}
          zIndex={3}
          displayPriority="required"
          accessibilityLabel="Destination"
        >
          <View collapsable={false} style={[styles.pin, styles.dest, { borderColor: paper, backgroundColor: ink }]} />
        </Marker>
      ) : null}
    </>
  );
});

/** A walk's key carries its geometry, so a path arriving later remounts it rather than changing it in place. */
function lineKey(l: DrawLeg, i: number): string {
  return l.kind === 'walk' ? `walk-${i}-${l.coords.length}` : `leg-${i}`;
}

/**
 * One leg (or one chunk of it). Casings of chunks have butt caps so a
 * chunk's casing doesn't cut into the ink of the one before it.
 */
function LegLine({
  leg,
  coords,
  ink,
  paper,
  casing,
  chunk = false,
}: {
  leg: DrawLeg;
  coords: Coord[];
  ink: string;
  paper: string;
  casing: string;
  chunk?: boolean;
}) {
  if (coords.length < 2) return null;
  if (leg.kind === 'walk') {
    // Round caps on near-zero dashes draw dots. If they don't render on
    // device, fall back to [2, 5].
    return (
      <Polyline
        coordinates={coords}
        strokeColor={ink}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        lineDashPattern={[0.1, 6]}
      />
    );
  }
  const rail = leg.kind === 'rail';
  return (
    <>
      <Polyline
        coordinates={coords}
        strokeColor={rail ? paper : casing}
        strokeWidth={rail ? 7 : 9}
        lineCap={chunk ? 'butt' : 'round'}
        lineJoin="round"
      />
      <Polyline
        coordinates={coords}
        strokeColor={rail ? (leg.color ?? ink) : ink}
        strokeWidth={rail ? 5 : 4}
        lineCap="round"
        lineJoin="round"
      />
    </>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: END_PIN,
    height: END_PIN,
    borderRadius: END_PIN / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  pinDot: {
    width: END_DOT,
    height: END_DOT,
    borderRadius: END_DOT / 2,
  },
  dest: {
    borderWidth: 3,
  },
  ring: {
    width: CHANGE_RING,
    height: CHANGE_RING,
    borderRadius: CHANGE_RING / 2,
    borderWidth: 2.5,
  },
});
