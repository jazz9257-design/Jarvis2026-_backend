import { createPool } from '../src/db.js';
import { runSystemUpdate } from '../src/systemUpdate.js';

const pool = createPool();
try {
  const result = await runSystemUpdate(pool, { triggerType: 'TEST' });
  const required = ['jarvis_reasoner', 'argus', 'sentinel', 'vc_jarvis', 'command_center'];
  for (const key of required) {
    if (!result.results[key]) throw new Error(`missing engine result: ${key}`);
    if (result.results[key].status === 'NOT_BOUND') throw new Error(`${key} is still NOT_BOUND`);
    if (result.results[key].status !== 'SUCCESS') throw new Error(`${key} status=${result.results[key].status}`);
  }
  const { rows } = await pool.query('SELECT run_id, complete, results FROM latest_system_run');
  if (!rows.length) throw new Error('system run was not persisted');
  console.log(JSON.stringify({ result, persistedRun: rows[0] }, null, 2));
} finally {
  await pool.end();
}
