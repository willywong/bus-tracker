import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker, Polyline } from 'react-native-maps';

import { formatStopName } from '@/components/map/format';
import { LandmarkFrame } from '@/components/map/Landmark';
import type { RouteSplit } from '@/components/map/routeSplit';
import type { StopRow } from '@/db/queries';
import { landmarkSprite } from '@/modules/bus-model';

export interface RailStationMark {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Official line colours, one dot each. */
  colors: string[];
}

interface RouteLayerProps {
  polyline: { latitude: number; longitude: number }[];
  /** The route cut at the bus and your stop; see `splitRoute`. */
  split: RouteSplit;
  stops: StopRow[];
  userStop: StopRow | null;
  /** Where you get off, while riding. */
  destination: { lat: number; lng: number; name: string } | null;
  railStations: RailStationMark[];
  ink: string;
  /** Ink for the route past your stop: there, but not your concern. */
  inkMuted: string;
  casing: string;
  /** Marker fill, close to the map so markers read as outlines. */
  paper: string;
  /** The stop open in the sheet, drawn solid. */
  selectedStopId?: string | null;
  onStopPress?: (stopId: string) => void;
  /** Your own stop: tapping it goes back to the trip. */
  onUserStopPress?: () => void;
  /** Zoomed in to street level: stops and stations are drawn as little buildings. */
  close?: boolean;
  /** The MRT station the feeder ends at, drawn as a landmark; null when it isn't one. */
  terminus?: RailStationMark | null;
  /** Zoomed out past where the terminus landmark reads. */
  terminusHidden?: boolean;
  /** A dark map: the buildings have their lights on. */
  night?: boolean;
}

// Apple Maps ignores `anchor` and centres every marker view on its
// coordinate, re-centring when the view's size changes. So every marker
// here has a fixed size with its glyph at the exact centre.
//
// react-native-maps sizes the marker from its *first native subview*. A
// wrapper with only layout styles is flattened away by Fabric, which makes
// the first glyph inside it the marker's whole size, so the marker drifts by
// that glyph's offset — a fixed screen offset that reads as kilometres when
// zoomed out. Wrappers here are `collapsable={false}` to stay real views.
const DOT = 12;
const DOT_SELECTED = 18;
/** Invisible tap frame around a stop bead. */
const STOP_HIT = 32;
/** Your stop: a solid ink disc inside a faint halo. */
const PIN = 28;
const HALO = 40;
const LABEL_GAP = 3;
const CHIP_HEIGHT = 22;
const LABEL_BAND = LABEL_GAP + CHIP_HEIGHT;
const LABELLED_WIDTH = 168;
const RAIL = 20;
const DEST = 26;
/** Landmark sprites: a stop shelter, the selected one, your stop, a station, the MRT station. */
const SHELTER = 36;
const SHELTER_SELECTED = 46;
const YOUR_STOP = 56;
const STATION = 32;
const MRT = 80;

/**
 * Route geometry in Calm Mono: an ink line on a paper casing — light ink
 * past your stop, where it no longer concerns you — stops
 * as paper beads threaded on it, your stop as a solid ink pin with a
 * standing figure and its name on a paper chip (the one labelled marker), a
 * square for where you get off, and small squares with line-colour dots for
 * rail stations near your stop.
 *
 * Mounted only while the geometry matches the active route — the parent
 * unmounts it during a route switch rather than swapping coordinates in place
 * (rapid Polyline prop changes are fragile under Fabric).
 */
export const RouteLayer = memo(function RouteLayer({
  polyline,
  split,
  stops,
  userStop,
  destination,
  railStations,
  ink,
  inkMuted,
  casing,
  paper,
  selectedStopId = null,
  onStopPress,
  onUserStopPress,
  close = false,
  terminus = null,
  terminusHidden = false,
  night = false,
}: RouteLayerProps) {
  if (polyline.length < 2) return null;
  const shelter = close ? landmarkSprite('shelter', night) : null;
  const yourStop = close ? landmarkSprite('your-stop', night) : null;
  const station = close ? landmarkSprite('station', night) : null;
  const band = landmarkSprite('station-band');
  const mrt = terminus && !terminusHidden ? landmarkSprite('mrt-station', night) : null;
  return (
    <>
      <Polyline
        coordinates={polyline}
        strokeColor={casing}
        strokeWidth={9}
        lineCap="round"
        lineJoin="round"
        zIndex={0}
      />
      {/* Each run remounts when its ends move (once per position fix) rather
          than updating coordinates in place, which is fragile under Fabric. */}
      {split.beyond.map((run, i) => (
        <Polyline
          key={`beyond-${i}-${runKey(run)}`}
          coordinates={toCoords(run)}
          strokeColor={inkMuted}
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
          zIndex={0}
        />
      ))}
      {[...split.behind, ...split.ahead].map((run, i) => (
        <Polyline
          key={`ink-${i}-${runKey(run)}`}
          coordinates={toCoords(run)}
          strokeColor={ink}
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
          zIndex={0}
        />
      ))}
      {stops.map((s) => {
        if (s.stop_id === userStop?.stop_id) return null;
        const selected = s.stop_id === selectedStopId;
        return (
          <Marker
            key={s.stop_id}
            coordinate={{ latitude: s.stop_lat, longitude: s.stop_lon }}
            flat
            zIndex={selected ? 2 : 1}
            displayPriority={selected ? 'required' : 'low'}
            onPress={onStopPress ? () => onStopPress(s.stop_id) : undefined}
            accessibilityLabel={`Stop: ${formatStopName(s.stop_name)}`}
          >
            {shelter ? (
              <LandmarkFrame
                uri={shelter}
                size={selected ? SHELTER_SELECTED : SHELTER}
                halo={selected ? ink : null}
              />
            ) : (
              <View style={styles.stopHit} collapsable={false}>
                <View
                  style={[
                    selected ? styles.stopSelected : styles.stopRing,
                    {
                      borderColor: selected ? paper : ink,
                      backgroundColor: selected ? ink : paper,
                    },
                  ]}
                />
              </View>
            )}
          </Marker>
        );
      })}
      {railStations.map((r) =>
        mrt && r.id === terminus?.id ? null : (
          <Marker
            key={`rail-${r.id}`}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            flat
            zIndex={1}
            displayPriority="high"
            accessibilityLabel={`Rail station: ${r.name}`}
          >
            {station ? (
              <LandmarkFrame
                uri={station}
                size={STATION}
                band={band && r.colors[0] ? { uri: band, tint: r.colors[0] } : null}
              />
            ) : (
              <View
                style={[
                  styles.rail,
                  {
                    borderColor: ink,
                    backgroundColor: paper,
                    width: RAIL + (r.colors.length - 1) * 9,
                  },
                ]}
              >
                {r.colors.map((c) => (
                  <View key={c} style={[styles.railDot, { backgroundColor: c }]} />
                ))}
              </View>
            )}
          </Marker>
        ),
      )}
      {mrt && terminus ? (
        // Where the feeder meets the train: it should read as a station from afar.
        <Marker
          key={`terminus-${terminus.id}`}
          coordinate={{ latitude: terminus.lat, longitude: terminus.lng }}
          zIndex={1}
          displayPriority="required"
          accessibilityLabel={`MRT station: ${terminus.name}, where this bus ends`}
        >
          <LandmarkFrame uri={mrt} size={MRT} />
        </Marker>
      ) : null}
      {destination ? (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lng }}
          zIndex={2}
          displayPriority="required"
          accessibilityLabel={`Where you get off: ${destination.name}`}
        >
          <View style={[styles.dest, { borderColor: ink, backgroundColor: paper }]}>
            <View style={[styles.destCore, { backgroundColor: ink }]} />
          </View>
        </Marker>
      ) : null}
      {userStop ? (
        // Symmetric: an empty band above the ring as tall as the label below
        // it keeps the ring exactly on the stop at every zoom level.
        <Marker
          coordinate={{ latitude: userStop.stop_lat, longitude: userStop.stop_lon }}
          zIndex={2}
          displayPriority="required"
          onPress={onUserStopPress}
          accessibilityLabel={`Your stop: ${formatStopName(userStop.stop_name)}`}
        >
          {yourStop ? (
            <LandmarkFrame
              uri={yourStop}
              size={YOUR_STOP}
              below={LABEL_BAND}
              width={LABELLED_WIDTH}
            >
              <View style={[styles.chip, { backgroundColor: paper, borderColor: `${ink}26` }]}>
                <Text
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={[styles.chipText, { color: ink }]}
                >
                  {formatStopName(userStop.stop_name)}
                </Text>
              </View>
            </LandmarkFrame>
          ) : (
            <View style={styles.userStopWrap} collapsable={false}>
              <View style={styles.labelBand} />
              <View style={styles.pinArea}>
                <View style={[styles.halo, { backgroundColor: ink }]} />
                <View style={[styles.pin, { backgroundColor: ink, borderColor: paper }]}>
                  <SymbolView
                    name="figure.stand"
                    size={15}
                    weight="semibold"
                    tintColor={paper}
                    resizeMode="scaleAspectFit"
                  />
                </View>
              </View>
              <View style={[styles.chip, { backgroundColor: paper, borderColor: `${ink}26` }]}>
                <Text
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={[styles.chipText, { color: ink }]}
                >
                  {formatStopName(userStop.stop_name)}
                </Text>
              </View>
            </View>
          )}
        </Marker>
      ) : null}
    </>
  );
});

function toCoords(run: { lat: number; lng: number }[]) {
  return run.map((p) => ({ latitude: p.lat, longitude: p.lng }));
}

function runKey(run: { lat: number; lng: number }[]) {
  const a = run[0];
  const b = run[run.length - 1];
  return `${a.lat.toFixed(6)},${a.lng.toFixed(6)}>${b.lat.toFixed(6)},${b.lng.toFixed(6)}`;
}

const styles = StyleSheet.create({
  stopHit: {
    width: STOP_HIT,
    height: STOP_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSelected: {
    width: DOT_SELECTED,
    height: DOT_SELECTED,
    borderRadius: DOT_SELECTED / 2,
    borderWidth: 3,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  stopRing: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2.5,
  },
  rail: {
    height: RAIL,
    borderRadius: 4,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  railDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dest: {
    width: DEST,
    height: DEST,
    borderRadius: 4,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destCore: {
    width: 9,
    height: 9,
    borderRadius: 1.5,
  },
  // Symmetric bands above and below the pin keep its centre, and so the
  // marker's centre, exactly on the stop.
  userStopWrap: {
    alignItems: 'center',
    width: LABELLED_WIDTH,
    height: HALO + 2 * LABEL_BAND,
  },
  labelBand: {
    height: LABEL_BAND,
  },
  pinArea: {
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
  pin: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
  },
  // The name on a paper chip rather than a text halo, so it stays legible
  // where it crosses the route line or busy streets.
  chip: {
    marginTop: LABEL_GAP,
    height: CHIP_HEIGHT,
    maxWidth: LABELLED_WIDTH,
    paddingHorizontal: 8,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
