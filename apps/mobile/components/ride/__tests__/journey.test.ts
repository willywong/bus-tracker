import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Itinerary, Leg, LegPoint, Timing } from '@bus-tracker/shared';

import {
  advanceJourney,
  goCompact,
  goInstruction,
  honestTiming,
  journeyActivityProps,
  legSequence,
  offRouteMeters,
  offRouteStep,
  retimeFrom,
  type JourneyProgress,
} from '../journey';
import { advanceRide } from '../model';

const T0 = Date.UTC(2026, 9, 28, 0, 0); // 08:00 MYT
const MIN = 60_000;

const pt = (name: string, min: number, lat: number, lng: number, stop?: number): LegPoint => ({
  stop,
  name,
  lat,
  lng,
  time: T0 + min * MIN,
});
const walk = (from: LegPoint, to: LegPoint, meters: number): Leg => ({
  kind: 'walk',
  from,
  to,
  meters,
  seconds: (to.time - from.time) / 1000,
});
const ride = (
  label: string,
  mode: 'feeder' | 'mrt' | 'lrt' | 'ktm',
  from: LegPoint,
  to: LegPoint,
  via: LegPoint[],
  timing: Timing,
  headsign: string,
): Leg => ({ kind: 'ride', mode, route: 0, label, color: '047940', headsign, from, to, via, timing });

// Due north along lng 101.63 for the bus, then east for rail.
const HOME = pt('My location', 0, 3.11, 101.63);
const LISA = pt('HOTEL LISA DE INN', 5, 3.112, 101.63, 0);
const SS2 = pt('SS2/24', 9, 3.117, 101.63, 1);
const PJ210 = pt('PJ210', 14, 3.122, 101.63, 2);
const PHILEO_BUS = pt('MRT PHILEO DAMANSARA', 20, 3.127, 101.63, 3);
const PHILEO = pt('Phileo Damansara', 25, 3.1275, 101.6305, 4);
const SEMANTAN = pt('Semantan', 30, 3.14, 101.65, 5);
const MUZIUM = pt('Muzium Negara', 40, 3.135, 101.69, 6);
const PASAR_SENI = pt('Pasar Seni', 45, 3.142, 101.695, 7);
const PASAR_SENI_LRT = pt('Pasar Seni', 50, 3.1425, 101.6955, 8);
const MASJID = pt('Masjid Jamek', 53, 3.149, 101.696, 9);
const KLCC = pt('KLCC', 58, 3.159, 101.713, 10);
const PARK = pt('KLCC Park', 62, 3.155, 101.714);

const LIVE: Timing = { kind: 'live', vehicleId: 'v1', asOf: T0, deltaSec: 60 };

/** My location → T816 → MRT Kajang Line → LRT Kelana Jaya Line → KLCC Park. */
const IT: Itinerary = (() => {
  const legs: Leg[] = [
    walk(HOME, LISA, 380),
    ride('T816', 'feeder', LISA, PHILEO_BUS, [SS2, PJ210], LIVE, 'MRT PHILEO DAMANSARA'),
    walk(PHILEO_BUS, { ...PHILEO, time: T0 + 23 * MIN }, 200),
    ride('KG', 'mrt', PHILEO, PASAR_SENI, [SEMANTAN, MUZIUM], { kind: 'headway', headwaySec: 240 }, 'Kajang'),
    walk(PASAR_SENI, { ...PASAR_SENI_LRT, time: T0 + 48 * MIN }, 150),
    ride('KJ', 'lrt', PASAR_SENI_LRT, KLCC, [MASJID], { kind: 'headway', headwaySec: 240 }, 'Gombak'),
    walk(KLCC, PARK, 300),
  ];
  return {
    id: 'a',
    departAt: legs[0].from.time,
    arriveAt: legs[legs.length - 1].to.time,
    legs,
    rides: 3,
    walkMeters: 1030,
    tags: [],
    warnings: [],
  };
})();

const at = (p: LegPoint) => ({ lat: p.lat, lng: p.lng });
const progress = (legIndex: number, phase: JourneyProgress['phase'], passedIndex = 0): JourneyProgress => ({
  legIndex,
  phase,
  passedIndex,
  stopsToGo: null,
  approximate: false,
  nextStop: null,
  legEndsAt: IT.legs[legIndex].to.time,
});

test('walk leg completes near its end', () => {
  const start = advanceJourney(IT, null, at(HOME), T0 + 1 * MIN);
  assert.equal(start.legIndex, 0);
  assert.equal(start.phase, 'walking');
  assert.equal(start.nextStop?.name, 'Hotel Lisa De Inn');
  assert.equal(start.legEndsAt, LISA.time);

  // ~20 m short of the stop: within AT_STOP_METERS.
  const near = { lat: LISA.lat - 0.00018, lng: LISA.lng };
  const done = advanceJourney(IT, start, near, T0 + 4 * MIN);
  assert.equal(done.legIndex, 0);
  assert.equal(done.phase, 'leg-done');

  // The next step moves on: at the stop, the bus not yet here.
  const next = advanceJourney(IT, done, near, T0 + 4 * MIN);
  assert.equal(next.legIndex, 1);
  assert.equal(next.phase, 'waiting');
  assert.equal(next.stopsToGo, 3);

  // With no position, two minutes after the walk was due to end.
  assert.equal(advanceJourney(IT, start, null, LISA.time + MIN).phase, 'walking');
  assert.equal(advanceJourney(IT, start, null, LISA.time + 2 * MIN).phase, 'leg-done');
});

test('bus leg advances with advanceRide', () => {
  const waiting = progress(1, 'waiting');
  const seq = legSequence(IT.legs[1]);
  assert.deepEqual(
    seq.map((s) => s.name),
    ['Hotel Lisa De Inn', 'SS2/24', 'PJ210', 'MRT Phileo Damansara'],
  );

  const pos = at(SS2);
  const p = advanceJourney(IT, waiting, pos, T0 + 9 * MIN);
  assert.equal(p.passedIndex, advanceRide(seq, pos, 0).passedIndex);
  assert.equal(p.phase, 'riding');
  assert.equal(p.stopsToGo, 2);
  assert.equal(p.approximate, false);
  assert.equal(p.nextStop?.name, 'PJ210');

  const next = advanceJourney(IT, p, at(PJ210), T0 + 14 * MIN);
  assert.equal(next.phase, 'next-is-yours');
  assert.equal(next.stopsToGo, 1);

  const off = advanceJourney(IT, next, at(PHILEO_BUS), T0 + 20 * MIN);
  assert.equal(off.phase, 'leg-done');
  assert.equal(off.stopsToGo, 0);

  // Never backwards: a stray fix by the boarding stop keeps the progress.
  assert.equal(advanceJourney(IT, next, at(LISA), T0 + 15 * MIN).passedIndex, next.passedIndex);
});

test('rail leg advances by the clock and is approximate', () => {
  const waiting = progress(3, 'waiting');
  const far = { lat: 2.9, lng: 101.5 }; // GPS is ignored on rail
  const before = advanceJourney(IT, waiting, far, T0 + 24 * MIN);
  assert.equal(before.phase, 'waiting');
  assert.equal(before.approximate, true);

  const mid = advanceJourney(IT, before, far, T0 + 35 * MIN);
  assert.equal(mid.passedIndex, 1); // Semantan (09:30 MYT) has passed, Muzium Negara hasn't
  assert.equal(mid.phase, 'riding');
  assert.equal(mid.stopsToGo, 2);
  assert.equal(mid.approximate, true);

  assert.equal(advanceJourney(IT, mid, null, T0 + 41 * MIN).phase, 'next-is-yours');
  assert.equal(advanceJourney(IT, mid, null, T0 + 45 * MIN).phase, 'leg-done');
  assert.equal(goInstruction(IT, mid, T0 + 35 * MIN, () => 'Kajang Line'), 'Kajang Line · about 2 stops');
});

test('last leg completion is arrived', () => {
  const walking = progress(6, 'walking');
  const there = advanceJourney(IT, walking, at(PARK), T0 + 62 * MIN);
  assert.equal(there.phase, 'arrived');
  assert.equal(there.legIndex, 6);
  // Arrived stays arrived.
  assert.equal(advanceJourney(IT, there, at(HOME), T0 + 70 * MIN), there);

  // A journey that ends on a ride (a snap walk after it) arrives at the alight stop.
  const endsOnRide: Itinerary = {
    ...IT,
    legs: [IT.legs[5], walk(KLCC, { ...KLCC, time: KLCC.time + 10_000 }, 3)],
  };
  const p = advanceJourney(endsOnRide, null, null, T0 + 59 * MIN);
  assert.equal(p.phase, 'arrived');
  assert.equal(p.legIndex, 0);
  assert.deepEqual(goCompact(endsOnRide, p, T0 + 59 * MIN), { text: 'Here', unit: null, kind: 'word' });
});

test('off-route distance uses the nearest path segment', () => {
  // 500 m east of the middle of a north–south segment.
  const kx = 111_320 * Math.cos((3.115 * Math.PI) / 180);
  const pos = { lat: 3.115, lng: 101.63 + 500 / kx };
  const ns = [
    { lat: 3.11, lng: 101.63 },
    { lat: 3.12, lng: 101.63 },
  ];
  assert.ok(Math.abs(offRouteMeters(pos, [ns]) - 500) < 2);
  // A nearer second path wins; a lone point counts as itself.
  const near = [{ lat: 3.115, lng: 101.63 + 100 / kx }];
  assert.ok(Math.abs(offRouteMeters(pos, [ns, near]) - 400) < 2);
  // Past the segment's end, the distance is to the end point.
  const south = { lat: 3.1, lng: 101.63 };
  assert.ok(Math.abs(offRouteMeters(south, [ns]) - 1105) < 10);
  assert.equal(offRouteMeters(pos, []), Infinity);

  // Off route only after 30 s of readings past 400 m.
  const a = offRouteStep(null, 500, 1000);
  assert.deepEqual(a, { since: 1000, off: false });
  assert.deepEqual(offRouteStep(a.since, 520, 31_000), { since: 1000, off: true });
  assert.deepEqual(offRouteStep(a.since, 120, 31_000), { since: null, off: false });
});

test('activity props read "Walk to Hotel Lisa De Inn · T816 in 3 mins"', () => {
  const now = T0 + 2 * MIN;
  const p = advanceJourney(IT, null, at(HOME), now);
  const props = journeyActivityProps(IT, p, now);
  assert.equal(props.kind, 'journey');
  assert.equal(props.legText, 'Walk to Hotel Lisa De Inn · T816 in 3 mins');
  assert.equal(props.routeCode, 'Walk');
  assert.equal(props.stopName, 'Hotel Lisa De Inn');
  assert.equal(props.arrivalEpochMs, LISA.time);
  assert.ok(props.tripStartEpochMs <= props.arrivalEpochMs);
  assert.equal(props.legIndex, 1);
  assert.equal(props.legCount, 7);
  assert.equal(props.source, 'schedule');

  // On the bus, with a fresh live fix: live, stops to go.
  const riding = advanceJourney(IT, progress(1, 'waiting'), at(SS2), T0 + 1 * MIN);
  const live = journeyActivityProps(IT, riding, T0 + 1 * MIN);
  assert.equal(live.legText, 'On T816 · 2 stops to MRT Phileo Damansara');
  assert.equal(live.routeCode, 'T816');
  assert.equal(live.source, 'live');
  assert.equal(live.busPlate, 'v1');
  // An old fix isn't live any more.
  assert.equal(journeyActivityProps(IT, riding, T0 + 10 * MIN).source, 'schedule');
  const stale = honestTiming(IT, T0 + 10 * MIN, false).legs[1];
  assert.ok(stale.kind === 'ride' && stale.timing.kind === 'scheduled');
  assert.equal(honestTiming(IT, T0 + 1 * MIN, false), IT);
  assert.notEqual(honestTiming(IT, T0 + 1 * MIN, true), IT);
});

test('activity props for rail say every and get off at', () => {
  const now = T0 + 23 * MIN;
  const p = advanceJourney(IT, progress(3, 'waiting'), null, now);
  const props = journeyActivityProps(IT, p, now);
  assert.equal(props.legText, 'KG towards Kajang · every 4 mins · get off at Pasar Seni');
  assert.equal(props.routeCode, 'KG');
  assert.equal(props.stopName, 'Pasar Seni');
  assert.equal(props.approximate, true);
  assert.equal(props.source, 'schedule');
  // Waiting counts down to boarding.
  assert.equal(props.arrivalEpochMs, PHILEO.time);

  // Riding: about N stops.
  const riding = advanceJourney(IT, p, null, T0 + 35 * MIN);
  assert.equal(
    journeyActivityProps(IT, riding, T0 + 35 * MIN).legText,
    'KG towards Kajang · about 2 stops · get off at Pasar Seni',
  );

  // A longer headway says "about", never "every"; KTM is a timetable.
  const sparse: Itinerary = {
    ...IT,
    legs: IT.legs.map((l, i) => (i === 3 && l.kind === 'ride' ? { ...l, timing: { kind: 'headway', headwaySec: 600 } } : l)),
  };
  assert.equal(
    journeyActivityProps(sparse, p, now).legText,
    'KG towards Kajang · in about 2 mins · get off at Pasar Seni',
  );
  assert.equal(retimeFrom(p), 3);
  assert.equal(retimeFrom(riding), 4);
});

test('waiting for the bus, the countdown starts now and ends at boarding', () => {
  const now = LISA.time - 3 * MIN;
  const props = journeyActivityProps(IT, progress(1, 'waiting'), now);
  assert.equal(props.arrivalEpochMs, LISA.time);
  assert.ok(props.tripStartEpochMs <= now, 'lower bound must have passed or the timer reads 0:00');
});
