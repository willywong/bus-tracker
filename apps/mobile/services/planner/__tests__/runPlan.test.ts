import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runPlan } from '../runPlan';

/** A manual scheduler and a clock that each step advances by `stepMs`. */
function harness(stepMs: number) {
  let t = 0;
  const queue: (() => void)[] = [];
  return {
    clock: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    schedule: (cb: () => void) => {
      queue.push(cb);
      return cb;
    },
    cancelSchedule: (h: unknown) => {
      const i = queue.indexOf(h as () => void);
      if (i >= 0) queue.splice(i, 1);
    },
    /** Runs one queued slice; false when none is queued. */
    turn: () => {
      const cb = queue.shift();
      if (!cb) return false;
      cb();
      return true;
    },
    stepMs,
  };
}

function* counted(steps: number, onStep: () => void): Generator<void, string, void> {
  for (let i = 0; i < steps; i++) {
    onStep();
    yield;
  }
  return 'done';
}

test('steps in slices and resolves the final value', async () => {
  const h = harness(1);
  let stepped = 0;
  const run = runPlan(counted(20, () => (stepped++, h.advance(1))), { sliceMs: 8, now: h.clock, schedule: h.schedule, cancelSchedule: h.cancelSchedule });
  assert.equal(stepped, 0, 'nothing runs before the first turn');
  let turns = 0;
  while (h.turn()) turns++;
  assert.equal(await run.promise, 'done');
  assert.equal(stepped, 20);
  assert.equal(turns, 3);
});

test('cancel stops stepping and resolves null', async () => {
  const h = harness(1);
  let stepped = 0;
  let closed = false;
  function* gen(): Generator<void, string, void> {
    try {
      for (;;) {
        stepped++;
        h.advance(1);
        yield;
      }
    } finally {
      closed = true;
    }
  }
  const run = runPlan(gen(), { sliceMs: 8, now: h.clock, schedule: h.schedule, cancelSchedule: h.cancelSchedule });
  h.turn();
  const after = stepped;
  run.cancel();
  assert.equal(h.turn(), false, 'no slice is left queued');
  assert.equal(stepped, after);
  assert.equal(closed, true, 'the generator was closed');
  assert.equal(await run.promise, null);
  run.cancel(); // idempotent
});

test('a slice never exceeds sliceMs on a fake clock', async () => {
  const h = harness(1);
  const slices: number[] = [];
  let sliceStart = 0;
  const run = runPlan(counted(50, () => h.advance(h.stepMs)), {
    sliceMs: 8,
    now: h.clock,
    schedule: (cb) => h.schedule(() => {
      sliceStart = h.clock();
      cb();
      slices.push(h.clock() - sliceStart);
    }),
    cancelSchedule: h.cancelSchedule,
  });
  while (h.turn());
  assert.equal(await run.promise, 'done');
  assert.ok(slices.length >= 6);
  assert.ok(slices.every((ms) => ms <= 8), `slices ${slices.join(',')}`);
});

test('a throwing generator rejects', async () => {
  const h = harness(1);
  function* bad(): Generator<void, string, void> {
    yield;
    throw new Error('boom');
  }
  const run = runPlan(bad(), { now: h.clock, schedule: h.schedule, cancelSchedule: h.cancelSchedule });
  while (h.turn());
  await assert.rejects(run.promise, /boom/);
});
