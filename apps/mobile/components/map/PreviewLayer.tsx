import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { DRAW_MS, drawSchedule, type Coord } from '@/components/map/drawOn';

/** One stop of the previewed route, from yours onward. */
export interface PreviewStopMark {
  /** Network stop index: stable, so a marker never changes in place. */
  index: number;
  name: string;
  coord: Coord;
  yours: boolean;
}

interface PreviewLayerProps {
  /** From your stop to the end of the pattern: the road slice, else stop to stop. */
  path: readonly Coord[];
  stops: readonly PreviewStopMark[];
  /** Identity of the preview: a new key is a fresh mount (the parent keys the layer by it). */
  drawKey: string;
  ink: string;
  /** Fill of the stop beads and your stop's ring. */
  paper: string;
  /** Bus casing, as `RouteLayer`'s. */
  casing: string;
  reduceMotion: boolean;
  /** Draw the path on (a preview just opened); false shows it finished at once. */
  animate: boolean;
  /** The camera has settled on the path: the draw may begin. Ignored when not animating. */
  start: boolean;
  /** Called once the last chunk has landed (or at once when not animating). */
  onDrawn?: () => void;
}

/** Fixed sizes, glyph centred (Apple Maps ignores `anchor`). */
const DOT = 10;
const RING = 22;
const RING_DOT = 8;
const HALO = 40;

/**
 * A route previewed from Nearby (plan 17/05; board "Then · tap a route"):
 * its path from your stop onward as an ink line on a casing, as
 * `ItineraryLayer` draws a bus leg, with its stops as paper beads and your
 * stop ringed. Live buses of the route are drawn by the parent, outside this
 * keyed layer: remounting a gliding marker mid-animation trips Fabric.
 *
 * Drawing on reuses the itinerary's `drawSchedule`: the path is cut into at
 * most six chunks, each mounted once at its time and never changed, then
 * swapped for one polyline in a single remount. The beads land with that
 * last chunk, so none floats ahead of the line. Reduce Motion draws it all
 * at once, as does a remount once drawn (a rail restyle, `animate` false).
 *
 * Apple Maps stacks overlays in add order and ignores `zIndex`, so the
 * parent mounts this after `RailLayer` and keys it with the rail layer's
 * key: a rail restyle re-adds the path on top.
 */
export const PreviewLayer = memo(function PreviewLayer({
  path,
  stops,
  drawKey,
  ink,
  paper,
  casing,
  reduceMotion,
  animate,
  start,
  onDrawn,
}: PreviewLayerProps) {
  const instant = !animate || reduceMotion;
  // The path only changes with `drawKey` (a remount), so the schedule is fixed for this mount.
  const schedule = useMemo(
    () => drawSchedule([{ kind: 'bus', points: path.length }], DRAW_MS, reduceMotion),
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

  if (path.length < 2 || (!done && !start)) return null;
  const yours = stops.find((s) => s.yours);

  return (
    <>
      {done ? (
        <Fragment key={`${drawKey}-final`}>
          <PathLine coords={path as Coord[]} ink={ink} casing={casing} />
        </Fragment>
      ) : (
        schedule
          .slice(0, landed)
          .map((c, j) => (
            <PathLine
              key={`chunk-${j}`}
              coords={path.slice(c.from, c.to + 1) as Coord[]}
              ink={ink}
              casing={casing}
              chunk
            />
          ))
      )}
      {done
        ? stops.map((s) =>
            s.yours ? null : (
              <Marker
                key={`stop-${s.index}`}
                coordinate={s.coord}
                tracksViewChanges={false}
                flat
                zIndex={1}
                displayPriority="low"
                accessibilityLabel={`Stop: ${s.name}`}
              >
                <View collapsable={false} style={[styles.dot, { borderColor: ink, backgroundColor: paper }]} />
              </Marker>
            ),
          )
        : null}
      {yours ? (
        <Marker
          key={`yours-${yours.index}`}
          coordinate={yours.coord}
          tracksViewChanges={false}
          zIndex={3}
          displayPriority="required"
          accessibilityLabel={`Your stop: ${yours.name}`}
        >
          <View collapsable={false} style={styles.ringArea}>
            <View style={[styles.halo, { backgroundColor: ink }]} />
            <View style={[styles.ring, { borderColor: ink, backgroundColor: paper }]}>
              <View style={[styles.ringDot, { backgroundColor: ink }]} />
            </View>
          </View>
        </Marker>
      ) : null}
    </>
  );
});

/**
 * The path (or one chunk of it): an ink line on a casing. Casings of chunks
 * have butt caps so a chunk's casing doesn't cut into the ink before it.
 */
function PathLine({
  coords,
  ink,
  casing,
  chunk = false,
}: {
  coords: Coord[];
  ink: string;
  casing: string;
  chunk?: boolean;
}) {
  if (coords.length < 2) return null;
  return (
    <>
      <Polyline
        coordinates={coords}
        strokeColor={casing}
        strokeWidth={9}
        lineCap={chunk ? 'butt' : 'round'}
        lineJoin="round"
      />
      <Polyline coordinates={coords} strokeColor={ink} strokeWidth={4} lineCap="round" lineJoin="round" />
    </>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2.5,
  },
  // A faint halo around the ring keeps the marker's centre on your stop.
  ringArea: {
    width: HALO,
    height: HALO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    opacity: 0.14,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  ringDot: {
    width: RING_DOT,
    height: RING_DOT,
    borderRadius: RING_DOT / 2,
  },
});
