import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Itinerary } from '@bus-tracker/shared';

import { HOME_PLAN_MAX_AGE_MS, homeLineOf, shouldReplanHome, type LastHomePlan } from '../homePlan';

const MIN = 60_000;
/** 2026-10-23 17:40 MYT. */
const NOW = Date.UTC(2026, 9, 23, 9, 40);
const OFFICE = { lat: 3.1589, lng: 101.7133 };
const HOME = { lat: 3.05, lng: 101.58 };
/** About 300 m north of the office. */
const NEAR_OFFICE = { lat: 3.1616, lng: 101.7133 };
/** About 1.1 km north of the office. */
const FAR_FROM_OFFICE = { lat: 3.1689, lng: 101.7133 };

const last = (over: Partial<LastHomePlan> = {}): LastHomePlan => ({
  plannedAt: NOW - 5 * MIN,
  from: OFFICE,
  home: HOME,
  leaveMs: NOW + 6 * MIN,
  ...over,
});

test('first plan, then kept while fresh and nearby', () => {
  assert.equal(shouldReplanHome(null, NOW, OFFICE, HOME), 'plan');
  assert.equal(shouldReplanHome(last(), NOW, OFFICE, HOME), 'keep');
  assert.equal(shouldReplanHome(last(), NOW, NEAR_OFFICE, HOME), 'keep');
});

test('replans when old, past its leave time, or after a move', () => {
  assert.equal(shouldReplanHome(last({ plannedAt: NOW - HOME_PLAN_MAX_AGE_MS - 1 }), NOW, OFFICE, HOME), 'plan');
  assert.equal(shouldReplanHome(last({ leaveMs: NOW - MIN }), NOW, OFFICE, HOME), 'plan');
  assert.equal(shouldReplanHome(last(), NOW, FAR_FROM_OFFICE, HOME), 'plan');
  // Home moved.
  assert.equal(shouldReplanHome(last(), NOW, OFFICE, { lat: 3.06, lng: 101.58 }), 'plan');
});

test('a plan with no way home waits out its age', () => {
  assert.equal(shouldReplanHome(last({ leaveMs: 0 }), NOW, OFFICE, HOME), 'keep');
  assert.equal(shouldReplanHome(last({ leaveMs: 0, plannedAt: NOW - 16 * MIN }), NOW, OFFICE, HOME), 'plan');
});

test('no line near home, without a fix or without a Home', () => {
  assert.equal(shouldReplanHome(null, NOW, { lat: 3.052, lng: 101.58 }, HOME), 'clear');
  assert.equal(shouldReplanHome(last(), NOW, null, HOME), 'clear');
  assert.equal(shouldReplanHome(last(), NOW, OFFICE, null), 'clear');
  assert.equal(shouldReplanHome(null, NOW, { lat: Number.NaN, lng: Number.NaN }, HOME), 'clear');
});

test('the line is the best itinerary on the wall clock', () => {
  const it = { departAt: NOW + 6 * MIN, arriveAt: NOW + 40 * MIN } as Itinerary;
  assert.deepEqual(homeLineOf(it, 'Home'), { label: 'Home', leaveMs: NOW + 6 * MIN, arriveMs: NOW + 40 * MIN });
  assert.deepEqual(homeLineOf(it, 'Home', 60 * MIN), { label: 'Home', leaveMs: NOW - 54 * MIN, arriveMs: NOW - 20 * MIN });
  assert.equal(homeLineOf(undefined, 'Home'), null);
});
