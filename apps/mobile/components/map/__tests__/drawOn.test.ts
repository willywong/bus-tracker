import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Itinerary, Leg, LegPoint } from '@bus-tracker/shared';

import { DRAW_MS, drawSchedule, easeOutTimeAt, MAX_CHUNKS, MAX_CHUNKS_PER_LEG, type DrawChunk } from '../drawOn';
import { itineraryDrawLegs, sliceShape, walkRequests } from '../itineraryGeometry';

/** Walk, bus (40 points), walk, rail (12), walk, rail (80), walk. */
const LEGS = [
  { kind: 'walk' as const, points: 2 },
  { kind: 'bus' as const, points: 40 },
  { kind: 'walk' as const, points: 2 },
  { kind: 'rail' as const, points: 12 },
  { kind: 'walk' as const, points: 2 },
  { kind: 'rail' as const, points: 80 },
  { kind: 'walk' as const, points: 30 },
];

const byLeg = (chunks: DrawChunk[], leg: number) => chunks.filter((c) => c.leg === leg);

test('walk legs appear at once', () => {
  const s = drawSchedule(LEGS);
  for (const leg of [0, 2, 4, 6]) {
    const chunks = byLeg(s, leg);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0], { leg, from: 0, to: LEGS[leg].points - 1, atMs: 0 });
  }
});

test('chunks are monotonic and end by 650 ms', () => {
  const s = drawSchedule(LEGS);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].atMs >= s[i - 1].atMs);
  assert.equal(s[s.length - 1].atMs, DRAW_MS);
  assert.ok(s.every((c) => c.atMs >= 0 && c.atMs <= DRAW_MS));
  // Rides draw in leg order: every chunk of an earlier ride lands no later than a later ride's.
  const rides = s.filter((c) => LEGS[c.leg].kind !== 'walk');
  for (let i = 1; i < rides.length; i++) assert.ok(rides[i].leg >= rides[i - 1].leg);
  // The ease-out curve: the first half of the line is down well before half the time.
  assert.ok(easeOutTimeAt(0.5) < 0.25);
  assert.equal(easeOutTimeAt(1), 1);
  assert.equal(easeOutTimeAt(0), 0);
});

test('never more than 24 chunks', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: i % 2 ? ('bus' as const) : ('walk' as const), points: 500 }));
  const s = drawSchedule(many);
  assert.ok(s.length <= MAX_CHUNKS, `${s.length} chunks`);
  for (let leg = 0; leg < many.length; leg++) assert.ok(byLeg(s, leg).length <= MAX_CHUNKS_PER_LEG);
  assert.ok(drawSchedule(LEGS).length <= MAX_CHUNKS);
  // A two-point ride is one chunk, not six empty ones.
  assert.equal(drawSchedule([{ kind: 'bus', points: 2 }]).length, 1);
});

test('reduce motion draws everything at zero', () => {
  const s = drawSchedule(LEGS, DRAW_MS, true);
  assert.ok(s.length > LEGS.length);
  assert.ok(s.every((c) => c.atMs === 0));
});

test('consecutive chunks share an endpoint', () => {
  const s = drawSchedule(LEGS);
  LEGS.forEach((l, leg) => {
    const chunks = byLeg(s, leg);
    assert.equal(chunks[0].from, 0);
    assert.equal(chunks[chunks.length - 1].to, l.points - 1);
    for (let j = 1; j < chunks.length; j++) assert.equal(chunks[j].from, chunks[j - 1].to);
  });
});

// --- Leg geometry -----------------------------------------------------------

const P = (lat: number, lng: number, name = '', time = 0, stop?: number): LegPoint => ({ stop, name, lat, lng, time });

test('a rail leg follows its line shape between the stations, either way along it', () => {
  // A shape running east along a bend; stations sit near it, between its points.
  const shape = [
    { lat: 3.1, lng: 101.6 },
    { lat: 3.1, lng: 101.61 },
    { lat: 3.105, lng: 101.62 },
    { lat: 3.105, lng: 101.63 },
  ];
  const a = { lat: 3.1001, lng: 101.605 };
  const b = { lat: 3.1049, lng: 101.625 };
  const fwd = sliceShape(shape, a, b, [a, b]);
  assert.deepEqual(fwd, [a, shape[1], shape[2], b]);
  const back = sliceShape(shape, b, a, [b, a]);
  assert.deepEqual(back, [b, shape[2], shape[1], a]);
  // A station off the line isn't on this shape.
  assert.equal(sliceShape(shape, { lat: 3.12, lng: 101.605 }, b, [b]), null);

  const flat = new Float32Array(shape.flatMap((p) => [p.lat, p.lng]));
  const leg: Leg = {
    kind: 'ride',
    mode: 'lrt',
    route: 0,
    label: 'KJ',
    color: 'E0115F',
    headsign: 'Gombak',
    from: P(a.lat, a.lng, 'A'),
    to: P(b.lat, b.lng, 'B'),
    via: [],
    timing: { kind: 'headway', headwaySec: 240 },
  };
  const it = { legs: [leg] } as unknown as Itinerary;
  const [drawn] = itineraryDrawLegs(it, { routeIds: ['rail:KJ'], railShapes: new Map([['rail:KJ', flat]]) });
  assert.equal(drawn.kind, 'rail');
  assert.equal(drawn.color, '#E0115F');
  assert.equal(drawn.coords.length, 4);
  // No stored shape: station to station.
  const [plain] = itineraryDrawLegs(it, { routeIds: ['rail:KJ'] });
  assert.deepEqual(plain.coords, [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  ]);
});

test('walks use the loaded path, else a straight line; only real walks are asked for', () => {
  const legs: Leg[] = [
    { kind: 'walk', from: P(3.1, 101.6), to: P(3.101, 101.601), meters: 160, seconds: 120 },
    { kind: 'ride', mode: 'bus', route: 0, label: 'T816', color: '', headsign: '', from: P(3.101, 101.601), to: P(3.11, 101.61), via: [P(3.105, 101.605)], timing: { kind: 'scheduled' } },
    { kind: 'walk', from: P(3.11, 101.61), to: P(3.1101, 101.6101), meters: 15, seconds: 12 },
  ];
  const it = { legs } as unknown as Itinerary;
  assert.deepEqual(
    walkRequests(it).map((r) => r.index),
    [0],
  );
  const path = [
    { lat: 3.1002, lng: 101.6 },
    { lat: 3.1008, lng: 101.6009 },
  ];
  const drawn = itineraryDrawLegs(it, { routeIds: ['T816'], walkPaths: { 0: path } });
  assert.equal(drawn[0].kind, 'walk');
  assert.equal(drawn[0].coords.length, 4);
  assert.equal(drawn[1].kind, 'bus');
  assert.equal(drawn[1].coords.length, 3);
  assert.equal(drawn[2].coords.length, 2);
});
