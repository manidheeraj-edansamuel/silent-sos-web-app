/**
 * ==============================================================================
 * Silent SOS - PostgreSQL Database Connection Layer
 * Description: Initializes connection pool using pg with environment variables,
 * defensive error handling, and health inspection utilities.
 * ==============================================================================
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

if (process.env.DATABASE_PASSWORD && !process.env.PGPASSWORD) {
  process.env.PGPASSWORD = process.env.DATABASE_PASSWORD;
}

const { Pool } = pg;

const LOCAL_HOST_PATTERN = /(?:^|[/@])(localhost|127\.0\.0\.1|\[?::1\]?)(?::|\/|$)/i;

/**
 * Resolve TLS options for the configured database target.
 * Managed providers (Neon, Supabase, Render) require TLS; local Postgres does not.
 * DATABASE_SSL accepts: true|require|verify-full (verify cert), no-verify (skip
 * cert verification, for providers with private CAs), false|disable.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {false|{rejectUnauthorized: boolean}}
 */
export function resolveSslConfig(env = process.env) {
  const mode = (env.DATABASE_SSL || '').trim().toLowerCase();
  if (['false', 'disable', 'off'].includes(mode)) return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  if (['true', 'require', 'verify-full', 'verify-ca'].includes(mode)) {
    return { rejectUnauthorized: true };
  }

  // Unset: enable TLS for anything that is not a loopback host.
  const target = env.DATABASE_URL || env.DATABASE_HOST || 'localhost';
  return LOCAL_HOST_PATTERN.test(target) ? false : { rejectUnauthorized: true };
}

/**
 * Build connection options for pg.Pool / pg.Client.
 * DATABASE_URL takes precedence over the discrete DATABASE_* variables.
 * @param {{ database?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function buildConnectionConfig({ database, env = process.env } = {}) {
  const ssl = resolveSslConfig(env);
  const sslOption = ssl ? { ssl } : {};

  if (env.DATABASE_URL) {
    return { connectionString: env.DATABASE_URL, ...sslOption };
  }

  return {
    host: env.DATABASE_HOST || 'localhost',
    port: parseInt(env.DATABASE_PORT, 10) || 5432,
    database: database || env.DATABASE_NAME || 'silent_sos',
    user: env.DATABASE_USER || 'postgres',
    password: env.DATABASE_PASSWORD ?? env.PGPASSWORD ?? '',
    ...sslOption,
  };
}

/**
 * Password-free description of the configured target, safe for logs.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function describeDatabaseTarget(env = process.env) {
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
      return 'DATABASE_URL target';
    }
  }
  const host = env.DATABASE_HOST || 'localhost';
  const port = parseInt(env.DATABASE_PORT, 10) || 5432;
  return `${host}:${port}/${env.DATABASE_NAME || 'silent_sos'}`;
}

// Connection options extracted strictly from environment variables
const baseConnectionConfig = buildConnectionConfig();
const poolConfig = {
  ...baseConnectionConfig,
  ...(baseConnectionConfig.connectionString
    ? {}
    : { password: () => process.env.DATABASE_PASSWORD ?? process.env.PGPASSWORD ?? '' }),
  max: parseInt(process.env.DATABASE_POOL_MAX, 10) || 20,
  idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECT_TIMEOUT, 10) || 3000,
};

let poolInstance = null;

/**
 * Retrieve or initialize the active PostgreSQL pool instance lazily
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!poolInstance) {
    poolInstance = new Pool(poolConfig);
    poolInstance.on('error', (err) => {
      console.error('[PostgreSQL Pool Unexpected Error]:', err.message);
    });
  }
  return poolInstance;
}

export const pool = {
  query: (text, params) => getPool().query(text, params),
  connect: () => getPool().connect(),
  on: (event, handler) => getPool().on(event, handler),
  end: async () => {
    if (poolInstance) {
      const p = poolInstance;
      poolInstance = null;
      await p.end();
    }
  },
};

/**
 * Execute a query with parameters using the connection pool
 * @param {string} text - SQL query string
 * @param {Array} [params] - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true') {
    console.log('[PostgreSQL Query]', { text, duration: `${duration}ms`, rows: res.rowCount });
  }
  return res;
}

/**
 * Acquire a dedicated client from the pool for transactions
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return await getPool().connect();
}

/**
 * Health check utility to probe database connectivity
 * Distinguishes between healthy, degraded, or unavailable states.
 * @returns {Promise<{ isHealthy: boolean, latencyMs?: number, version?: string, error?: string }>}
 */
export async function checkDbHealth() {
  const start = Date.now();
  try {
    const res = await getPool().query('SELECT 1 AS alive, version();');
    const latencyMs = Date.now() - start;
    const isAlive = res.rows && res.rows[0]?.alive === 1;
    return {
      isHealthy: isAlive,
      latencyMs,
      version: res.rows[0]?.version?.split(' ')?.[0] || 'PostgreSQL',
    };
  } catch (err) {
    return {
      isHealthy: false,
      error: err.message,
    };
  }
}

/**
 * Graceful shutdown helper for tests and server termination
 */
export async function closePool() {
  if (poolInstance) {
    const p = poolInstance;
    poolInstance = null;
    await p.end();
  }
}

export default {
  pool,
  getPool,
  query,
  getClient,
  checkDbHealth,
  closePool,
};
