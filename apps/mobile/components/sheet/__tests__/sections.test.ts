import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentSection, parseSheetSection } from '../sections';

test('stored wins', () => {
  assert.equal(currentSection('saved', true), 'saved');
  assert.equal(currentSection('nearby', false), 'nearby');
});

test('no stored + route → nearby', () => {
  assert.equal(currentSection(null, true), 'nearby');
});

test('no stored + no route → plan', () => {
  assert.equal(currentSection(null, false), 'plan');
});

test('garbage parses to null', () => {
  assert.equal(parseSheetSection('tabs'), null);
  assert.equal(parseSheetSection(''), null);
  assert.equal(parseSheetSection(null), null);
  assert.equal(parseSheetSection('plan'), 'plan');
});
