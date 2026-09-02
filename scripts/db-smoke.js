import { createPool } from '../src/db.js';
import { insertSighting, insertMarketSnapshot } from '../src/ledger.js';

const pool = createPool();
try {
  const sighting = await insertSighting(pool, {
    eventId: `CI-SMOKE-${Date.now()}`,
    lane: 'STOCK',
    entity: 'CI Smoke Entity',
    tradableTicker: 'TEST',
    venue: 'CI_FIXTURE',
    venueAttention: 'LOW',
    sourceUrl: 'https://example.com/ci-fixture',
    venuePublishedTs: new Date().toISOString(),
    claimText: `CI fixture claim ${Date.now()}`,
    evidenceTier: 'PRECURSOR',
    methodologyVersion: 'LT-1.0-CODE',
    backfilled: false,
    createdBy: 'github-actions'
  });

  if (!sighting) throw new Error('CI sighting insert returned null');

  const snapshot = await insertMarketSnapshot(pool, sighting.sighting_id, {
    ticker: 'TEST',
    price: 10,
    ret5d: 0.01,
    ret20d: 0.02,
    volumeRatio5d90d: 1.1,
    sourceName: 'CI Fixture API',
    sourceKind: 'API',
    status: 'PARTIAL',
    rawPayload: { fixture: true }
  });

  const check = await pool.query(`
    SELECT sighting_id, snapshot_id, alpha_eligible
    FROM sightings_with_t0_snapshot
    WHERE sighting_id = $1
  `, [sighting.sighting_id]);
  if (check.rowCount !== 1) throw new Error('t0 snapshot view did not return the inserted sighting');
  if (!check.rows[0].snapshot_id) throw new Error('t0 snapshot is null');
  if (check.rows[0].alpha_eligible !== true) throw new Error('CI t0 API snapshot should be alpha eligible');

  let updateRejected = false;
  try {
    await pool.query('UPDATE sightings SET entity = $2 WHERE sighting_id = $1', [sighting.sighting_id, 'MUTATED']);
  } catch (error) {
    updateRejected = /append-only/i.test(error.message);
  }
  if (!updateRejected) throw new Error('sightings UPDATE was not rejected by DB trigger');

  let deleteRejected = false;
  try {
    await pool.query('DELETE FROM sightings WHERE sighting_id = $1', [sighting.sighting_id]);
  } catch (error) {
    deleteRejected = /append-only/i.test(error.message);
  }
  if (!deleteRejected) throw new Error('sightings DELETE was not rejected by DB trigger');

  const count = await pool.query('SELECT count(*)::int AS count FROM sightings');
  console.log(JSON.stringify({
    sightings_count: count.rows[0].count,
    sighting_id: sighting.sighting_id,
    snapshot_id: snapshot.snapshot_id,
    alpha_eligible: check.rows[0].alpha_eligible,
    update_rejected: updateRejected,
    delete_rejected: deleteRejected
  }, null, 2));
} finally {
  await pool.end();
}
