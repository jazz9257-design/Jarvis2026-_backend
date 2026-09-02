import { runStockSourceScan } from './jobs/stockSourceScan.js';
import { runCryptoAnomalyScan } from './jobs/cryptoAnomalyScan.js';
import { runDecisionEngines } from './engines/decisionRunner.js';
import { buildCommandCenter } from './engines/commandCenter.js';
import { insertSystemRun } from './ledger.js';

function countStates(evaluations, field) {
  return evaluations.reduce((acc, row) => {
    const key = row[field] ?? 'UNMEASURED';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export async function runSystemUpdate(pool, { triggerType = 'MANUAL' } = {}) {
  const startedTs = new Date().toISOString();
  const results = {};
  const scanErrors = [];

  for (const [name, fn] of [
    ['stock_source_layer', () => runStockSourceScan(pool)],
    ['crypto_anomaly_layer', () => runCryptoAnomalyScan(pool)]
  ]) {
    try {
      results[name] = { status: 'SUCCESS', result: await fn() };
    } catch (error) {
      scanErrors.push({ engine: name, error: error.message });
      results[name] = { status: 'FAILED', error: error.message };
    }
  }

  let decisionResult = { evaluations: [], vc: null };
  try {
    decisionResult = await runDecisionEngines(pool);
    const evaluations = decisionResult.evaluations;
    results.jarvis_reasoner = {
      status: 'SUCCESS',
      evaluated: evaluations.length,
      states: countStates(evaluations, 'jarvis')
    };
    results.argus = {
      status: 'SUCCESS',
      recognition: countStates(evaluations, 'argusRecognition'),
      execution: countStates(evaluations, 'argusExecution')
    };
    results.sentinel = {
      status: 'SUCCESS',
      states: countStates(evaluations, 'sentinel')
    };
    results.vc_jarvis = {
      status: 'SUCCESS',
      result: decisionResult.vc
    };
  } catch (error) {
    scanErrors.push({ engine: 'decision_engines', error: error.message });
    results.jarvis_reasoner = { status: 'FAILED', error: error.message };
    results.argus = { status: 'FAILED', error: error.message };
    results.sentinel = { status: 'FAILED', error: error.message };
    results.vc_jarvis = { status: 'FAILED', error: error.message };
  }

  const commandCenter = buildCommandCenter({
    evaluations: decisionResult.evaluations,
    vc: decisionResult.vc,
    scanErrors
  });
  results.command_center = { status: 'SUCCESS', result: commandCenter };

  const finishedTs = new Date().toISOString();
  const complete = Object.values(results).every(x => x.status === 'SUCCESS');
  const response = {
    implementation: 'LT-1.0-CODE',
    startedTs,
    finishedTs,
    triggerType,
    complete,
    results,
    evaluations: decisionResult.evaluations
  };

  const persisted = await insertSystemRun(pool, response);
  return { ...response, runId: persisted.run_id };
}
