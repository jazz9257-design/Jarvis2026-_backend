import { createPool } from '../src/db.js';

const pool = createPool();
try {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.sightings') AS sightings_table,
      to_regclass('public.market_snapshots') AS market_snapshots_table,
      to_regclass('public.assessments') AS assessments_table,
      to_regclass('public.beneficiary_resolutions') AS beneficiary_resolutions_table
  `);

  let sightingsCount = null;
  let t0SnapshotCount = null;
  if (rows[0].sightings_table) {
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::bigint FROM sightings) AS sightings_count,
        (SELECT count(*)::bigint FROM sightings_with_t0_snapshot WHERE snapshot_id IS NOT NULL) AS t0_snapshot_count
    `);
    sightingsCount = counts.rows[0].sightings_count;
    t0SnapshotCount = counts.rows[0].t0_snapshot_count;
  }

  const result = { ...rows[0], sightings_count: sightingsCount, t0_snapshot_count: t0SnapshotCount };
  console.log(JSON.stringify(result, null, 2));
  if (!result.sightings_table) process.exitCode = 2;
} finally {
  await pool.end();
}
