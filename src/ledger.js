import { claimHash, beneficiaryMateriality } from './leadtime.js';

export async function insertSighting(pool, sighting) {
  const hash = sighting.claimHash ?? claimHash(sighting.claimText);
  const { rows } = await pool.query(`
    INSERT INTO sightings (
      event_id, lane, entity, tradable_ticker, venue, venue_attention,
      source_url, venue_published_ts, claim_text, claim_hash,
      evidence_tier, methodology_version, backfilled, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (event_id, venue, claim_hash) DO NOTHING
    RETURNING *
  `, [
    sighting.eventId,
    sighting.lane,
    sighting.entity,
    sighting.tradableTicker ?? null,
    sighting.venue,
    sighting.venueAttention,
    sighting.sourceUrl,
    sighting.venuePublishedTs ?? null,
    sighting.claimText,
    hash,
    sighting.evidenceTier,
    sighting.methodologyVersion ?? 'LT-1.0-CODE',
    Boolean(sighting.backfilled),
    sighting.createdBy ?? 'jarvis-backend'
  ]);
  return rows[0] ?? null;
}

export async function insertMarketSnapshot(pool, sightingId, snapshot) {
  const { rows } = await pool.query(`
    INSERT INTO market_snapshots (
      sighting_id, captured_ts, ticker, price, ret_5d, ret_20d,
      volume_ratio_5d_90d, news_count_7d, analyst_count, benchmark,
      source_name, source_kind, status, raw_payload, missing_reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    sightingId,
    snapshot.capturedTs ?? new Date().toISOString(),
    snapshot.ticker,
    snapshot.price ?? null,
    snapshot.ret5d ?? null,
    snapshot.ret20d ?? null,
    snapshot.volumeRatio5d90d ?? null,
    snapshot.newsCount7d ?? null,
    snapshot.analystCount ?? null,
    snapshot.benchmark ?? null,
    snapshot.sourceName,
    snapshot.sourceKind,
    snapshot.status,
    snapshot.rawPayload ?? null,
    snapshot.missingReason ?? null
  ]);
  return rows[0];
}

// Preserve the raw sighting even when the market provider is unavailable.
// A failed snapshot is explicitly recorded and the DB alpha-eligibility view rejects it.
export async function recordSightingWithSnapshot(pool, sighting, snapshotProvider) {
  const inserted = await insertSighting(pool, sighting);
  if (!inserted) return { sighting: null, snapshot: null, duplicate: true };
  if (!sighting.tradableTicker || typeof snapshotProvider !== 'function') {
    return { sighting: inserted, snapshot: null };
  }

  try {
    const snapshot = await snapshotProvider(sighting.tradableTicker);
    return { sighting: inserted, snapshot: await insertMarketSnapshot(pool, inserted.sighting_id, snapshot) };
  } catch (error) {
    const failed = await insertMarketSnapshot(pool, inserted.sighting_id, {
      ticker: sighting.tradableTicker,
      sourceName: snapshotProvider.name || 'market-provider',
      sourceKind: 'API',
      status: 'FAILED',
      missingReason: error.message,
      rawPayload: null
    });
    return { sighting: inserted, snapshot: failed, snapshotError: error.message };
  }
}

export async function insertBeneficiaryResolution(pool, row) {
  const ratios = beneficiaryMateriality({
    relationshipAmountUsd: row.relationshipAmountUsd,
    beneficiaryRevenueUsd: row.beneficiaryRevenueUsd,
    beneficiarySegmentRevenueUsd: row.beneficiarySegmentRevenueUsd
  });

  const { rows } = await pool.query(`
    INSERT INTO beneficiary_resolutions (
      sighting_id, catalyst_entity, beneficiary_ticker,
      relationship_amount_usd, beneficiary_revenue_usd, beneficiary_segment_revenue_usd,
      materiality_ratio_total_revenue, materiality_ratio_segment_revenue,
      qualitative_materiality, materiality_status, evidence, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
    row.sightingId, row.catalystEntity, row.beneficiaryTicker,
    row.relationshipAmountUsd ?? null, row.beneficiaryRevenueUsd ?? null, row.beneficiarySegmentRevenueUsd ?? null,
    row.materialityRatioTotalRevenue ?? ratios.ratioTotalRevenue,
    row.materialityRatioSegmentRevenue ?? ratios.ratioSegmentRevenue,
    row.qualitativeMateriality ?? null, row.materialityStatus ?? 'UNRESOLVED',
    row.evidence ?? {}, row.notes ?? null
  ]);
  return rows[0];
}

export async function insertBeneficiaryMarketSnapshot(pool, resolutionId, snapshot) {
  const { rows } = await pool.query(`
    INSERT INTO beneficiary_market_snapshots (
      resolution_id, captured_ts, ticker, price, ret_5d, ret_20d,
      volume_ratio_5d_90d, news_count_7d, analyst_count, benchmark,
      source_name, source_kind, status, raw_payload, missing_reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    resolutionId,
    snapshot.capturedTs ?? new Date().toISOString(),
    snapshot.ticker,
    snapshot.price ?? null,
    snapshot.ret5d ?? null,
    snapshot.ret20d ?? null,
    snapshot.volumeRatio5d90d ?? null,
    snapshot.newsCount7d ?? null,
    snapshot.analystCount ?? null,
    snapshot.benchmark ?? null,
    snapshot.sourceName,
    snapshot.sourceKind,
    snapshot.status,
    snapshot.rawPayload ?? null,
    snapshot.missingReason ?? null
  ]);
  return rows[0];
}

export async function recordBeneficiaryResolutionWithSnapshot(pool, row, snapshotProvider) {
  const resolution = await insertBeneficiaryResolution(pool, row);
  if (typeof snapshotProvider !== 'function') return { resolution, snapshot: null };

  try {
    const snapshot = await snapshotProvider(row.beneficiaryTicker);
    return { resolution, snapshot: await insertBeneficiaryMarketSnapshot(pool, resolution.resolution_id, snapshot) };
  } catch (error) {
    const failed = await insertBeneficiaryMarketSnapshot(pool, resolution.resolution_id, {
      ticker: row.beneficiaryTicker,
      sourceName: snapshotProvider.name || 'market-provider',
      sourceKind: 'API',
      status: 'FAILED',
      missingReason: error.message,
      rawPayload: null
    });
    return { resolution, snapshot: failed, snapshotError: error.message };
  }
}

export async function insertAssessment(pool, row) {
  const { rows } = await pool.query(`
    INSERT INTO assessments (
      sighting_id, beneficiary_resolution_id,
      jarvis_state, argus_recognition, argus_execution,
      sentinel_state, stage, materiality_reason, failed_gates,
      recognition_basis, execution_basis, decision, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    row.sightingId, row.beneficiaryResolutionId ?? null,
    row.jarvisState, row.argusRecognition, row.argusExecution,
    row.sentinelState, row.stage, row.materialityReason ?? null,
    row.failedGates ?? [], row.recognitionBasis ?? {}, row.executionBasis ?? {},
    row.decision, row.createdBy ?? 'jarvis-backend'
  ]);
  return rows[0];
}

export async function startAdapterRun(pool, adapter) {
  const { rows } = await pool.query(`
    INSERT INTO adapter_runs(adapter, status) VALUES ($1, 'RUNNING') RETURNING *
  `, [adapter]);
  return rows[0];
}

export async function finishAdapterRun(pool, runId, { status, itemsSeen = 0, itemsNew = 0, error = null }) {
  const { rows } = await pool.query(`
    UPDATE adapter_runs
    SET finished_ts = clock_timestamp(), items_seen = $2, items_new = $3, status = $4, error = $5
    WHERE run_id = $1
    RETURNING *
  `, [runId, itemsSeen, itemsNew, status, error]);
  return rows[0];
}
