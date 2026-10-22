import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TRANSFER_KIND, type Itinerary, type Leg, type LegPoint, type Timing } from '@bus-tracker/shared';

import {
  detailNotes,
  findSuccessor,
  railBetween,
  railHeadsign,
  railRouteIds,
  resolveOpen,
  rideSummary,
  timelineLabels,
  timelineRows,
  type TimelineNet,
  type TimelineRow,
} from '../model';

const T0 = Date.UTC(2026, 9, 28, 0, 0); // 08:00 MYT
const MIN = 60_000;
/** "09:05": MYT, 24-hour. */
const clock = (ms: number) => {
  const d = new Date(ms + 8 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// Stops: 0 Hotel Lisa De Inn, 1 Phileo Damansara (bus), 2 Phileo Damansara (MRT),
// 3 Pasar Seni (MRT), 4 Pasar Seni (LRT), 5 KLCC (LRT).
const NET = {
  routes: {
    id: ['T816', 'rail:KG', 'rail:KJ', '780'],
    label: ['T816', 'KG', 'KJ', '780'],
    longName: ['T816 feeder', 'MRT Kajang Line', 'LRT Kelana Jaya Line', '780 bus'],
    textColor: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF'],
  },
  stops: { station: Int32Array.from([-1, -1, 0, 1, 1, 2]) },
  stations: [{ id: 'phileo-damansara' }, { id: 'pasar-seni' }, { id: 'klcc' }],
  // 1 → 2 a plain walk; 3 → 4 a curated, unverified interchange.
  transfers: {
    start: Int32Array.from([0, 0, 1, 1, 2, 2]),
    len: Int32Array.from([0, 1, 0, 1, 0, 0]),
    to: Int32Array.from([2, 4]),
    kind: Uint8Array.from([TRANSFER_KIND.walk, TRANSFER_KIND.interchange]),
  },
} as unknown as TimelineNet;

const pt = (name: string, min: number, stop?: number): LegPoint => ({ stop, name, lat: 3.1, lng: 101.6, time: T0 + min * MIN });
const walk = (from: LegPoint, to: LegPoint, meters: number): Leg => ({
  kind: 'walk',
  from,
  to,
  meters,
  seconds: (to.time - from.time) / 1000,
});
const ride = (
  route: number,
  mode: 'bus' | 'feeder' | 'mrt' | 'lrt',
  from: LegPoint,
  to: LegPoint,
  timing: Timing,
  opts: { via?: LegPoint[]; headsign?: string; tripKey?: string; color?: string } = {},
): Leg => ({
  kind: 'ride',
  mode,
  route,
  label: NET.routes.label[route],
  color: opts.color ?? (mode === 'mrt' ? '047940' : mode === 'lrt' ? 'E0115F' : '000000'),
  headsign: opts.headsign ?? 'Somewhere',
  from,
  to,
  via: opts.via ?? [],
  timing,
  tripKey: opts.tripKey,
});

function itinerary(id: string, legs: Leg[], extra: Partial<Itinerary> = {}): Itinerary {
  return {
    id,
    departAt: legs[0].from.time,
    arriveAt: legs[legs.length - 1].to.time,
    legs,
    rides: legs.filter((l) => l.kind === 'ride').length,
    walkMeters: legs.reduce((m, l) => m + (l.kind === 'walk' ? l.meters : 0), 0),
    tags: [],
    warnings: [],
    ...extra,
  };
}

const LIVE: Timing = { kind: 'live', vehicleId: 'v1', asOf: T0 + 41 * 60_000 - 60 * MIN, deltaSec: 60 };

/** My location → T816 → MRT Kajang Line → LRT Kelana Jaya Line → KLCC. */
const CRITERION = itinerary('a', [
  walk(pt('My location', 0), pt('HOTEL LISA DE INN', 5, 0), 380),
  ride(0, 'feeder', pt('HOTEL LISA DE INN', 5, 0), pt('MRT PHILEO DAMANSARA', 20, 1), LIVE, {
    via: [pt('SS2/24', 9, 9), pt('PJ210 BANGUNAN SIN CHEW DAILY', 14, 9)],
    headsign: 'MRT PHILEO DAMANSARA',
    tripKey: 't816-0905',
  }),
  walk(pt('MRT PHILEO DAMANSARA', 20, 1), pt('Phileo Damansara', 23, 2), 200),
  ride(1, 'mrt', pt('Phileo Damansara', 25, 2), pt('Pasar Seni', 45, 3), { kind: 'headway', headwaySec: 360 }, {
    via: [pt('Semantan', 30, 9), pt('Muzium Negara', 40, 9)],
    headsign: 'Kajang',
  }),
  walk(pt('Pasar Seni', 45, 3), pt('Pasar Seni', 48, 4), 150),
  ride(2, 'lrt', pt('Pasar Seni', 50, 4), pt('KLCC', 58, 5), { kind: 'headway', headwaySec: 240 }, {
    via: [pt('Masjid Jamek', 52, 9), pt('Dang Wangi', 54, 9), pt('Kampung Baru', 56, 9)],
    headsign: 'Gombak',
  }),
  walk(pt('KLCC', 58, 5), pt('KLCC Park', 62), 300),
]);

const kinds = (rows: TimelineRow[]) => rows.map((r) => r.kind);
const only = <K extends TimelineRow['kind']>(rows: TimelineRow[], kind: K) =>
  rows.filter((r): r is Extract<TimelineRow, { kind: K }> => r.kind === kind);

test('origin and destination bracket the legs', () => {
  const rows = timelineRows(CRITERION, NET, clock);
  assert.deepEqual(kinds(rows), [
    'end',
    'walk',
    'board', 'ride', 'alight',
    'walk',
    'board', 'ride', 'alight',
    'walk',
    'board', 'ride', 'alight',
    'walk',
    'end',
  ]);
  const [first, last] = [rows[0], rows[rows.length - 1]];
  assert.ok(first.kind === 'end' && first.which === 'origin' && first.name === 'My location');
  assert.ok(last.kind === 'end' && last.which === 'destination' && last.name === 'KLCC Park');
  assert.deepEqual(first.time, { kind: 'live', at: CRITERION.departAt });

  // From a stop (a snap walk of a few metres): the board row is the start.
  const fromStop = itinerary('s', [
    walk(pt('Hotel Lisa De Inn', 0, 0), pt('HOTEL LISA DE INN', 0.2, 0), 3),
    ride(0, 'feeder', pt('HOTEL LISA DE INN', 5, 0), pt('MRT PHILEO DAMANSARA', 20, 1), { kind: 'scheduled' }),
  ]);
  const r2 = timelineRows(fromStop, NET, clock);
  assert.deepEqual(kinds(r2), ['board', 'ride', 'alight']);
  assert.equal(only(r2, 'board')[0].end, 'origin');
  assert.equal(only(r2, 'alight')[0].end, 'destination');
});

test('headway ride shows every instead of a time', () => {
  const boards = only(timelineRows(CRITERION, NET, clock), 'board');
  // KJ every 4 mins: no time at all.
  assert.deepEqual(boards[2].time, { kind: 'every', minutes: 4 });
  // KG every 6 mins (over 5): an "about" time, never a bare clock.
  assert.deepEqual(boards[1].time, { kind: 'about', at: T0 + 25 * MIN });
  assert.equal(boards[1].stationId, 'phileo-damansara');
  assert.equal(boards[1].node, 'station');
  assert.equal(boards[1].color, '#047940');
  const rides = only(timelineRows(CRITERION, NET, clock), 'ride');
  assert.equal(rides[2].chip.kind === 'rail' ? rides[2].chip.every : null, 4);
});

test('unverified interchange says about', () => {
  const walks = only(timelineRows(CRITERION, NET, clock), 'walk');
  assert.equal(walks[2].about, true);
  assert.equal(walks[2].label, 'Change · about 3 mins walk');
  assert.equal(walks[1].about, false);
});

test('live boarding is marked live, later legs stay scheduled', () => {
  const it = itinerary('l', [
    walk(pt('My location', 0), pt('HOTEL LISA DE INN', 5, 0), 380),
    ride(0, 'feeder', pt('HOTEL LISA DE INN', 5, 0), pt('MRT PHILEO DAMANSARA', 20, 1), LIVE),
    walk(pt('MRT PHILEO DAMANSARA', 20, 1), pt('Phileo Damansara', 23, 2), 200),
    ride(3, 'bus', pt('Phileo Damansara', 30, 2), pt('KLCC', 50, 5), { kind: 'scheduled' }),
    walk(pt('KLCC', 50, 5), pt('KLCC Park', 54), 300),
  ]);
  const rows = timelineRows(it, NET, clock);
  const boards = only(rows, 'board');
  assert.deepEqual(boards[0].time, { kind: 'live', at: T0 + 5 * MIN });
  assert.equal(boards[0].liveNote, `Live · as of ${clock(LIVE.kind === 'live' ? LIVE.asOf : 0)}`);
  assert.equal(boards[0].name, 'Hotel Lisa De Inn');
  assert.deepEqual(boards[1].time, { kind: 'scheduled', at: T0 + 30 * MIN });
  assert.equal(boards[1].liveNote, null);
  const last = rows[rows.length - 1];
  assert.ok(last.kind === 'end' && last.time?.kind === 'scheduled');
});

test('intermediate stops exclude board and alight', () => {
  const rides = only(timelineRows(CRITERION, NET, clock), 'ride');
  assert.deepEqual(rides[0].stops, ['SS2/24', 'PJ210 Bangunan Sin Chew Daily']);
  assert.deepEqual(rides[2].stops, ['Masjid Jamek', 'Dang Wangi', 'Kampung Baru']);
  assert.equal(rideSummary(rides[2]), '4 stops · 8 mins');
  assert.equal(rides[0].headsign, 'MRT Phileo Damansara');
  assert.equal(rides[0].rail, 'ink');
});

test('walk between rides is labelled Change', () => {
  const walks = only(timelineRows(CRITERION, NET, clock), 'walk');
  assert.equal(walks[0].label, 'Walk 5 mins · 380 m');
  assert.equal(walks[0].change, false);
  assert.equal(walks[1].label, 'Change · walk 3 mins');
  assert.equal(walks[1].change, true);
  assert.equal(walks[3].label, 'Walk 4 mins · 300 m');
});

test('rails follow the legs and labels never rely on colour', () => {
  const rows = timelineRows(CRITERION, NET, clock);
  assert.deepEqual(railBetween(rows[0], rows[1]), { kind: 'walk' });
  assert.deepEqual(railBetween(rows[2], rows[3]), { kind: 'ink' });
  assert.deepEqual(railBetween(rows[7], rows[8]), { kind: 'line', color: '#047940' });
  const labels = timelineLabels(rows, clock);
  assert.equal(
    labels[2],
    `08:05, board T816 at Hotel Lisa De Inn towards MRT Phileo Damansara, live, as of ${clock(T0 + 41 * MIN - 60 * MIN)}`,
  );
  assert.equal(labels[11], 'Kelana Jaya Line towards Gombak, every 4 minutes, 4 stops, 8 minutes');
  assert.equal(labels[10], 'Board Kelana Jaya Line at Pasar Seni towards Gombak, every 4 minutes');
  assert.equal(labels[9], 'Change, about 3 minutes walk');
  assert.deepEqual(railRouteIds(CRITERION, NET), ['rail:KG', 'rail:KJ']);
});

test('detail notes put a missed connection first, with the old arrival', () => {
  const missed = { ...CRITERION, warnings: ['missed-connection' as const], previousArriveAt: CRITERION.arriveAt - 8 * MIN };
  assert.deepEqual(detailNotes(missed, clock), [
    { text: `Connection missed. Times updated · was ${clock(missed.previousArriveAt)}`, urgent: true },
  ]);
  const moved = { ...CRITERION, previousArriveAt: CRITERION.arriveAt - 3 * MIN };
  assert.deepEqual(detailNotes(moved, clock), [{ text: `Updated · was ${clock(moved.previousArriveAt)}`, urgent: false }]);
  assert.deepEqual(detailNotes({ ...CRITERION, previousArriveAt: CRITERION.arriveAt + 20_000 }, clock), []);
});

/** The same first ride; the tail re-planned after the transfer broke (new legs, new id). */
function replanned(id: string, firstRide: { tripKey?: string; route?: number } = {}): Itinerary {
  const legs = CRITERION.legs.slice(0, 2).map((l) =>
    l.kind === 'ride' ? { ...l, tripKey: firstRide.tripKey ?? l.tripKey, route: firstRide.route ?? l.route } : l,
  );
  return itinerary(
    id,
    [
      ...legs,
      walk(pt('MRT PHILEO DAMANSARA', 20, 1), pt('Phileo Damansara', 23, 2), 200),
      ride(1, 'mrt', pt('Phileo Damansara', 31, 2), pt('KLCC', 60, 5), { kind: 'headway', headwaySec: 360 }),
    ],
    { warnings: ['missed-connection'], previousArriveAt: CRITERION.arriveAt },
  );
}

test('findSuccessor follows the first ride leg after a tail re-plan', () => {
  const other = replanned('x', { route: 3 });
  const next = replanned('b');
  assert.equal(findSuccessor(CRITERION, [other, next]), next);
});

test('findSuccessor returns null when the first ride changed', () => {
  assert.equal(findSuccessor(CRITERION, [replanned('c', { tripKey: 't816-0915' })]), null);
  assert.equal(findSuccessor(CRITERION, [replanned('d', { route: 3 })]), null);
  const walkOnly = itinerary('w', [walk(pt('My location', 0), pt('KLCC Park', 40), 3000)]);
  assert.equal(findSuccessor(walkOnly, [CRITERION]), null);
});

test('the open itinerary follows its id, then its successor, then its position', () => {
  const second = replanned('s2', { route: 3 });
  const open = { id: 'a', index: 1 };
  // Still there: by id.
  assert.equal(resolveOpen(open, null, [second, CRITERION]), CRITERION);
  // Renamed by a tail re-plan: the successor, wherever it now sits.
  const next = replanned('b');
  assert.equal(resolveOpen(open, CRITERION, [next, second]), next);
  // First ride changed too: the same position, clamped.
  const moved = replanned('m', { tripKey: 'later' });
  assert.equal(resolveOpen(open, CRITERION, [second, moved]), moved);
  assert.equal(resolveOpen({ id: 'a', index: 4 }, CRITERION, [moved]), moved);
  // A re-plan in flight (no results yet): keep showing the last one.
  assert.equal(resolveOpen(open, CRITERION, []), CRITERION);
  // Closed.
  assert.equal(resolveOpen(null, CRITERION, [CRITERION]), null);
});

test('rail headsigns drop the "From X to" prefix', () => {
  assert.equal(railHeadsign('From KL Sentral to Titiwangsa'), 'Titiwangsa');
  assert.equal(railHeadsign('Gombak'), 'Gombak');
  assert.equal(railHeadsign('Tanjung Malim'), 'Tanjung Malim');
});
