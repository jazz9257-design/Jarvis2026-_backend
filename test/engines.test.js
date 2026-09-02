import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJarvis } from '../src/engines/jarvis.js';
import { evaluateRecognition, evaluateExecution } from '../src/engines/argus.js';
import { evaluateSentinel } from '../src/engines/sentinel.js';
import { evaluateVcJarvis } from '../src/engines/vcJarvis.js';
import { buildCommandCenter } from '../src/engines/commandCenter.js';

const stockSighting = { lane: 'STOCK', evidence_tier: 'REPORTED' };

test('JARVIS stock stays yellow without beneficiary resolution', () => {
  const r = evaluateJarvis({ sighting: stockSighting });
  assert.equal(r.state, 'YELLOW');
});

test('JARVIS stock rejects materiality failure', () => {
  const r = evaluateJarvis({ sighting: stockSighting, beneficiaryResolution: { materiality_status: 'FAIL' } });
  assert.equal(r.state, 'RED');
});

test('JARVIS stock green requires reported evidence and materiality pass', () => {
  const r = evaluateJarvis({ sighting: stockSighting, beneficiaryResolution: { materiality_status: 'PASS' } });
  assert.equal(r.state, 'GREEN');
});

test('ARGUS recognition uses self-relative z-score', () => {
  const quiet = evaluateRecognition({ status: 'FULL', raw_payload: { recognitionMetrics: { current5dReturnZ: 0.2, current5dVolumeZ: 0.3 } } }, { yellowZ: 1, redZ: 2 });
  const warm = evaluateRecognition({ status: 'FULL', raw_payload: { recognitionMetrics: { current5dReturnZ: 1.3, current5dVolumeZ: 0.4 } } }, { yellowZ: 1, redZ: 2 });
  const hot = evaluateRecognition({ status: 'FULL', raw_payload: { recognitionMetrics: { current5dReturnZ: 2.4, current5dVolumeZ: 0.4 } } }, { yellowZ: 1, redZ: 2 });
  assert.equal(quiet.state, 'GREEN');
  assert.equal(warm.state, 'YELLOW');
  assert.equal(hot.state, 'RED');
});

test('ARGUS execution never turns green without setup and 3:1', () => {
  const recognition = { state: 'GREEN' };
  assert.equal(evaluateExecution({ recognition }).state, 'YELLOW');
  assert.equal(evaluateExecution({ recognition, setup: { valid: true }, rewardRisk: 2.5 }).state, 'RED');
  assert.equal(evaluateExecution({ recognition, setup: { valid: true }, rewardRisk: 3 }).state, 'GREEN');
});

test('Sentinel crypto requires safety evidence and honors veto', () => {
  const sighting = { lane: 'CRYPTO' };
  assert.equal(evaluateSentinel({ sighting, riskEvidence: {} }).state, 'YELLOW');
  assert.equal(evaluateSentinel({ sighting, riskEvidence: { vetoes: ['UNSAFE_CONTRACT'] } }).state, 'RED');
  assert.equal(evaluateSentinel({ sighting, riskEvidence: {
    contractVerified: true,
    liquidityQualityVerified: true,
    holderConcentrationReviewed: true,
    unlockRiskReviewed: true,
    vetoes: []
  } }).state, 'GREEN');
});

test('VC JARVIS surfaces low-attention capital-flow sightings', () => {
  const r = evaluateVcJarvis([{ sighting_id: '1', entity: 'X', venue_attention: 'LOW', claim_text: 'strategic investment and capacity expansion', venue: 'EDGAR_FTS', evidence_tier: 'PRECURSOR', first_sight_ts: 'now' }]);
  assert.equal(r.state, 'GREEN');
  assert.equal(r.candidates.length, 1);
});

test('Command Center separates engine health from opportunity', () => {
  const r = buildCommandCenter({ evaluations: [], vc: { candidates: [] }, scanErrors: [] });
  assert.equal(r.engineHealth, 'GREEN');
  assert.equal(r.opportunity, 'YELLOW');
});
