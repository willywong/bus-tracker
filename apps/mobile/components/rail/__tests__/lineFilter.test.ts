import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Test-only: the 2026-10-23 rail and KTM fixtures, compiled as the app does, for the route ids.
import { compileNetworkSync } from '../../../../../packages/shared/src/transit/compile';
import { readFeed } from '../../../../../packages/shared/src/transit/feeds';

import { interchangeIds } from '../diagram/geometry';
import {
  DIAGRAM_LINES,
  DIAGRAM_LINKS,
  DIAGRAM_SIZE,
  DIAGRAM_STATIONS,
  GRID,
} from '../diagram/klRailDiagram';
import {
  fitWithLabels,
  LABEL_FULL_SCALE,
  labelStep,
  placeLabels,
  visibleRect,
} from '../diagram/labels';
import {
  ALL_LINES,
  chipBadge,
  chipName,
  labelRect,
  lineShown,
  mixHex,
  routeIdOfLine,
  selectionBounds,
  shownStations,
  toggleLine,
} from '../diagram/lineFilter';
import { FIT_MAX_SCALE, fitRectTransform, fitTransform } from '../diagram/viewport';

const FIXTURES = new URL(
  '../../../../../packages/shared/src/transit/__fixtures__/2026-10-23/',
  import.meta.url,
);
const INTERCHANGES = interchangeIds(DIAGRAM_LINES, DIAGRAM_LINKS);
const SIZE = { width: DIAGRAM_SIZE.width * GRID, height: DIAGRAM_SIZE.height * GRID };
const PHONE = { width: 375, height: 760, top: 56, bottom: 90 };

test('toggleLine picks and unpicks, and picking every line is all lines', () => {
  const kj = toggleLine(ALL_LINES, 'LRT KJ', DIAGRAM_LINES.length);
  assert.deepEqual([...kj], ['LRT KJ']);
  assert.deepEqual([...toggleLine(kj, 'MRT KG', DIAGRAM_LINES.length)], ['LRT KJ', 'MRT KG']);
  assert.equal(toggleLine(kj, 'LRT KJ', DIAGRAM_LINES.length).size, 0);
  let sel = ALL_LINES;
  for (const l of DIAGRAM_LINES) sel = toggleLine(sel, l.code, DIAGRAM_LINES.length);
  assert.equal(sel.size, 0);
});

test('lineShown and shownStations: all lines when nothing is picked, else only the picked', () => {
  assert.ok(DIAGRAM_LINES.every((l) => lineShown(ALL_LINES, l.code)));
  const mr = new Set(['Monorail MR']);
  assert.ok(lineShown(mr, 'Monorail MR'));
  assert.ok(!lineShown(mr, 'LRT KJ'));
  const ids = shownStations(mr, DIAGRAM_LINES);
  assert.ok(ids.has('titiwangsa') && ids.has('kl-sentral'));
  assert.ok(!ids.has('gombak'));
  assert.equal(shownStations(ALL_LINES, DIAGRAM_LINES).size, DIAGRAM_STATIONS.length);
});

test('selectionBounds holds every picked station and its name, and fits inside the drawing', () => {
  for (const line of DIAGRAM_LINES) {
    const sel = new Set([line.code]);
    const r = selectionBounds(sel, DIAGRAM_STATIONS, DIAGRAM_LINES, GRID)!;
    for (const id of shownStations(sel, DIAGRAM_LINES)) {
      const s = DIAGRAM_STATIONS.find((x) => x.id === id)!;
      assert.ok(s.x * GRID >= r.x && s.x * GRID <= r.x + r.width, `${line.code}: ${id} x`);
      assert.ok(s.y * GRID >= r.y && s.y * GRID <= r.y + r.height, `${line.code}: ${id} y`);
      const l = labelRect(s, GRID);
      if (l)
        assert.ok(
          l.x >= r.x - 1e-9 && l.x + l.width <= r.x + r.width + 1e-9,
          `${line.code}: ${id} label`,
        );
    }
    assert.ok(r.width < SIZE.width && r.height < SIZE.height, line.code);
  }
});

test('fitRectTransform frames a line between the whole-network fit and FIT_MAX_SCALE', () => {
  const whole = fitTransform(SIZE, PHONE).scale;
  for (const line of DIAGRAM_LINES) {
    const r = selectionBounds(new Set([line.code]), DIAGRAM_STATIONS, DIAGRAM_LINES, GRID)!;
    const t = fitRectTransform(r, SIZE, PHONE);
    assert.ok(t.scale >= whole - 1e-9 && t.scale <= FIT_MAX_SCALE + 1e-9, line.code);
    // The box's centre lands in the middle of the uncovered view.
    const cx = t.x + (r.x + r.width / 2) * t.scale;
    const cy = t.y + (r.y + r.height / 2) * t.scale;
    assert.ok(Math.abs(cx - PHONE.width / 2) < 1, `${line.code} x ${cx}`);
    assert.ok(
      Math.abs(cy - (PHONE.top + (PHONE.height - PHONE.top - PHONE.bottom) / 2)) < 1,
      `${line.code} y`,
    );
  }
});

test('labelStep: 0.9 at and above, then steps of 1.25 that never exceed the scale', () => {
  assert.equal(labelStep(1), LABEL_FULL_SCALE);
  assert.equal(labelStep(3), LABEL_FULL_SCALE);
  assert.equal(labelStep(0.9), LABEL_FULL_SCALE);
  assert.ok(Math.abs(labelStep(0.72) - 0.72) < 1e-9);
  for (let s = 0.15; s < 0.9; s += 0.013) {
    const step = labelStep(s);
    assert.ok(step <= s + 1e-9 && step * 1.25 > s - 1e-9, `${s} → ${step}`);
  }
});

test('placeLabels names every labelled station at full scale, hand-placed and 11 pt', () => {
  const labels = placeLabels(
    DIAGRAM_STATIONS,
    DIAGRAM_LINES,
    INTERCHANGES,
    ALL_LINES,
    LABEL_FULL_SCALE,
    GRID,
  );
  assert.equal(labels.length, DIAGRAM_STATIONS.filter((s) => s.label).length);
  const pasarSeni = labels.find((l) => l.id === 'pasar-seni')!;
  assert.equal(pasarSeni.fontSize, 11);
  assert.ok(pasarSeni.bold);
  assert.equal(pasarSeni.x, 51 * GRID + 8);
});

test('placeLabels zoomed out: names stay about 10 pt on screen, never overlap, interchanges first', () => {
  for (const step of [labelStep(0.5), labelStep(0.3)]) {
    const labels = placeLabels(
      DIAGRAM_STATIONS,
      DIAGRAM_LINES,
      INTERCHANGES,
      ALL_LINES,
      step,
      GRID,
    );
    assert.ok(labels.length > 0 && labels.length < DIAGRAM_STATIONS.length);
    for (const l of labels) assert.ok(Math.abs(l.fontSize * step - 11 * LABEL_FULL_SCALE) < 1e-9);
    const k = LABEL_FULL_SCALE / step;
    const boxes = labels.map((l) => {
      const s = DIAGRAM_STATIONS.find((x) => x.id === l.id)!;
      const r = labelRect(s, GRID)!;
      const [cx, cy] = [s.x * GRID, s.y * GRID];
      return {
        id: l.id,
        x: cx + (r.x - cx) * k,
        y: cy + (r.y - cy) * k,
        w: r.width * k,
        h: r.height * k,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!hit, `${a.id} overlaps ${b.id} at ${step}`);
      }
    }
    // Interchanges win their space: KL Sentral and Masjid Jamek always keep their names.
    assert.ok(labels.some((l) => l.id === 'kl-sentral'));
    assert.ok(labels.some((l) => l.id === 'masjid-jamek'));
  }
});

test('placeLabels with a line picked names only its stations', () => {
  const sel = new Set(['LRT KJ']);
  const kj = shownStations(sel, DIAGRAM_LINES);
  const full = placeLabels(
    DIAGRAM_STATIONS,
    DIAGRAM_LINES,
    INTERCHANGES,
    sel,
    LABEL_FULL_SCALE,
    GRID,
  );
  assert.ok(full.every((l) => kj.has(l.id)));
  assert.equal(full.length, DIAGRAM_STATIONS.filter((s) => s.label && kj.has(s.id)).length);
  // Both ends of the line stay named when zoomed out to fit it.
  const out = placeLabels(
    DIAGRAM_STATIONS,
    DIAGRAM_LINES,
    INTERCHANGES,
    sel,
    labelStep(0.36),
    GRID,
  );
  assert.ok(out.some((l) => l.id === 'gombak'));
  assert.ok(out.some((l) => l.id === 'putra-heights'));
});

test('mixHex fades toward paper', () => {
  assert.equal(mixHex('#D50032', '#FFFFFF', 0), '#D50032');
  assert.equal(mixHex('#D50032', '#FFFFFF', 1), '#FFFFFF');
  assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080');
});

test('chip badges and names', () => {
  const by = new Map(DIAGRAM_LINES.map((l) => [l.code, l]));
  assert.equal(chipBadge(by.get('LRT KJ')!), 'KJ');
  assert.equal(chipBadge(by.get('BRT')!), 'BRT');
  assert.equal(chipBadge(by.get('KTM Seremban')!), 'KTM');
  assert.equal(chipName(by.get('LRT KJ')!), 'Kelana Jaya');
  assert.equal(chipName(by.get('Monorail MR')!), 'Monorail');
  assert.equal(chipName(by.get('KTM Port Klang')!), 'Port Klang');
});

test('every diagram line opens a network route', () => {
  const meta = (validUntil: string) => ({ fetchedAt: 1, hash: 'h', validUntil, included: true });
  const rail = readFeed(
    new Uint8Array(readFileSync(new URL('rapid-rail-kl.zip', FIXTURES))),
    'rail',
  );
  const ktm = readFeed(new Uint8Array(readFileSync(new URL('ktmb.zip', FIXTURES))), 'ktm');
  const net = compileNetworkSync(
    {
      rail: { data: rail, meta: meta(rail.validUntil) },
      ktm: { data: ktm, meta: meta(ktm.validUntil) },
    },
    '20261028',
    { builtAt: 0 },
  );
  const ids = DIAGRAM_LINES.map((l) => routeIdOfLine(net.routes, l.code));
  assert.ok(
    ids.every((id) => id !== null),
    JSON.stringify(ids),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(routeIdOfLine(net.routes, 'LRT SP'), 'rail:PH');
  assert.ok(routeIdOfLine(net.routes, 'KTM Seremban')!.startsWith('ktm:'));
});

test('worklets come after every worklet they call (they capture callees when the module loads)', () => {
  for (const file of ['../diagram/viewport.ts', '../diagram/labels.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const fns = [...src.matchAll(/^export function (\w+)\(/gm)].map((m) => ({
      name: m[1],
      at: m.index!,
    }));
    for (const [i, fn] of fns.entries()) {
      const body = src.slice(fn.at, fns[i + 1]?.at ?? src.length);
      if (!body.includes("'worklet'")) continue;
      for (const later of fns.slice(i + 1)) {
        assert.ok(
          !new RegExp(`\\b${later.name}\\(`).test(body),
          `${file}: ${fn.name} calls ${later.name}, declared after it`,
        );
      }
    }
  }
});

test('a fit keeps every placed name on screen, flipping or dropping those at the edge', () => {
  const views = [PHONE, { width: 440, height: 900, top: 56, bottom: 90 }];
  const picks = [
    [] as string[],
    ...DIAGRAM_LINES.map((l) => [l.code]),
    ['LRT KJ', 'LRT SP'],
    ['MRT KG', 'MRT PY'],
  ];
  for (const view of views) {
    for (const codes of picks) {
      const sel = new Set(codes);
      const t =
        codes.length === 0
          ? fitTransform(SIZE, view)
          : fitWithLabels(sel, DIAGRAM_STATIONS, DIAGRAM_LINES, GRID, SIZE, view)!;
      const step = labelStep(t.scale);
      const frame = visibleRect(t, view);
      const placed = placeLabels(
        DIAGRAM_STATIONS,
        DIAGRAM_LINES,
        INTERCHANGES,
        sel,
        step,
        GRID,
        frame,
      );
      const where = `${codes.join('+') || 'all'} at ${view.width}`;
      assert.ok(placed.length > 0, where);
      for (const l of placed) {
        // The drawn box, from the label itself: 6.4 pt a glyph, 9 pt up and 3 down, at its size.
        const k = l.fontSize / 11;
        const w = l.name.length * 6.4 * k;
        const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
        const sx0 = t.x + x0 * t.scale;
        const sx1 = t.x + (x0 + w) * t.scale;
        const sy0 = t.y + (l.y - 9 * k) * t.scale;
        const sy1 = t.y + (l.y + 3 * k) * t.scale;
        assert.ok(
          sx0 >= 0 && sx1 <= view.width,
          `${where}: ${l.id} x ${sx0.toFixed(0)}–${sx1.toFixed(0)}`,
        );
        assert.ok(sy0 >= view.top && sy1 <= view.height - view.bottom, `${where}: ${l.id} y`);
      }
    }
  }
});

test('a name past the frame flips to the other side of its station', () => {
  // Masjid Jamek's name sits to its left; a frame starting just left of the station flips it right.
  const mj = DIAGRAM_STATIONS.find((s) => s.id === 'masjid-jamek')!;
  const frame = { x: mj.x * GRID - 20, y: 0, width: 2000, height: 2000 };
  const placed = placeLabels(
    DIAGRAM_STATIONS,
    DIAGRAM_LINES,
    INTERCHANGES,
    ALL_LINES,
    1,
    GRID,
    frame,
  );
  const l = placed.find((p) => p.id === 'masjid-jamek')!;
  assert.equal(mj.label!.anchor, 'end');
  assert.equal(l.anchor, 'start');
  assert.ok(l.x > mj.x * GRID);
  // Nothing placed starts left of the frame.
  assert.ok(!placed.some((p) => p.anchor === 'end' && p.x - p.name.length * 6.4 < frame.x - 1e-9));
});
