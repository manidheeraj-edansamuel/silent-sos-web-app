/**
 * ==============================================================================
 * Silent SOS - Database Creation Script
 * Description: Checks if the target application database exists on the PostgreSQL
 * instance and safely creates it if absent. Does not drop or destroy data.
 * ==============================================================================
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildConnectionConfig,
  describeDatabaseTarget,
} from '../../server/src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server/.env or root .env if present
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Client } = pg;

const targetDb = process.env.DATABASE_NAME || 'silent_sos';
const maintenanceDb = process.env.DATABASE_MAINTENANCE_DB || 'postgres';

async function initDatabase() {
  // Managed providers (Neon, Supabase, Render) create the database for you and
  // expose it as DATABASE_URL, so only connection availability needs checking.
  if (process.env.DATABASE_URL) {
    console.log(`[DB Init] DATABASE_URL detected (${describeDatabaseTarget()}). Verifying connectivity...`);
    const managedClient = new Client(buildConnectionConfig());
    try {
      await managedClient.connect();
      await managedClient.query('SELECT 1;');
      console.log('[DB Init] Connection verified. Managed database already exists.');
    } catch (err) {
      console.error('[DB Init Error]:', err.message);
      process.exit(1);
    } finally {
      await managedClient.end();
    }
    return;
  }

  console.log(`[DB Init] Checking if database '${targetDb}' exists on ${describeDatabaseTarget()}...`);

  const client = new Client(buildConnectionConfig({ database: maintenanceDb }));

  try {
    await client.connect();

    const checkRes = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1;',
      [targetDb]
    );

    if (checkRes.rowCount > 0) {
      console.log(`[DB Init] Database '${targetDb}' already exists. No creation needed.`);
    } else {
      // Validate database name identifier to avoid SQL injection
      if (!/^[a-zA-Z0-9_]+$/.test(targetDb)) {
        throw new Error(`Invalid database name identifier: ${targetDb}`);
      }
      console.log(`[DB Init] Creating database '${targetDb}'...`);
      await client.query(`CREATE DATABASE ${targetDb};`);
      console.log(`[DB Init] Database '${targetDb}' created successfully.`);
    }
  } catch (err) {
    if (err.message.includes('SASL') || err.message.includes('password authentication failed') || err.message.includes('client password')) {
      console.error('[DB Init Error] Authentication required: Please set DATABASE_PASSWORD in server/.env or as an environment variable.');
    } else {
      console.error(`[DB Init Error]:`, err.message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

initDatabase();
