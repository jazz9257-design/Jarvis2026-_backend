import { createPool } from '../src/db.js';
import { runCryptoAnomalyScan } from '../src/jobs/cryptoAnomalyScan.js';

const pool = createPool();
try {
  const result = await runCryptoAnomalyScan(pool);
  if (!result.triggered) {
    console.log(JSON.stringify({ pipeline: 'CRYPTO_LT1', triggered: false, anomaly: result.anomaly }, null, 2));
    process.exit(3);
  }
  if (result.duplicate) {
    console.log(JSON.stringify({ pipeline: 'CRYPTO_LT1', triggered: true, duplicate: true, anomaly: result.anomaly }, null, 2));
    process.exit(4);
  }

  const sightingId = result.recorded.sighting.sighting_id;
  const { rows } = await pool.query(`
    SELECT
      s.sighting_id,
      s.first_sight_ts,
      s.entity,
      s.tradable_ticker,
      s.venue,
      s.claim_text,
      v.snapshot_id,
      v.captured_ts,
      v.price,
      v.ret_5d,
      v.ret_20d,
      v.volume_ratio_5d_90d,
      v.market_source_name,
      v.market_source_kind,
      v.snapshot_status,
      v.alpha_eligible,
      a.jarvis_state,
      a.argus_recognition,
      a.argus_execution,
      a.sentinel_state,
      a.stage,
      a.decision
    FROM sightings s
    JOIN sightings_with_t0_snapshot v ON v.sighting_id = s.sighting_id
    LEFT JOIN LATERAL (
      SELECT * FROM assessments x
      WHERE x.sighting_id = s.sighting_id
      ORDER BY x.assessment_ts ASC
      LIMIT 1
    ) a ON true
    WHERE s.sighting_id = $1
  `, [sightingId]);

  if (rows.length !== 1) throw new Error('Pipeline sighting could not be read back');
  if (!rows[0].snapshot_id) throw new Error('Pipeline t0 snapshot is missing');
  if (rows[0].market_source_kind !== 'API') throw new Error('Pipeline t0 snapshot is not API sourced');
  if (rows[0].alpha_eligible !== true) throw new Error('Pipeline sighting should be alpha eligible in code-enforced smoke database');

  console.log(JSON.stringify({
    pipeline: 'CRYPTO_LT1',
    triggered: true,
    anomaly: result.anomaly,
    persisted: rows[0]
  }, null, 2));
} finally {
  await pool.end();
}
