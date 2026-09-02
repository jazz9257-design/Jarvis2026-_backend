import { fetchProtocolDailyFees } from '../adapters/defillama.js';
import { fetchCoinGeckoSnapshot } from '../market/coingecko.js';
import { sevenDayAnomalyVsPrior90, canonicalEventId } from '../leadtime.js';
import { recordSightingWithSnapshot, insertAssessment, startAdapterRun, finishAdapterRun } from '../ledger.js';

const UNISWAP = {
  protocol: 'uniswap',
  coinId: 'uniswap',
  ticker: 'UNI',
  entity: 'Uniswap Protocol'
};

export async function runCryptoAnomalyScan(pool, { asset = UNISWAP, zTrigger = Number(process.env.CRYPTO_ANOMALY_Z_TRIGGER ?? 2) } = {}) {
  const run = await startAdapterRun(pool, `DEFILLAMA_FEES:${asset.protocol}`);
  let itemsSeen = 0;
  let itemsNew = 0;

  try {
    const fees = await fetchProtocolDailyFees(asset.protocol);
    itemsSeen = fees.series.length;
    const anomaly = sevenDayAnomalyVsPrior90(fees.series.map(x => x.value));

    if (!anomaly.valid || anomaly.zScore < zTrigger) {
      await finishAdapterRun(pool, run.run_id, { status: 'SUCCESS', itemsSeen, itemsNew });
      return { adapter: 'DEFILLAMA_FEES', asset: asset.ticker, anomaly, triggered: false, zTrigger };
    }

    const last = fees.series.at(-1);
    const eventDate = new Date(last.ts * (last.ts < 1e12 ? 1000 : 1)).toISOString().slice(0, 10);
    const eventId = canonicalEventId({
      lane: 'CRYPTO',
      entity: asset.entity,
      eventType: '7D_FEE_ANOMALY',
      eventDate
    });

    const claim = `${asset.entity} 7-day mean daily fees deviated from its prior 90-day rolling-7-day baseline; z=${anomaly.zScore.toFixed(3)}, current7dMean=${anomaly.current7dMean.toFixed(2)}, baseline7dMean=${anomaly.baseline7dMean.toFixed(2)}.`;
    const recorded = await recordSightingWithSnapshot(pool, {
      eventId,
      lane: 'CRYPTO',
      entity: asset.entity,
      tradableTicker: asset.ticker,
      venue: 'DEFILLAMA_FEES',
      venueAttention: 'LOW',
      sourceUrl: fees.sourceUrl,
      venuePublishedTs: new Date(last.ts * (last.ts < 1e12 ? 1000 : 1)).toISOString(),
      claimText: claim,
      evidenceTier: 'SIGNAL',
      methodologyVersion: 'LT-1.0-CODE',
      backfilled: false,
      createdBy: 'crypto-defillama-adapter'
    }, () => fetchCoinGeckoSnapshot(asset.coinId, asset.ticker));

    if (recorded.duplicate) {
      await finishAdapterRun(pool, run.run_id, { status: 'SUCCESS', itemsSeen, itemsNew });
      return { adapter: 'DEFILLAMA_FEES', asset: asset.ticker, anomaly, triggered: true, duplicate: true, zTrigger };
    }

    itemsNew = 1;
    await insertAssessment(pool, {
      sightingId: recorded.sighting.sighting_id,
      jarvisState: 'YELLOW',
      argusRecognition: 'UNMEASURED',
      argusExecution: 'UNMEASURED',
      sentinelState: 'UNMEASURED',
      stage: 'Evidence Pending',
      materialityReason: 'Statistical fee anomaly is measured; substance/value-capture and coded Sentinel checks remain required before promotion.',
      failedGates: ['SENTINEL_CODE_NOT_BOUND', 'JARVIS_SUBSTANCE_VALIDATION_PENDING', 'ARGUS_RECOGNITION_NOT_YET_RUN'],
      recognitionBasis: recorded.snapshot ? {
        t0Price: recorded.snapshot.price,
        ret5d: recorded.snapshot.ret_5d,
        ret20d: recorded.snapshot.ret_20d,
        volumeRatio5d90d: recorded.snapshot.volume_ratio_5d_90d,
        source: recorded.snapshot.source_name
      } : {},
      executionBasis: {},
      decision: 'RESEARCH / NO TRADE'
    });

    await finishAdapterRun(pool, run.run_id, { status: 'SUCCESS', itemsSeen, itemsNew });
    return { adapter: 'DEFILLAMA_FEES', asset: asset.ticker, anomaly, triggered: true, recorded, zTrigger };
  } catch (error) {
    await finishAdapterRun(pool, run.run_id, { status: 'FAILED', itemsSeen, itemsNew, error: error.message });
    throw error;
  }
}
