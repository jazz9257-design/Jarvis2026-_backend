import { runStockSourceScan } from './jobs/stockSourceScan.js';
import { runCryptoAnomalyScan } from './jobs/cryptoAnomalyScan.js';

export async function runSystemUpdate(pool) {
  const startedTs = new Date().toISOString();
  const results = {};

  for (const [name, fn] of [
    ['stock_source_layer', () => runStockSourceScan(pool)],
    ['crypto_anomaly_layer', () => runCryptoAnomalyScan(pool)]
  ]) {
    try {
      results[name] = { status: 'SUCCESS', result: await fn() };
    } catch (error) {
      results[name] = { status: 'FAILED', error: error.message };
    }
  }

  // These are intentionally explicit. They are not marked successful until executable
  // backend modules are actually bound and tested.
  results.jarvis_reasoner = { status: 'NOT_BOUND' };
  results.argus = { status: 'NOT_BOUND' };
  results.sentinel = { status: 'NOT_BOUND' };
  results.vc_jarvis = { status: 'NOT_BOUND' };

  const finishedTs = new Date().toISOString();
  return {
    implementation: 'LT-1.0-CODE',
    startedTs,
    finishedTs,
    complete: Object.values(results).every(x => x.status === 'SUCCESS'),
    results
  };
}
