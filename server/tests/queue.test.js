import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';
import {
  ALERT_DISPATCH_QUEUE,
  initQueueService,
  enqueueAlertDispatch,
  getQueueStatus,
  closeQueueService,
} from '../src/services/queueService.js';

describe('Phase B: Asynchronous Dispatch Queue (pg-boss)', () => {
  let dbAvailable = false;
  let queueReady = false;
  let userId = '';
  let userToken = '';
  let contactId = '';

  const waitFor = async (checkFn, timeoutMs = 20000, intervalMs = 250) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await checkFn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  };

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (!dbAvailable) return;

    // Deterministic fallback: never attempt real SMTP or Twilio from the test suite.
    delete process.env.SMTP_HOST;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;

    try {
      await initQueueService();
      queueReady = true;
    } catch (err) {
      console.error('[Queue Test] pg-boss failed to start:', err.message);
    }

    const res = await request(app).post('/api/v1/auth/register').send({
      full_name: 'Queue Dispatch Test User',
      email: `queue.dispatch.${Date.now()}@example.local`,
      password: 'QueuePassword123!',
    });
    if (res.body?.data) {
      userToken = res.body.data.token;
      userId = res.body.data.user.id;

      const contactRes = await request(app)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          contact_name: 'Queue Email Recipient',
          contact_email: `queue.recipient.${Date.now()}@example.local`,
          priority_order: 1,
        });
      contactId = contactRes.body?.data?.contact?.id || '';
    }
  });

  after(async () => {
    await closeQueueService();
    if (dbAvailable && userId) {
      await query(
        `DELETE FROM alert_locations WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
        [userId]
      );
      await query(
        `DELETE FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
        [userId]
      );
      await query(`DELETE FROM alerts WHERE user_id = $1;`, [userId]);
      await query(`DELETE FROM emergency_contacts WHERE user_id = $1;`, [userId]);
      await query(`DELETE FROM users WHERE id = $1;`, [userId]);
    }
    await closePool();
  });

  test('1. pg-boss starts and the alert.dispatch queue is created', async () => {
    if (!dbAvailable) return;
    assert.equal(queueReady, true, 'queue service must be initialized');
    assert.equal(ALERT_DISPATCH_QUEUE, 'alert.dispatch');

    const status = await getQueueStatus();
    assert.equal(status.available, true);
    assert.equal(typeof status.queued, 'number');
  });

  test('2. Triggering an SOS enqueues a job that records a notification_dispatched audit event', async () => {
    if (!queueReady || !userToken) return;

    const trigger = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: { latitude: 40.7128, longitude: -74.006, accuracy_meters: 10 },
      })
      .expect(201);

    const alertId = trigger.body.data.alert.id;

    const auditRow = await waitFor(async () => {
      const res = await query(
        `SELECT event_data, created_at FROM alert_events
         WHERE alert_id = $1 AND event_type = 'notification_dispatched'
         LIMIT 1;`,
        [alertId]
      );
      return res.rowCount > 0 ? res.rows[0] : null;
    });

    assert.ok(auditRow, 'expected a notification_dispatched audit event from the worker');
    const data =
      typeof auditRow.event_data === 'string' ? JSON.parse(auditRow.event_data) : auditRow.event_data;
    assert.ok(Array.isArray(data.channels), 'audit event should list attempted channels');
    assert.ok(data.channels.includes('realtime'));
    assert.ok(data.channels.includes('email'));
    assert.ok(data.channels.includes('sms'));
    assert.ok(data.job_id, 'audit event should reference the pg-boss job id');

    // Phase C: the seeded emergency contact must receive the alert email.
    assert.ok(contactId, 'expected an emergency contact to be seeded');
    assert.equal(data.email.sent, 1, 'expected exactly one email to be delivered');
    assert.equal(data.email.failed, 0);
    assert.deepEqual(data.email.recipient_contact_ids, [contactId]);

    // SMS is unavailable without Twilio credentials and must be reported, not faked.
    assert.equal(data.sms.attempted, false);
    assert.equal(data.sms.transport, 'none');
    assert.ok(data.sms.skip_reasons.includes('sms_not_configured'));

    // Delivery ledger: destinations are masked before storage.
    const ledger = await query(
      `SELECT channel, destination, status, provider_message_id, delivered_at
       FROM notification_attempts
       WHERE alert_id = $1 AND emergency_contact_id = $2 AND channel = 'email';`,
      [alertId, contactId]
    );
    assert.equal(ledger.rowCount, 1, 'expected one email receipt');
    assert.equal(ledger.rows[0].status, 'sent');
    assert.ok(ledger.rows[0].destination.includes('***@'), 'email destination must be masked');
    assert.ok(!ledger.rows[0].destination.includes('queue.recipient'), 'raw address must not be stored');
    assert.ok(ledger.rows[0].delivered_at, 'sent receipts must record delivered_at');
  });

  test('3. Queue depth reports job counts after processing', async () => {
    if (!queueReady) return;

    const status = await getQueueStatus();
    assert.equal(status.available, true);
    assert.equal(typeof status.ready, 'number');
    assert.equal(typeof status.active, 'number');
    assert.equal(typeof status.failed, 'number');
  });

  test('4. Enqueue is a safe no-op once the queue service is stopped', async () => {
    if (!queueReady) return;

    await closeQueueService();

    const jobId = await enqueueAlertDispatch('00000000-0000-4000-8000-000000000000');
    assert.equal(jobId, null);
  });
});
