import assert from 'node:assert/strict';
import test from 'node:test';

import {
  centreOn,
  clampTransform,
  fitTransform,
  MAX_SCALE,
  MIN_SCALE,
  minScale,
  toDiagram,
  translateBounds,
  zoomAbout,
} from '../diagram/viewport';

const content = { width: 1800, height: 1476 };
/** An iPhone 16 sheet: 393 × 800, header 56, home indicator 34. */
const view = { width: 393, height: 800, top: 56, bottom: 34 };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('zoomAbout keeps the focal point still and holds the scale range', () => {
  const t = { scale: 1, x: -600, y: -300 };
  const focal = { x: 200, y: 400 };
  const under = toDiagram(t, focal.x, focal.y);
  const z = zoomAbout(t, 1.7, focal.x, focal.y, content, view, MIN_SCALE);
  assert.ok(near(z.scale, 1.7));
  const after = toDiagram(z, focal.x, focal.y);
  assert.ok(near(after.x, under.x) && near(after.y, under.y));
  assert.equal(zoomAbout(t, 10, focal.x, focal.y, content, view, MIN_SCALE).scale, MAX_SCALE);
  assert.equal(zoomAbout(t, 0.1, focal.x, focal.y, content, view, MIN_SCALE).scale, MIN_SCALE);
});

test('a quarter of the diagram, or of the screen, always stays in view', () => {
  for (const scale of [0.25, 0.6, 1, 4]) {
    const [lo, hi] = translateBounds(content.width, view.width, scale);
    const keep = Math.min(content.width * scale, view.width) / 4;
    // At either bound, the visible overlap is exactly `keep`.
    assert.ok(near(Math.min(lo + content.width * scale, view.width) - Math.max(lo, 0), keep));
    assert.ok(near(Math.min(hi + content.width * scale, view.width) - Math.max(hi, 0), keep));
  }
  const far = clampTransform({ scale: 1, x: 5000, y: -5000 }, content, view);
  assert.equal(far.x, view.width - view.width / 4);
  assert.equal(far.y, view.height / 4 - content.height);
});

test('fit shows the whole network in the uncovered view, below 0.6× on a phone', () => {
  const f = fitTransform(content, view);
  assert.ok(f.scale < MIN_SCALE);
  assert.equal(minScale(content, view), f.scale);
  assert.ok(f.x >= 0 && f.x + content.width * f.scale <= view.width);
  assert.ok(f.y >= view.top && f.y + content.height * f.scale <= view.height - view.bottom);
  // A big enough view needs no more than 0.6× as the floor.
  assert.equal(minScale(content, { width: 4000, height: 4000, top: 0, bottom: 0 }), MIN_SCALE);
});

test('centreOn puts the point mid-view', () => {
  const c = centreOn(900, 700, 1, content, view);
  assert.equal(c.x + 900, view.width / 2);
  assert.equal(c.y + 700, view.top + (view.height - view.top - view.bottom) / 2);
});
