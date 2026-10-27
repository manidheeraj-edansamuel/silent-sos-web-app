import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';
import {
  deliverPushToSubscriptions,
  notifyLocationUpdate,
  notifyAlertResolved,
} from '../src/services/webPushService.js';

describe('Phase C: Web Push Notifications (/api/v1/alerts/push)', () => {
  let dbAvailable = false;
  let userToken = '';
  let userId = '';
  let alertId = '';
  let trackingToken = '';

  const makeSubscription = (suffix) => ({
    endpoint: `https://push.example.test/subscriptions/${suffix}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'C'.repeat(22) },
    expirationTime: null,
  });

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (!dbAvailable) return;

    const register = await request(app).post('/api/v1/auth/register').send({
      full_name: 'Web Push Test User',
      email: `webpush.${Date.now()}@example.local`,
      password: 'WebPushPassword123!',
    });
    userToken = register.body?.data?.token || '';
    userId = register.body?.data?.user?.id || '';

    const trigger = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: { latitude: 51.5074, longitude: -0.1278, accuracy_meters: 12 },
      })
      .expect(201);

    alertId = trigger.body.data.alert.id;
    trackingToken = trigger.body.data.alert.tracking_token;
  });

  after(async () => {
    if (dbAvailable && userId) {
      await query(
        `DELETE FROM alert_locations WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
        [userId]
      );
      await query(
        `DELETE FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
        [userId]
      );
      await query(
        `DELETE FROM push_subscriptions WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
        [userId]
      );
      await query(`DELETE FROM alerts WHERE user_id = $1;`, [userId]);
      await query(`DELETE FROM users WHERE id = $1;`, [userId]);
    }
    await closePool();
  });

  test('1. Push configuration exposes only the VAPID public key', async () => {
    if (!dbAvailable) return;

    const res = await request(app).get('/api/v1/alerts/push/config').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.data.enabled, 'boolean');
    assert.equal(res.body.data.vapid_configured, Boolean(process.env.VAPID_PUBLIC_KEY));

    if (res.body.data.enabled) {
      assert.match(res.body.data.public_key, /^[A-Za-z0-9_-]{80,}$/);
    }
  });

  test('2. Subscription requests validate token and payload', async () => {
    if (!dbAvailable) return;

    await request(app)
      .post('/api/v1/alerts/track/not-a-valid-token!/push-subscriptions')
      .send({ subscription: makeSubscription('invalid-token') })
      .expect(400);

    await request(app)
      .post(`/api/v1/alerts/track/${'z'.repeat(32)}/push-subscriptions`)
      .send({ subscription: makeSubscription('unknown-token') })
      .expect(404);

    const invalidPayload = await request(app)
      .post(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .send({
        subscription: {
          endpoint: 'http://insecure.example.test/push',
          keys: { p256dh: 'short', auth: 'short' },
        },
      })
      .expect(400);

    assert.ok(Array.isArray(invalidPayload.body.errors));
    assert.ok(invalidPayload.body.errors.length >= 2);
  });

  test('3. A valid tracking token registers an encrypted alert-scoped subscription', async () => {
    if (!dbAvailable) return;

    const subscription = makeSubscription('primary');
    const res = await request(app)
      .post(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .set('User-Agent', 'SilentSOS-Test-Agent')
      .send({ subscription })
      .expect(201);

    assert.ok(res.body.data.subscription.id);
    assert.equal(res.body.data.subscription.endpoint, undefined, 'endpoint must not be echoed');

    const rows = await query(
      `SELECT endpoint, p256dh, auth, tracking_token_encrypted, user_agent
       FROM push_subscriptions WHERE alert_id = $1;`,
      [alertId]
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].endpoint, subscription.endpoint);
    assert.equal(rows.rows[0].p256dh, subscription.keys.p256dh);
    assert.equal(rows.rows[0].user_agent, 'SilentSOS-Test-Agent');

    // The raw tracking token must never be stored in plaintext.
    assert.notEqual(rows.rows[0].tracking_token_encrypted, trackingToken);
    assert.equal(rows.rows[0].tracking_token_encrypted.split('.').length, 3);
    assert.ok(!rows.rows[0].tracking_token_encrypted.includes(trackingToken));
  });

  test('4. Re-registering the same endpoint upserts instead of duplicating', async () => {
    if (!dbAvailable) return;

    await request(app)
      .post(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .send({ subscription: makeSubscription('primary') })
      .expect(201);

    const rows = await query(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE alert_id = $1;`,
      [alertId]
    );
    assert.equal(rows.rows[0].count, 1);
  });

  test('5. Location pushes are delivered with a click-through link and then throttled', async () => {
    if (!dbAvailable) return;

    const delivered = [];
    const stubSend = async (subscription, body) => {
      delivered.push(JSON.parse(body));
      return { statusCode: 201 };
    };

    const first = await notifyLocationUpdate(
      alertId,
      { latitude: 51.5074, longitude: -0.1278, accuracy_meters: 12 },
      { sendFn: stubSend, intervalSeconds: 120 }
    );
    assert.equal(first.sent, 1);
    assert.equal(first.attempted, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].event, 'location_update');
    assert.ok(delivered[0].url.includes(`?track=${trackingToken}`), 'push must link back to the portal');
    assert.ok(delivered[0].body.includes('51.50740'));

    const second = await notifyLocationUpdate(
      alertId,
      { latitude: 51.5075, longitude: -0.1279, accuracy_meters: 10 },
      { sendFn: stubSend, intervalSeconds: 120 }
    );
    assert.equal(second.skipped, 'throttled');
    assert.equal(second.sent, 0);
    assert.equal(delivered.length, 1, 'throttled push must not hit the transport');
  });

  test('6. Stale push endpoints (410) are removed without throwing', async () => {
    if (!dbAvailable) return;

    const staleSubscription = makeSubscription('stale');
    await request(app)
      .post(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .send({ subscription: staleSubscription })
      .expect(201);

    const staleRow = await query(
      `SELECT id, endpoint, p256dh, auth, expiration_time
       FROM push_subscriptions WHERE alert_id = $1 AND endpoint = $2;`,
      [alertId, staleSubscription.endpoint]
    );

    const summary = await deliverPushToSubscriptions(
      staleRow.rows,
      { event: 'location_update', title: 'Test', body: 'Test', url: '/', tag: 'test' },
      async () => {
        const err = new Error('Gone');
        err.statusCode = 410;
        throw err;
      }
    );

    assert.equal(summary.attempted, 1);
    assert.equal(summary.removed, 1);
    assert.equal(summary.failed, 0);

    const remaining = await query(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE id = $1;`,
      [staleRow.rows[0].id]
    );
    assert.equal(remaining.rows[0].count, 0);
  });

  test('7. Resolution push fires once, audits delivery, and clears subscriptions', async () => {
    if (!dbAvailable) return;

    const delivered = [];
    const stubSend = async (subscription, body) => {
      delivered.push(JSON.parse(body));
      return { statusCode: 201 };
    };

    const summary = await notifyAlertResolved(alertId, { sendFn: stubSend });
    assert.equal(summary.sent, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].event, 'resolved');
    assert.ok(delivered[0].url.includes(`?track=${trackingToken}`));
    assert.match(delivered[0].body, /marked the SOS emergency alert as resolved/);

    const rows = await query(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE alert_id = $1;`,
      [alertId]
    );
    assert.equal(rows.rows[0].count, 0, 'resolved alerts must drop their subscriptions');

    const audit = await query(
      `SELECT event_data FROM alert_events
       WHERE alert_id = $1 AND event_type = 'push_dispatched';`,
      [alertId]
    );
    assert.equal(audit.rowCount, 1);
    const data =
      typeof audit.rows[0].event_data === 'string'
        ? JSON.parse(audit.rows[0].event_data)
        : audit.rows[0].event_data;
    assert.equal(data.event, 'resolved');
    assert.equal(data.sent, 1);
  });

  test('8. Unsubscribe removes the subscription and is idempotent', async () => {
    if (!dbAvailable) return;

    await request(app)
      .delete(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .send({ endpoint: makeSubscription('primary').endpoint })
      .expect(200);

    await request(app)
      .delete(`/api/v1/alerts/track/${trackingToken}/push-subscriptions`)
      .send({ endpoint: makeSubscription('primary').endpoint })
      .expect(200);
  });
});
