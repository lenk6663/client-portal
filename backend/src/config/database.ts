import { Pool, PoolConfig } from 'pg';
import 'dotenv/config';

function createPool(overrides: Partial<PoolConfig> = {}): Pool {
  return new Pool({
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ...overrides,
  });
}

export const internalPool = createPool({
  host:     process.env.DB_INTERNAL_HOST || 'localhost',
  port:     Number(process.env.DB_INTERNAL_PORT) || 5432,
  database: process.env.DB_INTERNAL_NAME || 'tppo_portal',
  user:     process.env.DB_INTERNAL_USER || 'tppo',
  password: process.env.DB_INTERNAL_PASS || 'tppo_pass',
});

export const externalPool = createPool({
  host:     process.env.DB_EXTERNAL_HOST || 'localhost',
  port:     Number(process.env.DB_EXTERNAL_PORT) || 5433,
  database: process.env.DB_EXTERNAL_NAME || 'neo_1c',
  user:     process.env.DB_EXTERNAL_USER || 'tppo',
  password: process.env.DB_EXTERNAL_PASS || 'tppo_pass',
});

export async function testConnections(): Promise<void> {
  const ic = await internalPool.connect();
  await ic.query('SELECT 1');
  ic.release();
  console.log('✅  Internal DB connected');

  const ec = await externalPool.connect();
  await ec.query('SELECT 1');
  ec.release();
  console.log('✅  External DB (1C) connected');
}
