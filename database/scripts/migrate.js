/**
 * ==============================================================================
 * Silent SOS - Migration Runner
 * Description: Runs pending SQL migrations in deterministic numerical sequence
 * inside transactional boundaries and tracks applied versions.
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

export async function runMigrations() {
  console.log(`[Migrations] Connecting to ${describeDatabaseTarget()}...`);

  const client = new Client(buildConnectionConfig({ database: targetDb }));

  try {
    await client.connect();

    // 1. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied migrations
    const appliedRes = await client.query('SELECT version FROM schema_migrations;');
    const appliedVersions = new Set(appliedRes.rows.map((row) => row.version));

    // 3. Read migration files sorted alphanumerically
    const migrationsDir = path.resolve(__dirname, '../migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[Migrations] No migration files found.');
      return;
    }

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (appliedVersions.has(file)) {
        skippedCount++;
        continue;
      }

      console.log(`[Migrations] Applying: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // Execute migration in transaction
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1);',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[Migrations] ✓ Successfully applied ${file}`);
        appliedCount++;
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`[Migrations Error] Failed executing ${file}:`, migrationErr.message);
        throw migrationErr;
      }
    }

    console.log(
      `[Migrations] Complete. Applied: ${appliedCount}, Already up to date: ${skippedCount}.`
    );
  } catch (err) {
    if (err.message.includes('SASL') || err.message.includes('password authentication failed') || err.message.includes('client password')) {
      console.error('[Migrations Error] Authentication required: Please set DATABASE_PASSWORD in server/.env or as an environment variable.');
    } else {
      console.error('[Migrations Error]:', err.message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations();
}
