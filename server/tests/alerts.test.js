import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';

describe('Emergency SOS Alerts API Tests (/api/v1/alerts)', () => {
  let dbAvailable = false;

  let userAToken = '';
  let userAId = '';
  let userBToken = '';
  let userBId = '';

  let alertAId = '';
  let alertARawToken = '';

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (dbAvailable) {
      // Register User A
      const resA = await request(app)
        .post('/api/v1/auth/register')
        .send({
          full_name: 'Alert Test User Alpha',
          email: `alert.alpha.${Date.now()}@example.local`,
          password: 'AlphaPassword123!',
        });
      if (resA.body.data) {
        userAToken = resA.body.data.token;
        userAId = resA.body.data.user.id;
      }

      // Register User B for tenant isolation testing
      const resB = await request(app)
        .post('/api/v1/auth/register')
        .send({
          full_name: 'Alert Test User Beta',
          email: `alert.beta.${Date.now()}@example.local`,
          password: 'BetaPassword123!',
        });
      if (resB.body.data) {
        userBToken = resB.body.data.token;
        userBId = resB.body.data.user.id;
      }
    }
  });

  after(async () => {
    if (dbAvailable) {
      const userIds = [userAId, userBId].filter(Boolean);
      if (userIds.length > 0) {
        await query(
          `DELETE FROM alert_locations WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ANY($1::uuid[]));`,
          [userIds]
        );
        await query(
          `DELETE FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = ANY($1::uuid[]));`,
          [userIds]
        );
        await query(`DELETE FROM alerts WHERE user_id = ANY($1::uuid[]);`, [userIds]);
        await query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [userIds]);
      }
    }
    await closePool();
  });

  test('1. Unauthenticated requests to /api/v1/alerts are rejected with 401', async () => {
    await request(app).get('/api/v1/alerts/active').expect(401);
    await request(app).post('/api/v1/alerts/trigger').send({}).expect(401);
    await request(app).post('/api/v1/alerts/00000000-0000-0000-0000-000000000000/location').send({}).expect(401);
    await request(app).post('/api/v1/alerts/00000000-0000-0000-0000-000000000000/resolve').send({}).expect(401);
  });

  test('2. Authenticated SOS trigger with valid GPS creates alert and stores location', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy_meters: 8.5,
          altitude_meters: 15.0,
          heading_degrees: 180.0,
          speed_mps: 1.2,
        },
      })
      .expect(201);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.alert);
    assert.ok(res.body.data.alert.id);
    assert.equal(res.body.data.alert.status, 'active');
    assert.ok(res.body.data.alert.tracking_token);
    assert.ok(res.body.data.alert.location);
    assert.equal(Math.round(res.body.data.alert.location.latitude * 1000) / 1000, 37.775);
    assert.equal(Math.round(res.body.data.alert.location.longitude * 1000) / 1000, -122.419);
    assert.equal(res.body.data.alert.location.accuracy_meters, 8.5);

    alertAId = res.body.data.alert.id;
    alertARawToken = res.body.data.alert.tracking_token;
  });

  test('3. Tracking token generation and SHA-256 storage verification', async () => {
    assert.ok(alertARawToken);
    assert.ok(alertARawToken.length >= 24);

    // Compute expected SHA-256 hash of the raw token
    const expectedHash = crypto.createHash('sha256').update(alertARawToken).digest('hex');

    // Query DB directly to verify hash is stored and raw token is NOT stored
    const dbAlert = await query(
      'SELECT id, tracking_token_hash FROM alerts WHERE id = $1;',
      [alertAId]
    );
    assert.equal(dbAlert.rowCount, 1);
    assert.equal(dbAlert.rows[0].tracking_token_hash, expectedHash);
  });

  test('4. Initial PostGIS location storage in alert_locations', async () => {
    const locRes = await query(
      `SELECT id, alert_id, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
              accuracy_meters, altitude_meters, heading_degrees, speed_mps
       FROM alert_locations
       WHERE alert_id = $1;`,
      [alertAId]
    );

    assert.equal(locRes.rowCount, 1);
    const loc = locRes.rows[0];
    assert.equal(Math.round(parseFloat(loc.latitude) * 1000) / 1000, 37.775);
    assert.equal(Math.round(parseFloat(loc.longitude) * 1000) / 1000, -122.419);
    assert.equal(parseFloat(loc.accuracy_meters), 8.5);
  });

  test('5. SOS trigger when location is unavailable proceeds with location_status audit', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: null,
        location_error: 'PERMISSION_DENIED',
      })
      .expect(201);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.alert.id);
    assert.equal(res.body.data.alert.status, 'active');
    assert.equal(res.body.data.alert.location, null);

    const userBAlertId = res.body.data.alert.id;

    // Verify audit event in database
    const eventRes = await query(
      `SELECT event_type, event_data FROM alert_events WHERE alert_id = $1 AND event_type = 'triggered';`,
      [userBAlertId]
    );
    assert.equal(eventRes.rowCount, 1);
    const eventData = eventRes.rows[0].event_data;
    assert.equal(eventData.has_location, false);
    assert.equal(eventData.location_status, 'unavailable');
    assert.equal(eventData.reason, 'PERMISSION_DENIED');
  });

  test('6. Invalid latitude/longitude rejection on location updates', async () => {
    // Bad latitude (> 90)
    const resBadLat = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 99.5,
        longitude: -122.4,
      })
      .expect(400);

    assert.equal(resBadLat.body.status, 'error');

    // Bad longitude (< -180)
    const resBadLng = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.7,
        longitude: -195.0,
      })
      .expect(400);

    assert.equal(resBadLng.body.status, 'error');

    // Bad accuracy (< 0)
    const resBadAcc = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.7,
        longitude: -122.4,
        accuracy_meters: -5,
      })
      .expect(400);

    assert.equal(resBadAcc.body.status, 'error');
  });

  test('7. Push valid location coordinate breadcrumb to active alert', async () => {
    const res = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.7755,
        longitude: -122.4185,
        accuracy_meters: 5.0,
        speed_mps: 2.1,
      })
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.location);
    assert.equal(res.body.data.location.latitude, 37.7755);
    assert.equal(res.body.data.location.longitude, -122.4185);
    assert.equal(res.body.data.location.accuracy_meters, 5.0);

    // Verify multiple breadcrumbs in DB
    const countRes = await query('SELECT count(*) FROM alert_locations WHERE alert_id = $1;', [alertAId]);
    assert.equal(parseInt(countRes.rows[0].count, 10), 2);
  });

  test('8. Cross-user location update returns 404 (tenant isolation)', async () => {
    // User B attempts to push location to User A's alert
    const res = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        latitude: 37.7750,
        longitude: -122.4190,
      })
      .expect(404);

    assert.equal(res.body.status, 'error');
    assert.match(res.body.message, /not found/i);
  });

  test('9. Active alert retrieval via GET /api/v1/alerts/active', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/active')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.alert);
    assert.equal(res.body.data.alert.id, alertAId);
    assert.equal(res.body.data.alert.status, 'active');
    assert.ok(res.body.data.alert.location);
    // Should return latest location breadcrumb (37.7755)
    assert.equal(Math.round(res.body.data.alert.location.latitude * 1000) / 1000, 37.776);
    // Ensure tracking token hash is NOT leaked
    assert.equal(res.body.data.alert.tracking_token_hash, undefined);
  });

  test('10. Cross-user resolution returns 404 (tenant isolation)', async () => {
    // User B attempts to resolve User A's alert
    const res = await request(app)
      .post(`/api/v1/alerts/${alertAId}/resolve`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ reason: 'Malicious resolve' })
      .expect(404);

    assert.equal(res.body.status, 'error');
  });

  test('11. Alert resolution sets status and records audit event', async () => {
    const res = await request(app)
      .post(`/api/v1/alerts/${alertAId}/resolve`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ reason: 'Reached safe location' })
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.data.alert.status, 'resolved');
    assert.ok(res.body.data.alert.resolved_at);

    // Idempotent resolution check
    const idempotentRes = await request(app)
      .post(`/api/v1/alerts/${alertAId}/resolve`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ reason: 'Another attempt' })
      .expect(200);

    assert.equal(idempotentRes.body.status, 'ok');
    assert.match(idempotentRes.body.message, /already resolved/i);

    // Active alert retrieval now returns null for User A
    const activeRes = await request(app)
      .get('/api/v1/alerts/active')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(activeRes.body.data.alert, null);
  });

  test('12. Location update after resolution is rejected with 400', async () => {
    const res = await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.7760,
        longitude: -122.4180,
      })
      .expect(400);

    assert.equal(res.body.status, 'error');
    assert.match(res.body.message, /resolved/i);
  });

  test('13. Audit event creation verification', async () => {
    const eventsRes = await query(
      'SELECT event_type, event_data FROM alert_events WHERE alert_id = $1 ORDER BY created_at ASC;',
      [alertAId]
    );

    const types = eventsRes.rows.map((r) => r.event_type);
    assert.ok(types.includes('triggered'));
    assert.ok(types.includes('location_updated'));
    assert.ok(types.includes('resolved'));

    // Check resolve event data
    const resolveEvent = eventsRes.rows.find((r) => r.event_type === 'resolved');
    assert.ok(resolveEvent);
    assert.equal(resolveEvent.event_data.reason, 'Reached safe location');
    assert.equal(resolveEvent.event_data.resolved_by, 'user');

    // Confirm raw tracking token is NEVER present in any event_data
    for (const row of eventsRes.rows) {
      const dataStr = JSON.stringify(row.event_data);
      assert.equal(dataStr.includes(alertARawToken), false);
    }
  });
});
