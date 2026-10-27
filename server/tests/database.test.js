import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, checkDbHealth, closePool } from '../src/config/database.js';

describe('Database & Geospatial Schema Verification Tests', () => {
  after(async () => {
    await closePool();
  });

  test('1. Database connectivity and checkDbHealth helper', async () => {
    const health = await checkDbHealth();
    assert.equal(health.isHealthy, true, 'Database health check should return isHealthy: true');
    assert.ok(typeof health.latencyMs === 'number', 'Latency should be a measured numeric value in ms');
    assert.ok(health.version, 'PostgreSQL version info should be returned');
  });

  test('2. PostGIS and pgcrypto extensions are enabled', async () => {
    const extRes = await query(`
      SELECT extname, extversion FROM pg_extension 
      WHERE extname IN ('postgis', 'pgcrypto');
    `);
    const installedExts = extRes.rows.map((r) => r.extname);
    assert.ok(installedExts.includes('postgis'), 'PostGIS extension must be installed');
    assert.ok(installedExts.includes('pgcrypto'), 'pgcrypto extension must be installed');

    // Verify PostGIS function execution
    const postgisVersion = await query('SELECT postgis_version();');
    assert.ok(postgisVersion.rows[0].postgis_version, 'PostGIS version function must return a valid string');
  });

  test('3. Required schema tables exist in the database', async () => {
    const expectedTables = [
      'users',
      'emergency_contacts',
      'alerts',
      'alert_locations',
      'alert_events',
      'notification_attempts',
      'push_subscriptions',
      'schema_migrations',
    ];

    const tablesRes = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    const foundTables = tablesRes.rows.map((r) => r.table_name);

    for (const tbl of expectedTables) {
      assert.ok(
        foundTables.includes(tbl),
        `Expected table '${tbl}' to exist in public schema`
      );
    }
  });

  test('4. Users table schema and column structure', async () => {
    const columnsRes = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users';
    `);
    const cols = Object.fromEntries(columnsRes.rows.map((r) => [r.column_name, r]));

    assert.ok(cols.id, 'users must have id column');
    assert.ok(cols.full_name, 'users must have full_name column');
    assert.equal(cols.full_name.is_nullable, 'NO', 'full_name must NOT be nullable');
    assert.ok(cols.phone_number, 'users must have phone_number column');
    assert.ok(cols.email, 'users must have email column');
    assert.ok(cols.created_at, 'users must have created_at column');
    assert.ok(cols.updated_at, 'users must have updated_at column');
  });

  test('5. Emergency contacts foreign key relationship and priority constraint', async () => {
    // Verify foreign key to users(id)
    const fkRes = await query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'emergency_contacts';
    `);

    const userFk = fkRes.rows.find(
      (r) => r.column_name === 'user_id' && r.foreign_table_name === 'users'
    );
    assert.ok(userFk, 'emergency_contacts must have a foreign key on user_id referencing users(id)');

    // Verify priority positive constraint and unique constraint
    const uqRes = await query(`
      SELECT tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_name = 'emergency_contacts' AND tc.constraint_type = 'UNIQUE';
    `);
    assert.ok(uqRes.rows.length > 0, 'emergency_contacts must enforce unique constraint on user priority');
  });

  test('6. Alerts status enum and constraints', async () => {
    const enumRes = await query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'alert_status';
    `);
    const statuses = enumRes.rows.map((r) => r.enumlabel).sort();
    const expected = ['acknowledged', 'active', 'false_alarm', 'resolved'].sort();
    assert.deepEqual(statuses, expected, 'alert_status enum must contain all valid states');
  });

  test('7. Alert locations accepts PostGIS geography points and spatial functions work', async () => {
    // Test spatial distance calculation between two points using PostGIS ST_Distance
    const distRes = await query(`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-73.9840, 40.7535), 4326)::geography
      ) AS distance_meters;
    `);

    const distance = parseFloat(distRes.rows[0].distance_meters);
    assert.ok(!isNaN(distance), 'ST_Distance should calculate distance in meters');
    assert.ok(distance > 500 && distance < 800, `Expected NYC point distance ~600m, got ${distance}m`);
  });

  test('8. GiST spatial index exists on alert_locations geography column', async () => {
    const idxRes = await query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'alert_locations' AND indexname = 'idx_alert_locations_location_gist';
    `);

    assert.equal(idxRes.rowCount, 1, 'idx_alert_locations_location_gist must exist on alert_locations');
    assert.ok(
      idxRes.rows[0].indexdef.toLowerCase().includes('using gist'),
      'Spatial index must use GiST access method'
    );
  });

  test('9. Alert events audit log references alerts table', async () => {
    const fkRes = await query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'alert_events';
    `);

    const alertFk = fkRes.rows.find(
      (r) => r.column_name === 'alert_id' && r.foreign_table_name === 'alerts'
    );
    assert.ok(alertFk, 'alert_events must have foreign key referencing alerts(id)');
  });

  test('10. Notification attempts references alerts and emergency_contacts', async () => {
    const fkRes = await query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'notification_attempts';
    `);

    const alertFk = fkRes.rows.find(
      (r) => r.column_name === 'alert_id' && r.foreign_table_name === 'alerts'
    );
    const contactFk = fkRes.rows.find(
      (r) => r.column_name === 'emergency_contact_id' && r.foreign_table_name === 'emergency_contacts'
    );

    assert.ok(alertFk, 'notification_attempts must reference alerts(id)');
    assert.ok(contactFk, 'notification_attempts must reference emergency_contacts(id)');
  });

  test('11. Emergency contacts expose notification channel preferences', async () => {
    const columnsRes = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'emergency_contacts';
    `);
    const cols = Object.fromEntries(columnsRes.rows.map((r) => [r.column_name, r]));

    assert.ok(cols.notify_email, 'emergency_contacts must have notify_email');
    assert.ok(cols.notify_sms, 'emergency_contacts must have notify_sms');
    assert.equal(cols.notify_email.data_type, 'boolean');
    assert.equal(cols.notify_sms.data_type, 'boolean');
    assert.equal(cols.notify_email.is_nullable, 'NO');
    assert.equal(cols.notify_sms.is_nullable, 'NO');
  });

  test('12. Push subscriptions are alert-scoped and cascade with alerts', async () => {
    const columnsRes = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'push_subscriptions';
    `);
    const cols = columnsRes.rows.map((r) => r.column_name);
    for (const expected of [
      'alert_id',
      'endpoint',
      'p256dh',
      'auth',
      'tracking_token_encrypted',
      'last_notified_at',
    ]) {
      assert.ok(cols.includes(expected), `push_subscriptions must have ${expected}`);
    }

    const fkRes = await query(`
      SELECT kcu.column_name, ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'push_subscriptions';
    `);
    const alertFk = fkRes.rows.find(
      (r) => r.column_name === 'alert_id' && r.foreign_table_name === 'alerts'
    );
    assert.ok(alertFk, 'push_subscriptions must reference alerts(id)');
  });
});
