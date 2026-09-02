import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimHash,
  canonicalEventId,
  sevenDayAnomalyVsPrior90,
  beneficiaryMateriality,
  alphaEligibility
} from '../src/leadtime.js';

test('claim hash is deterministic', () => {
  assert.equal(claimHash('same claim'), claimHash('same claim'));
  assert.notEqual(claimHash('same claim'), claimHash('different claim'));
});

test('event id is canonical across case/spacing', () => {
  const a = canonicalEventId({ lane: 'stock', entity: ' IREN ', eventType: 'purchase commitment', eventDate: '2026-08-26' });
  const b = canonicalEventId({ lane: 'STOCK', entity: 'iren', eventType: 'PURCHASE COMMITMENT', eventDate: '2026-08-26' });
  assert.equal(a, b);
});

test('7d anomaly requires 90 baseline days plus 7 current days', () => {
  const result = sevenDayAnomalyVsPrior90(Array(96).fill(100));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NEED_97_DAILY_OBSERVATIONS');
});

test('7d window dilutes a one-day spike into the weekly mean', () => {
  const baseline = Array.from({ length: 90 }, (_, i) => 100 + (i % 9));
  const current = [100, 101, 99, 102, 100, 101, 300];
  const result = sevenDayAnomalyVsPrior90([...baseline, ...current]);
  assert.equal(result.valid, true);
  assert.ok(result.current7dMean < 300);
  assert.ok(result.current7dMean > 100);
});

test('persistent 7d acceleration creates stronger anomaly than one-day spike', () => {
  const baseline = Array.from({ length: 90 }, (_, i) => 100 + (i % 9));
  const oneDay = sevenDayAnomalyVsPrior90([...baseline, 100, 101, 99, 102, 100, 101, 300]);
  const sustained = sevenDayAnomalyVsPrior90([...baseline, 190, 200, 205, 195, 210, 200, 205]);
  assert.equal(sustained.valid, true);
  assert.ok(sustained.zScore > oneDay.zScore);
});

test('beneficiary materiality quantifies relationship versus total and segment revenue without hard-coded pass threshold', () => {
  const result = beneficiaryMateriality({ relationshipAmountUsd: 1.8e9, beneficiaryRevenueUsd: 90e9, beneficiarySegmentRevenueUsd: 12e9 });
  assert.equal(result.ratioTotalRevenue, 0.02);
  assert.equal(result.ratioSegmentRevenue, 0.15);
});

test('web-read snapshot is never alpha eligible', () => {
  const result = alphaEligibility({
    backfilled: false,
    methodologyActivatedTs: '2026-09-01T20:00:00Z',
    firstSightTs: '2026-09-01T20:01:00Z',
    snapshot: { sourceKind: 'WEB_READ', status: 'FULL', capturedTs: '2026-09-01T20:02:00Z' }
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'NON_MACHINE_SNAPSHOT');
});

test('machine snapshot within five minutes of sight is alpha eligible', () => {
  const result = alphaEligibility({
    backfilled: false,
    methodologyActivatedTs: '2026-09-01T20:00:00Z',
    firstSightTs: '2026-09-01T20:01:00Z',
    snapshot: { sourceKind: 'API', status: 'PARTIAL', capturedTs: '2026-09-01T20:03:00Z' }
  });
  assert.deepEqual(result, { eligible: true, reason: 'ELIGIBLE' });
});

test('late reconstructed snapshot cannot earn alpha credit', () => {
  const result = alphaEligibility({
    backfilled: false,
    methodologyActivatedTs: '2026-09-01T20:00:00Z',
    firstSightTs: '2026-09-01T20:01:00Z',
    snapshot: { sourceKind: 'API', status: 'FULL', capturedTs: '2026-09-01T21:00:00Z' }
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'SNAPSHOT_NOT_AT_SIGHT');
});
