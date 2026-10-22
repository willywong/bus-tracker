import assert from 'node:assert/strict';
import test from 'node:test';

import { beadY, LOOKAHEAD_SEC, MAX_TRAINS, ROW_H, slotWindow, yAtRun } from '../stripLayout';

/** 40 stations, 2 min apart, beads at the default row height. */
const N = 40;
const offsets = Array.from({ length: N }, (_, i) => i * 120);
const ys = offsets.map((_, i) => beadY(i));
const total = offsets[N - 1];
/** A train every minute from 06:00 to 23:00. */
const runs = Array.from({ length: 17 * 60 + 1 }, (_, k) => 6 * 3600 + k * 60);
const t = 8 * 3600;

test('slotWindow never exceeds 12 slots', () => {
  // The whole strip in view: 78 trains on the line, 12 mounted.
  const all = slotWindow(runs, t, total, offsets, ys, 0, N * ROW_H);
  assert.equal(all.length, MAX_TRAINS);
  for (const view of [
    [0, 800],
    [600, 1400],
    [-500, 5000],
  ]) {
    assert.ok(slotWindow(runs, t, total, offsets, ys, view[0], view[1]).length <= MAX_TRAINS);
  }
});

test('slotWindow centres on the viewport', () => {
  const top = 15 * ROW_H;
  const bottom = 25 * ROW_H;
  const picked = slotWindow(runs, t, total, offsets, ys, top, bottom);
  assert.equal(picked.length, MAX_TRAINS);
  const centre = (top + bottom) / 2;
  const at = picked.map((i) => yAtRun(t - runs[i], offsets, ys));
  const mean = at.reduce((a, b) => a + b, 0) / at.length;
  assert.ok(Math.abs(mean - centre) < ROW_H, `mean ${mean} vs centre ${centre}`);
  // Every mounted train is in view ± one row now or within the lookahead.
  for (const i of picked) {
    const y0 = yAtRun(t - runs[i], offsets, ys);
    const y1 = yAtRun(t - runs[i] + LOOKAHEAD_SEC, offsets, ys);
    assert.ok(Math.max(y0, y1) >= top - ROW_H && Math.min(y0, y1) <= bottom + ROW_H);
  }
  // Ascending run indices, so React keys stay stable.
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
});

test('slotWindow mounts a train about to leave and skips the viewport it cannot reach', () => {
  // A sparse line: one train due in 10 s at the first bead, one on the line.
  const sparse = [t + 10, t - 600];
  assert.deepEqual(slotWindow(sparse, t, total, offsets, ys, 0, 4 * ROW_H), [0]);
  assert.deepEqual(slotWindow(sparse, t, total, offsets, ys, 0, 8 * ROW_H), [0, 1]);
  assert.deepEqual(slotWindow(sparse, t, total, offsets, ys, 30 * ROW_H, 38 * ROW_H), []);
});

test('beadY is ROW_H-spaced and centred', () => {
  assert.equal(beadY(0), ROW_H / 2);
  for (let i = 1; i < 10; i++) assert.equal(beadY(i) - beadY(i - 1), ROW_H);
});

test('yAtRun is linear within a segment and clamped at the ends', () => {
  const o = [0, 100, 400];
  const y = [10, 60, 110];
  assert.equal(yAtRun(-5, o, y), 10);
  assert.equal(yAtRun(50, o, y), 35);
  assert.equal(yAtRun(250, o, y), 85);
  assert.equal(yAtRun(999, o, y), 110);
});
