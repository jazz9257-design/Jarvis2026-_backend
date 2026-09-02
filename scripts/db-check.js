import { createPool } from '../src/db.js';

const pool = createPool();
try {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.sightings') AS sightings_table,
      to_regclass('public.market_snapshots') AS market_snapshots_table,
      to_regclass('public.assessments') AS assessments_table,
      CASE WHEN to_regclass('public.sightings') IS NULL THEN NULL ELSE (SELECT count(*)::bigint FROM sightings) END AS sightings_count
  `);
  console.log(JSON.stringify(rows[0], null, 2));

  if (!rows[0].sightings_table) process.exitCode = 2;
} finally {
  await pool.end();
}
