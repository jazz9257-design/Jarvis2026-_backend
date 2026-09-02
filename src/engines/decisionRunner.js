import { evaluateJarvis } from './jarvis.js';
import { evaluateArgus } from './argus.js';
import { evaluateSentinel } from './sentinel.js';
import { evaluateVcJarvis } from './vcJarvis.js';
import { insertAssessment } from '../ledger.js';

function snapshotFromRow(row) {
  const prefix = row.lane === 'STOCK' && row.beneficiary_snapshot_id ? 'beneficiary_' : '';
  if (prefix) {
    return {
      status: row.beneficiary_snapshot_status,
      price: row.beneficiary_price,
      ret_5d: row.beneficiary_ret_5d,
      ret_20d: row.beneficiary_ret_20d,
      volume_ratio_5d_90d: row.beneficiary_volume_ratio_5d_90d,
      source_name: row.beneficiary_market_source_name,
      raw_payload: row.beneficiary_raw_payload
    };
  }
  if (!row.snapshot_id) return null;
  return {
    status: row.snapshot_status,
    price: row.price,
    ret_5d: row.ret_5d,
    ret_20d: row.ret_20d,
    volume_ratio_5d_90d: row.volume_ratio_5d_90d,
    source_name: row.market_source_name,
    raw_payload: row.raw_payload
  };
}

function resolutionFromRow(row) {
  if (!row.resolution_id) return null;
  return {
    resolution_id: row.resolution_id,
    materiality_status: row.materiality_status,
    materiality_ratio_total_revenue: row.materiality_ratio_total_revenue,
    materiality_ratio_segment_revenue: row.materiality_ratio_segment_revenue,
    beneficiary_ticker: row.beneficiary_ticker
  };
}

function deriveRiskEvidence(row) {
  if (row.lane === 'STOCK') {
    return {
      primarySourceVerified: row.venue_attention === 'LOW' && row.evidence_tier !== 'SIGNAL',
      beneficiaryRiskReviewed: false,
      vetoes: row.materiality_status === 'FAIL' ? ['BENEFICIARY_MATERIALITY_FAILED'] : []
    };
  }
  return {
    contractVerified: false,
    liquidityQualityVerified: false,
    holderConcentrationReviewed: false,
    unlockRiskReviewed: false,
    vetoes: []
  };
}

function stageFor({ jarvis, argus, sentinel, decision }) {
  if (decision === 'TRADE CANDIDATE') return 'SETUP';
  if (jarvis.state === 'GREEN' && sentinel.state === 'GREEN' && argus.recognition.state === 'GREEN') return 'PRE-SETUP';
  if (jarvis.state === 'GREEN') return 'Verified';
  return 'Evidence Pending';
}

function decisionFor({ jarvis, argus, sentinel }) {
  if (jarvis.state === 'RED' || sentinel.state === 'RED' || argus.recognition.state === 'RED' || argus.execution.state === 'RED') return 'REJECT';
  if ([jarvis.state, sentinel.state, argus.recognition.state, argus.execution.state].every(x => x === 'GREEN')) return 'TRADE CANDIDATE';
  return 'RESEARCH / WAIT';
}

export async function loadDecisionContexts(pool, { hours = 72, limit = 100 } = {}) {
  const { rows } = await pool.query(`
    SELECT
      s.*,
      ms.snapshot_id, ms.status AS snapshot_status, ms.price, ms.ret_5d, ms.ret_20d,
      ms.volume_ratio_5d_90d, ms.source_name AS market_source_name, ms.raw_payload,
      br.resolution_id, br.materiality_status, br.materiality_ratio_total_revenue,
      br.materiality_ratio_segment_revenue, br.beneficiary_ticker,
      bms.beneficiary_snapshot_id,
      bms.status AS beneficiary_snapshot_status,
      bms.price AS beneficiary_price,
      bms.ret_5d AS beneficiary_ret_5d,
      bms.ret_20d AS beneficiary_ret_20d,
      bms.volume_ratio_5d_90d AS beneficiary_volume_ratio_5d_90d,
      bms.source_name AS beneficiary_market_source_name,
      bms.raw_payload AS beneficiary_raw_payload
    FROM sightings s
    LEFT JOIN LATERAL (
      SELECT m.* FROM market_snapshots m
      WHERE m.sighting_id = s.sighting_id
      ORDER BY m.captured_ts ASC LIMIT 1
    ) ms ON true
    LEFT JOIN LATERAL (
      SELECT r.* FROM beneficiary_resolutions r
      WHERE r.sighting_id = s.sighting_id
      ORDER BY r.assessed_ts DESC LIMIT 1
    ) br ON true
    LEFT JOIN LATERAL (
      SELECT bm.* FROM beneficiary_market_snapshots bm
      WHERE bm.resolution_id = br.resolution_id
      ORDER BY bm.captured_ts ASC LIMIT 1
    ) bms ON true
    WHERE s.first_sight_ts >= clock_timestamp() - ($1::text || ' hours')::interval
    ORDER BY s.first_sight_ts DESC
    LIMIT $2
  `, [String(hours), limit]);
  return rows;
}

export async function runDecisionEngines(pool, options = {}) {
  const rows = await loadDecisionContexts(pool, options);
  const evaluations = [];

  for (const row of rows) {
    const sighting = row;
    const snapshot = snapshotFromRow(row);
    const beneficiaryResolution = resolutionFromRow(row);
    const riskEvidence = deriveRiskEvidence(row);

    const jarvis = evaluateJarvis({ sighting, beneficiaryResolution, cryptoSubstance: {} });
    const sentinel = evaluateSentinel({ sighting, riskEvidence });
    const argus = evaluateArgus({ snapshot, setup: null, rewardRisk: null });
    const decision = decisionFor({ jarvis, argus, sentinel });
    const stage = stageFor({ jarvis, argus, sentinel, decision });
    const failedGates = [
      ...(jarvis.failedGates ?? []),
      ...(sentinel.vetoes ?? []),
      ...(sentinel.missing ?? []),
      ...(argus.recognition.state === 'UNMEASURED' ? ['ARGUS_RECOGNITION_UNMEASURED'] : []),
      ...(argus.execution.state !== 'GREEN' ? ['ARGUS_EXECUTION_NOT_GREEN'] : [])
    ];

    await insertAssessment(pool, {
      sightingId: row.sighting_id,
      beneficiaryResolutionId: row.resolution_id ?? null,
      jarvisState: jarvis.state,
      argusRecognition: argus.recognition.state,
      argusExecution: argus.execution.state,
      sentinelState: sentinel.state,
      stage,
      materialityReason: jarvis.reason,
      failedGates,
      recognitionBasis: argus.recognition.basis,
      executionBasis: argus.execution.basis,
      decision,
      createdBy: 'decision-engine-v1'
    });

    evaluations.push({
      sightingId: row.sighting_id,
      lane: row.lane,
      entity: row.entity,
      ticker: row.beneficiary_ticker ?? row.tradable_ticker ?? null,
      jarvis: jarvis.state,
      argusRecognition: argus.recognition.state,
      argusExecution: argus.execution.state,
      sentinel: sentinel.state,
      stage,
      decision,
      failedGates
    });
  }

  const vc = evaluateVcJarvis(rows);
  return { evaluations, vc };
}
