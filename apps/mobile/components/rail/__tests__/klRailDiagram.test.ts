import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RAIL_LINES, RAIL_STATIONS, type TransitNetwork } from '@bus-tracker/shared';

// Test-only: the 2026-10-23 rail and KTM fixtures, compiled as the app does,
// for the KTM station ids and the order trains call at them.
import { compileNetworkSync } from '../../../../../packages/shared/src/transit/compile';
import { readFeed } from '../../../../../packages/shared/src/transit/feeds';

import { interchangeIds, linesByStation } from '../diagram/geometry';
import { nearestStation, TAP_RADIUS } from '../diagram/hitTest';
import { DIAGRAM_LINES, DIAGRAM_LINKS, DIAGRAM_STATIONS, GRID } from '../diagram/klRailDiagram';

const FIXTURES = new URL('../../../../../packages/shared/src/transit/__fixtures__/2026-10-23/', import.meta.url);

let net: TransitNetwork | null = null;
/** Rail and KTM only: the KTM ids don't depend on the bus feeds. */
function railNetwork(): TransitNetwork {
  if (net) return net;
  const meta = (validUntil: string) => ({ fetchedAt: 1, hash: 'h', validUntil, included: true });
  const rail = readFeed(new Uint8Array(readFileSync(new URL('rapid-rail-kl.zip', FIXTURES))), 'rail');
  const ktm = readFeed(new Uint8Array(readFileSync(new URL('ktmb.zip', FIXTURES))), 'ktm');
  net = compileNetworkSync(
    { rail: { data: rail, meta: meta(rail.validUntil) }, ktm: { data: ktm, meta: meta(ktm.validUntil) } },
    '20261028',
    { builtAt: 0 },
  );
  return net;
}

const at = new Map(DIAGRAM_STATIONS.map((s) => [s.id, s]));

/** Every consecutive pair on every branch. */
function segments() {
  return DIAGRAM_LINES.flatMap((line) =>
    line.branches.flatMap((b) => b.slice(1).map((id, i) => ({ line: line.code, a: at.get(b[i])!, b: at.get(id)! }))),
  );
}

/** A Rapid KL line's station ids in stop-code order ("KG18A" after "KG17"). */
function codeOrder(code: string): string[] {
  const prefix = code.split(' ').pop()!;
  const seq: { n: number; suffix: string; id: string }[] = [];
  for (const s of RAIL_STATIONS) {
    for (const stop of s.stopIds) {
      const m = /^([A-Z]+)(\d+)([A-Z]?)$/.exec(stop);
      if (m && m[1] === prefix) seq.push({ n: Number(m[2]), suffix: m[3], id: s.id });
    }
  }
  return seq.sort((x, y) => x.n - y.n || x.suffix.localeCompare(y.suffix)).map((x) => x.id);
}

test('every segment is octilinear (dx = 0, dy = 0 or |dx| = |dy|)', () => {
  const segs = segments();
  assert.ok(segs.length > 200);
  for (const { line, a, b } of segs) {
    assert.ok(a && b, `${line}: unknown station on a branch`);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    assert.ok(dx !== 0 || dy !== 0, `${line}: ${a.id} → ${b.id} has no length`);
    assert.ok(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy), `${line}: ${a.id} → ${b.id} is (${dx}, ${dy})`);
  }
});

test('every RAIL_STATIONS id appears exactly once', () => {
  const counts = new Map<string, number>();
  for (const s of DIAGRAM_STATIONS) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  for (const s of RAIL_STATIONS) assert.equal(counts.get(s.id), 1, s.id);
  // KTM stations too, and nothing else.
  for (const [id, n] of counts) {
    assert.equal(n, 1, `${id} placed ${n} times`);
    assert.ok(id.startsWith('ktm-') || RAIL_STATIONS.some((s) => s.id === id), `${id} is not a station`);
  }
  // Rapid KL names match the station sheet's.
  for (const s of RAIL_STATIONS) assert.equal(at.get(s.id)!.name, s.name);
});

test('every line branch uses known station ids in RAIL_STATIONS code order', () => {
  // The eight Rapid KL lines, each as one branch in stop-code order.
  for (const line of RAIL_LINES) {
    const d = DIAGRAM_LINES.find((l) => l.code === line.code);
    assert.ok(d, `${line.code} is drawn`);
    assert.equal(d.color, line.color, `${line.code} keeps its official colour`);
    assert.deepEqual(d.branches, [codeOrder(line.code)], line.code);
  }

  // KTM: the network's ids, in the order its longest pattern calls at them.
  const n = railNetwork();
  const ktmIds = new Set(n.stations.filter((s) => s.id.startsWith('ktm-')).map((s) => s.id));
  const ktmLines = DIAGRAM_LINES.filter((l) => !RAIL_LINES.some((r) => r.code === l.code));
  assert.deepEqual(ktmLines.map((l) => l.code).sort(), ['KTM Port Klang', 'KTM Seremban']);
  for (const line of ktmLines) {
    let longest: string[] = [];
    for (let p = 0; p < n.patterns.count; p++) {
      if (n.routes.label[n.patterns.route[p]] !== line.code) continue;
      const ids: string[] = [];
      for (let k = 0; k < n.patterns.stopLen[p]; k++) {
        ids.push(n.stations[n.stops.station[n.patterns.stops[n.patterns.stopStart[p] + k]]].id);
      }
      if (ids.length > longest.length) longest = ids;
    }
    assert.equal(line.branches.length, 1, line.code);
    const [branch] = line.branches;
    for (const id of branch) assert.ok(ktmIds.has(id), `${line.code}: ${id} is a KTM station`);
    const forward = branch.join(' ') === longest.join(' ');
    const backward = branch.join(' ') === [...longest].reverse().join(' ');
    assert.ok(forward || backward, `${line.code} runs ${longest.join(' ')}`);
  }
  // Every KTM station in the box is drawn.
  for (const id of ktmIds) assert.ok(at.has(id), `${id} is drawn`);
});

test('no two stations closer than one grid unit', () => {
  for (let i = 0; i < DIAGRAM_STATIONS.length; i++) {
    for (let j = i + 1; j < DIAGRAM_STATIONS.length; j++) {
      const a = DIAGRAM_STATIONS[i];
      const b = DIAGRAM_STATIONS[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 1, `${a.id} and ${b.id}`);
    }
  }
});

test('nearestStation returns the closest id within 22 / scale and null beyond', () => {
  const mj = at.get('masjid-jamek')!;
  const x = mj.x * GRID;
  const y = mj.y * GRID;
  // On the point, and anywhere inside the 44 pt target at scale 1.
  assert.equal(nearestStation(x, y, 1), 'masjid-jamek');
  assert.equal(nearestStation(x + 21.9, y, 1), 'masjid-jamek');
  assert.equal(nearestStation(x - 15, y + 15, 1), 'masjid-jamek');
  // Masjid Jamek has nothing else within 2 grid units, so just past 22 pt is nothing.
  assert.equal(nearestStation(x + 22.1, y, 1), null);
  // The radius is screen points: 11 diagram points at 2×, 88 at 0.25×.
  assert.equal(nearestStation(x + 10.9, y, 2), 'masjid-jamek');
  assert.equal(nearestStation(x + 11.1, y, 2), null);
  // (West, where the nearest other station, Bank Negara on KTM, is over 90 points away.)
  assert.equal(nearestStation(x - 87, y, 0.25), 'masjid-jamek');
  assert.equal(nearestStation(x - TAP_RADIUS * 4 - 1, y, 0.25), null);
  // Between two stations the closer one wins: KL Sentral and its KTM station, 2 units apart.
  const kl = at.get('kl-sentral')!;
  const ktm = at.get('ktm-kl-sentral')!;
  const mx = ((kl.x + ktm.x) / 2) * GRID;
  const my = ((kl.y + ktm.y) / 2) * GRID;
  const toward = (s: typeof kl) => ({ x: mx + (s.x * GRID - mx) * 0.1, y: my + (s.y * GRID - my) * 0.1 });
  const k1 = toward(kl);
  const k2 = toward(ktm);
  assert.equal(nearestStation(k1.x, k1.y, 1), 'kl-sentral');
  assert.equal(nearestStation(k2.x, k2.y, 1), 'ktm-kl-sentral');
  // Far from everything.
  assert.equal(nearestStation(-500, -500, 1), null);
});

test('no line passes over a station it does not call at', () => {
  const served = linesByStation(DIAGRAM_LINES);
  for (const { line, a, b } of segments()) {
    for (const s of DIAGRAM_STATIONS) {
      if (s.id === a.id || s.id === b.id || served.get(s.id)?.includes(line)) continue;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((s.x - a.x) * vx + (s.y - a.y) * vy) / (vx * vx + vy * vy)));
      const d = Math.hypot(s.x - (a.x + t * vx), s.y - (a.y + t * vy));
      assert.ok(d >= 0.7, `${line} ${a.id} → ${b.id} runs over ${s.id}`);
    }
  }
});

test('walking links join neighbouring stations, and every station but a linked twin is named', () => {
  const linked = new Set(DIAGRAM_LINKS.flat());
  for (const [a, b] of DIAGRAM_LINKS) {
    const p = at.get(a)!;
    const q = at.get(b)!;
    assert.ok(p && q, `${a} – ${b}`);
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= 4, `${a} – ${b} are neighbours`);
  }
  for (const s of DIAGRAM_STATIONS) {
    assert.ok(s.label || linked.has(s.id), `${s.id} has a label`);
  }
  const interchanges = interchangeIds(DIAGRAM_LINES, DIAGRAM_LINKS);
  for (const id of ['masjid-jamek', 'kl-sentral', 'chan-sow-lin', 'titiwangsa', 'putra-heights', 'ktm-putra']) {
    assert.ok(interchanges.has(id), `${id} is an interchange`);
  }
  // A stop on the shared AG/SP trunk isn't one.
  assert.ok(!interchanges.has('sultan-ismail'));
});
