import assert from 'node:assert/strict';
import test from 'node:test';

import {
  haversineMeters,
  RAIL_LINES,
  RAIL_STATIONS,
  type NetworkHealth,
  type RailStation,
  type TransitNetwork,
} from '@bus-tracker/shared';

// Test-only helpers from the shared package: a hand-built network and the
// four 2026-10-23 fixture feeds compiled for 2026-10-28.
import { buildNetwork } from '../../../../../packages/shared/src/transit/__tests__/fixtures/syntheticNetwork';
import { fixtureNetwork } from '../../../../../packages/shared/src/transit/__tests__/helpers/fixture-network';

import {
  buildStationSheet,
  interchangeNote,
  lineBadgeLabel,
  lineDisplayName,
  NEARBY_MAX,
  NEARBY_RADIUS_M,
} from '../stationModel';

/** Epoch ms of a Malaysia wall-clock time on 2026-10-28. */
const myt = (h: number, m = 0) => Date.UTC(2026, 9, 28, h, m) - 8 * 3_600_000;
const at = (h: number, m = 0) => h * 3600 + m * 60;
/** A fixed clock so expectations don't depend on the 12/24 h setting. */
const clock = (ms: number) => {
  const d = new Date(ms + 8 * 3_600_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const KJ = RAIL_LINES.find((l) => l.code === 'LRT KJ')!;
const KG = RAIL_LINES.find((l) => l.code === 'MRT KG')!;

const station = (id: string, name: string, stopIds: string[], lines = [KJ]): RailStation => ({
  id,
  name,
  lat: 3.15,
  lng: 101.7,
  stopIds,
  lines,
});

/**
 * A 3-station Kelana Jaya Line (Gombak – Masjid Jamek – Pasar Seni), each
 * way: every 3 min 06:00–09:00, every 7 min 09:00–23:30, 2 min between
 * stations.
 */
function kjNetwork(): TransitNetwork {
  const windows: Array<[number, number, number]> = [
    [at(6), at(9), 180],
    [at(9), at(23, 30), 420],
  ];
  const net = buildNetwork({
    stops: [
      { id: 'rail:KJ1', name: 'Gombak', station: 0 },
      { id: 'rail:KJ13', name: 'Masjid Jamek', station: 1 },
      { id: 'rail:KJ14', name: 'Pasar Seni', station: 2 },
    ],
    stations: [
      station('gombak', 'Gombak', ['rail:KJ1']),
      station('masjid-jamek', 'Masjid Jamek', ['rail:KJ13']),
      station('pasar-seni', 'Pasar Seni', ['rail:KJ14']),
    ],
    routes: [{ id: 'rail:KJ', label: 'KJ', mode: 'lrt', feed: 'rail' }],
    patterns: [
      { route: 0, headsign: 'Pasar Seni', stops: [0, 1, 2], windows, runOffset: [0, 120, 240] },
      { route: 0, headsign: 'Gombak', stops: [2, 1, 0], windows, runOffset: [0, 120, 240] },
    ],
  });
  net.routes.longName[0] = KJ.name;
  net.routes.color[0] = KJ.color;
  return net;
}

const OK_HEALTH: NetworkHealth = {
  rail: { feed: 'rail', state: 'ok', validFrom: '20190101', validUntil: '20261231', daysLeft: 64, included: true },
};

test('expired rail marks unavailable but keeps station and lines from RAIL_STATIONS', () => {
  const net = fixtureNetwork({ exclude: ['rail'] });
  const health: NetworkHealth = {
    rail: { feed: 'rail', state: 'expired', validFrom: '20190101', validUntil: '20261231', daysLeft: -2, included: false },
  };
  const m = buildStationSheet({ net, health, stationId: 'pasar-seni', now: myt(7, 30), clock });
  assert.ok(m);
  assert.equal(m.station.name, 'Pasar Seni');
  assert.deepEqual(m.station.stopIds, ['rail:KG16', 'rail:KJ14']);
  assert.deepEqual(
    m.lines.map((l) => [l.badge, l.name, l.line.color]),
    [
      ['KJ', 'Kelana Jaya Line', '#D50032'],
      ['KG', 'Kajang Line', '#047940'],
    ],
  );
  assert.equal(m.unavailable, true);
  assert.equal(m.reason, 'expired');
  assert.equal(m.unavailableNote, 'Rail timetable from data.gov.my has expired.');
  assert.deepEqual(
    m.boards.map((b) => [b.line.name, b.rows.length, b.footer]),
    [
      ['Kelana Jaya Line', 0, null],
      ['Kajang Line', 0, null],
    ],
  );
  // Buses still come from the network.
  assert.ok(m.nearby.length > 0);

  // No network at all: still the bundled station, unavailable, no buses.
  const bare = buildStationSheet({ net: null, health: null, stationId: 'pasar-seni', now: myt(7, 30), clock });
  assert.ok(bare);
  assert.equal(bare.unavailable, true);
  assert.equal(bare.reason, 'no-network');
  assert.equal(bare.unavailableNote, null);
  assert.deepEqual(bare.lines.map((l) => [l.badge, l.routeId]), [
    ['KJ', null],
    ['KG', null],
  ]);
  assert.deepEqual(bare.nearby, []);
});

test('headway ≤ 300 s rows have rolling null and primary "every 3 mins"', () => {
  const m = buildStationSheet({ net: kjNetwork(), health: OK_HEALTH, stationId: 'masjid-jamek', now: myt(7), clock });
  assert.ok(m);
  assert.equal(m.unavailable, false);
  assert.equal(m.boards.length, 1);
  const { rows, line } = m.boards[0];
  assert.equal(line.routeId, 'rail:KJ');
  assert.deepEqual(
    rows.map((r) => [r.towards, r.primary, r.secondary, r.rolling]),
    [
      ['Gombak', 'every 3 mins', null, null],
      ['Pasar Seni', 'every 3 mins', null, null],
    ],
  );
  assert.equal(m.boards[0].footer, 'First 6:02 · Last 23:30');
  assert.equal(m.boards[0].footerSpoken, 'First train 6:02, last train 23:30');
});

test('headway > 300 s rows roll the minute count', () => {
  // 10:00 at Masjid Jamek: trains leave each end at 09:00 + k·7 min and
  // pass here 2 min later, so the next is 10:05, "about 5 mins".
  const m = buildStationSheet({ net: kjNetwork(), health: OK_HEALTH, stationId: 'masjid-jamek', now: myt(10), clock });
  assert.ok(m);
  const row = m.boards[0].rows[0];
  assert.equal(row.primary, 'about 5 mins');
  assert.equal(row.secondary, 'then every 7 mins');
  assert.equal(row.rolling, 5);
  assert.equal(row.spoken, 'Kelana Jaya Line towards Gombak, about 5 minutes, then every 7 minutes');
});

test('interchanges skip pairs merged into the same station', () => {
  // Masjid Jamek merges AG7, KJ13 and SP7: its curated walks are all inside it.
  const mj = buildStationSheet({ net: null, health: null, stationId: 'masjid-jamek', now: myt(7), clock });
  assert.ok(mj);
  assert.deepEqual(mj.interchanges, []);
  // KL Sentral merges KJ15 and MR1, so KJ15 ↔ MR1 is skipped; KG15 is Muzium Negara.
  const kls = buildStationSheet({ net: null, health: null, stationId: 'kl-sentral', now: myt(7), clock });
  assert.ok(kls);
  assert.deepEqual(
    kls.interchanges.map((x) => x.stationId),
    ['muzium-negara'],
  );
  // With a network, the KTM side resolves too.
  const net = fixtureNetwork();
  const full = buildStationSheet({ net, health: OK_HEALTH, stationId: 'kl-sentral', now: myt(7), clock });
  assert.ok(full);
  assert.deepEqual(
    full.interchanges.map((x) => [x.stationId, x.walk]),
    [
      ['ktm-kl-sentral', 'about 3 min walk'],
      ['muzium-negara', 'about 6 min walk'],
    ],
  );
  assert.ok(full.interchanges.every((x) => x.stationId !== 'kl-sentral'));
});

test('unverified interchange reads "about N min walk"', () => {
  const m = buildStationSheet({ net: null, health: null, stationId: 'muzium-negara', now: myt(7), clock });
  assert.ok(m);
  const [kls] = m.interchanges;
  assert.equal(kls.stationId, 'kl-sentral');
  assert.equal(kls.name, 'KL Sentral');
  assert.equal(kls.walk, 'about 6 min walk');
  assert.equal(kls.note, 'Walk to KL Sentral');
  assert.deepEqual(kls.colors, [KJ.color, RAIL_LINES.find((l) => l.code === 'Monorail MR')!.color]);
  assert.equal(kls.spoken, 'KL Sentral, Kelana Jaya Line, KL Monorail Line, about 6 minute walk. Walk to KL Sentral');
});

test('walk notes name the other end from both sides', () => {
  const net = fixtureNetwork();
  const noteTo = (from: string, to: string) =>
    buildStationSheet({ net, health: OK_HEALTH, stationId: from, now: myt(7), clock })!.interchanges.find((x) => x.stationId === to)!.note;
  // KL Sentral: the curated note reads from the LRT side.
  assert.equal(noteTo('kl-sentral', 'ktm-kl-sentral'), 'Walk to the KTM platforms in KL Sentral');
  assert.equal(noteTo('ktm-kl-sentral', 'kl-sentral'), 'Walk to the LRT and Monorail platforms in KL Sentral');
  // Different names: the other station.
  assert.equal(noteTo('pasar-seni', 'ktm-kuala-lumpur'), 'Walk to KTM Kuala Lumpur');
  assert.equal(noteTo('ktm-kuala-lumpur', 'pasar-seni'), 'Walk to Pasar Seni');
  assert.equal(noteTo('muzium-negara', 'kl-sentral'), 'Walk to KL Sentral');
  assert.equal(noteTo('kl-sentral', 'muzium-negara'), 'Walk to Muzium Negara');
  // "Walk between" reads both ways and is kept.
  assert.equal(noteTo('bukit-nanas', 'dang-wangi'), 'Walk between Dang Wangi and Bukit Nanas');
  // The spoken label carries the same note.
  const ktm = buildStationSheet({ net, health: OK_HEALTH, stationId: 'ktm-kl-sentral', now: myt(7), clock })!;
  assert.match(ktm.interchanges[0].spoken, /\. Walk to the LRT and Monorail platforms in KL Sentral$/);
});

test('interchangeNote: a KTM-only other end reads "KTM <name>"', () => {
  const ktmLine = { ...KJ, code: 'KTM', mode: 'KTM' as const, name: 'KTM Seremban Line' };
  const ic = { a: 'rail:X', b: 'rail:Y', seconds: 180, note: 'Walk to somewhere', verified: false };
  const here = station('here', 'Here', ['rail:Y']);
  const there = station('there', 'There', ['ktm:1'], [ktmLine]);
  assert.equal(interchangeNote(ic, true, here, there), 'Walk to somewhere');
  assert.equal(interchangeNote(ic, false, here, there), 'Walk to KTM There');
});

test('nearby keeps bus-kl and feeder stops within 250 m, max 4, nearest first', () => {
  const net = fixtureNetwork();
  const m = buildStationSheet({ net, health: OK_HEALTH, stationId: 'pasar-seni', now: myt(7, 30), clock });
  assert.ok(m);
  assert.equal(m.nearby.length, NEARBY_MAX);
  const here = { lat: m.station.lat, lng: m.station.lng };
  const dist = m.nearby.map((n) => haversineMeters(here, { lat: net.stops.lat[n.stopIndex], lng: net.stops.lon[n.stopIndex] }));
  assert.ok(dist.every((d) => d <= NEARBY_RADIUS_M));
  assert.deepEqual(dist, [...dist].sort((a, b) => a - b));
  for (const n of m.nearby) {
    assert.ok(!n.stopId.startsWith('rail:') && !n.stopId.startsWith('ktm:'), n.stopId);
    assert.match(n.walk, /^\d+ min walk$/);
    assert.ok(n.routeLabel.length > 0);
    assert.ok(!n.others.includes(n.routeLabel));
    // Timetable times are marked scheduled; headways read "every N mins".
    if (n.scheduled) {
      assert.match(n.next, /^(next|first) \d/);
      assert.match(n.spoken, /Scheduled/);
    } else {
      assert.match(n.next, /^every \d+ mins?$|^No more buses today$/);
    }
  }
  // A followed route at one of these stops is the row's route, flagged as the trip.
  const target = m.nearby.find((n) => n.others.length > 0) ?? m.nearby[0];
  const route = target.others[0] ?? target.routeLabel;
  const withTrip = buildStationSheet({
    net,
    health: OK_HEALTH,
    stationId: 'pasar-seni',
    now: myt(7, 30),
    clock,
    tripRouteCode: route,
    tripStopId: target.stopId,
  });
  const row = withTrip?.nearby.find((n) => n.stopId === target.stopId);
  assert.equal(row?.routeLabel, route);
  assert.equal(row?.isTrip, true);
});

test('spoken row reads "Kelana Jaya Line towards Gombak, every 3 minutes"', () => {
  const m = buildStationSheet({ net: kjNetwork(), health: OK_HEALTH, stationId: 'pasar-seni', now: myt(7), clock });
  assert.ok(m);
  assert.deepEqual(
    m.boards[0].rows.map((r) => r.spoken),
    ['Kelana Jaya Line towards Gombak, every 3 minutes'],
  );
});

test('the fixture board at Pasar Seni lists both lines and both directions', () => {
  const m = buildStationSheet({ net: fixtureNetwork(), health: OK_HEALTH, stationId: 'pasar-seni', now: myt(7, 30), clock });
  assert.ok(m);
  assert.deepEqual(
    m.boards.map((b) => [b.line.badge, b.line.routeId, b.rows.map((r) => r.towards).sort()]),
    [
      ['KJ', 'rail:KJ', ['Gombak', 'Putra Heights']],
      ['KG', 'rail:KGL', ['Kajang', 'Kwasa Damansara']],
    ],
  );
  const kajang = m.boards[1].rows.find((r) => r.towards === 'Kajang')!;
  assert.equal(kajang.primary, 'about 1 min');
  assert.equal(kajang.secondary, 'then every 6 mins');
});

test('line names drop the mode prefix and badges keep the last code token', () => {
  assert.equal(lineDisplayName(KJ), 'Kelana Jaya Line');
  assert.equal(lineDisplayName(KG), 'Kajang Line');
  assert.equal(lineDisplayName({ name: 'KL Monorail Line' }), 'KL Monorail Line');
  assert.equal(lineDisplayName({ name: 'KTM Komuter Seremban Line' }), 'Komuter Seremban Line');
  assert.deepEqual(
    RAIL_LINES.map(lineBadgeLabel),
    ['AG', 'KJ', 'SA', 'SP', 'KG', 'PY', 'MR', 'BRT'],
  );
});

test('unknown id returns null', () => {
  assert.equal(buildStationSheet({ net: null, health: null, stationId: 'nowhere', now: myt(7), clock }), null);
  assert.equal(buildStationSheet({ net: kjNetwork(), health: OK_HEALTH, stationId: 'nowhere', now: myt(7), clock }), null);
  // A bundled id the network lacks still resolves.
  assert.ok(RAIL_STATIONS.some((s) => s.id === 'kajang'));
  assert.ok(buildStationSheet({ net: kjNetwork(), health: OK_HEALTH, stationId: 'kajang', now: myt(7), clock }));
});
