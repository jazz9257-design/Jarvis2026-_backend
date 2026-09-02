import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../migrations');
const pool = createPool();

try {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _jarvis_migrations (
        filename text PRIMARY KEY,
        applied_ts timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const files = (await fs.readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const filename of files) {
      const exists = await client.query('SELECT 1 FROM _jarvis_migrations WHERE filename = $1', [filename]);
      if (exists.rowCount) {
        console.log(`skip ${filename}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _jarvis_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
