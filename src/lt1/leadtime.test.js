import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSighting, claimHash, zAnomaly } from './leadtime.js';

test('makeSighting creates a prospective row without client first_sight_ts', () => {
  const row = makeSighting({ entity: 'IREN', tradable_ticker: 'DELL', venue: 'EDGAR_FTS', venue_url: 'https://www.sec.gov/x', claim_text: 'claim' });
  assert.equal(row.entity, 'IREN');
  assert.equal(row.tradable_ticker, 'DELL');
  assert.equal(row.backfilled, false);
  assert.equal(row.first_sight_ts, undefined);
  assert.equal(row.claim_hash, claimHash('claim'));
});

test('zAnomaly requires 97 observations by default', () => {
  const r = zAnomaly(Array(96).fill(1));
  assert.equal(r.valid, false);
  assert.equal(r.anomaly, false);
});

test('zAnomaly detects sustained acceleration', () => {
  const baseline = Array.from({ length: 90 }, (_, i) => 100 + (i % 11));
  const current = [190, 195, 200, 205, 210, 205, 200];
  const r = zAnomaly([...baseline, ...current]);
  assert.equal(r.valid, true);
  assert.ok(r.z > 2);
  assert.equal(r.anomaly, true);
});
