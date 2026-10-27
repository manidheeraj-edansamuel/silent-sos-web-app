/**
 * ==============================================================================
 * Silent SOS - Seed Data Runner
 * Description: Populates development baseline mock data for local testing.
 * ==============================================================================
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import {
  buildConnectionConfig,
  describeDatabaseTarget,
} from '../../server/src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Client } = pg;

const targetDb = process.env.DATABASE_NAME || 'silent_sos';

export async function runSeeds() {
  console.log(`[Seeds] Connecting to ${describeDatabaseTarget()}...`);

  const client = new Client(buildConnectionConfig({ database: targetDb }));

  try {
    await client.connect();

    const seedsDir = path.resolve(__dirname, '../seeds');
    const files = fs
      .readdirSync(seedsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[Seeds] No seed files found.');
      return;
    }

    for (const file of files) {
      console.log(`[Seeds] Executing seed file: ${file}...`);
      const filePath = path.join(seedsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`[Seeds] ✓ Successfully executed ${file}`);
    }

    console.log('[Seeds] Development seed initialization finished successfully.');
  } catch (err) {
    if (err.message.includes('SASL') || err.message.includes('password authentication failed') || err.message.includes('client password')) {
      console.error('[Seeds Error] Authentication required: Please set DATABASE_PASSWORD in server/.env or as an environment variable.');
    } else {
      console.error('[Seeds Error]:', err.message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeeds();
}
