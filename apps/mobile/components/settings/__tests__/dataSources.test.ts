import assert from 'node:assert/strict';
import test from 'node:test';

import { FEED_IDS, FEED_INFO, feedHealth, type FeedHealthInput, type NetworkHealth } from '@bus-tracker/shared';

import { DATA_CREDIT, dataSourceRows, formatYmd } from '../dataSources';

const TODAY = '20261023';
const health = (f: FeedHealthInput, today = TODAY) => feedHealth(f, today);
const ALL: NetworkHealth = {
  rail: health({ feed: 'rail', validFrom: '20190101', validUntil: '20261231', hasActiveServicesToday: true }),
  'bus-kl': health({ feed: 'bus-kl', validFrom: '20260101', validUntil: '20270331', hasActiveServicesToday: true }),
  feeder: health({ feed: 'feeder', validFrom: '20261020', validUntil: '20261109', hasActiveServicesToday: true }),
  ktm: health({ feed: 'ktm', validFrom: '20260818', validUntil: '20261106', hasActiveServicesToday: true }),
};

test('rows follow FEED_IDS order with labels', () => {
  const rows = dataSourceRows(ALL);
  assert.deepEqual(
    rows.map((r) => r.feed),
    [...FEED_IDS],
  );
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Rapid KL rail', 'Rapid KL bus', 'MRT feeder bus', 'KTM Komuter'],
  );
  assert.deepEqual(
    rows.map((r) => r.title),
    FEED_IDS.map((f) => FEED_INFO[f].label),
  );
  assert.deepEqual(rows[0], { feed: 'rail', title: 'Rapid KL rail', detail: 'Timetable to 31 Dec 2026', tone: 'normal' });
  assert.equal(rows[1]!.detail, 'Timetable to 31 Mar 2027');
});

test('expiring row is warning with end date', () => {
  const ktm = dataSourceRows(ALL)[3]!;
  assert.deepEqual(ktm, {
    feed: 'ktm',
    title: 'KTM Komuter',
    detail: 'Ends 6 Nov 2026 · check back for an update',
    tone: 'warning',
  });
});

test('expired row says not used for routes', () => {
  const rail = health(
    { feed: 'rail', validFrom: '20190101', validUntil: '20261231', hasActiveServicesToday: false },
    '20270102',
  );
  const row = dataSourceRows({ rail })[0]!;
  assert.equal(row.detail, 'Ended 31 Dec 2026 · not used for routes');
  assert.equal(row.tone, 'muted');
});

test('missing feed says not downloaded yet', () => {
  const rows = dataSourceRows({ rail: ALL.rail });
  assert.equal(rows.length, 4);
  for (const r of rows.slice(1)) {
    assert.equal(r.detail, 'Not downloaded yet');
    assert.equal(r.tone, 'muted');
  }
  assert.ok(dataSourceRows({}).every((r) => r.detail === 'Not downloaded yet'));
});

test('DATA_CREDIT is the CC BY 4.0 line', () => {
  assert.equal(DATA_CREDIT, 'Data: data.gov.my (Prasarana, KTMB), CC BY 4.0');
});

test('formatYmd is d MMM yyyy from the string alone', () => {
  assert.equal(formatYmd('20261106'), '6 Nov 2026');
  assert.equal(formatYmd('20270101'), '1 Jan 2027');
  assert.equal(formatYmd('20261231'), '31 Dec 2026');
  assert.equal(formatYmd(''), '');
});
