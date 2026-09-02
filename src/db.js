import pg from 'pg';

const { Pool } = pg;

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  return new Pool({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
}
