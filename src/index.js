import http from 'node:http';
import cron from 'node-cron';
import { createPool } from './db.js';
import { runSystemUpdate } from './systemUpdate.js';

const pool = createPool();
const port = Number(process.env.PORT ?? 3000);
let updateRunning = false;
let lastUpdate = null;

async function guardedUpdate(triggerType = 'MANUAL') {
  if (updateRunning) return { status: 'SKIPPED', reason: 'UPDATE_ALREADY_RUNNING' };
  updateRunning = true;
  try {
    lastUpdate = await runSystemUpdate(pool, { triggerType });
    return lastUpdate;
  } finally {
    updateRunning = false;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    try {
      const db = await pool.query("SELECT to_regclass('public.sightings') AS sightings_table, to_regclass('public.system_runs') AS system_runs_table, now() AS db_time");
      const ready = Boolean(db.rows[0].sightings_table && db.rows[0].system_runs_table);
      return json(res, ready ? 200 : 503, {
        service: 'jarvis2026-backend',
        status: ready ? 'READY' : 'MIGRATION_REQUIRED',
        hourlyScanEnabled: process.env.ENABLE_HOURLY_SCAN === 'true',
        db: db.rows[0],
        updateRunning,
        lastUpdate
      });
    } catch (error) {
      return json(res, 503, { service: 'jarvis2026-backend', status: 'DB_UNAVAILABLE', error: error.message });
    }
  }

  if (req.method === 'GET' && req.url === '/latest-system-update') {
    try {
      const { rows } = await pool.query('SELECT * FROM latest_system_run');
      return json(res, rows.length ? 200 : 404, rows[0] ?? { error: 'NO_SYSTEM_RUN_YET' });
    } catch (error) {
      return json(res, 503, { error: 'DB_UNAVAILABLE', detail: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/run-system-update') {
    const configured = process.env.RUN_SYSTEM_UPDATE_SECRET;
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!configured || supplied !== configured) return json(res, 401, { error: 'UNAUTHORIZED' });
    const result = await guardedUpdate('MANUAL');
    return json(res, 200, result);
  }

  return json(res, 404, { error: 'NOT_FOUND' });
});

if (process.env.ENABLE_HOURLY_SCAN === 'true') {
  cron.schedule('0 * * * *', () => {
    guardedUpdate('HOURLY').catch(error => console.error('hourly update failed', error));
  }, {
    timezone: process.env.TZ || 'America/Chicago',
    noOverlap: true,
    name: 'jarvis-hourly-system-update'
  });
}

server.listen(port, () => {
  console.log(`JARVIS backend listening on ${port}; hourly=${process.env.ENABLE_HOURLY_SCAN === 'true'}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
