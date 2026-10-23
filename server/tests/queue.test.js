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
    assert.equal(data.channel, 'realtime');
    assert.ok(data.job_id, 'audit event should reference the pg-boss job id');
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
