import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';
import { recordNotificationAttempt } from '../src/services/notificationLedger.js';

describe('Phase C: Delivery Receipts API (/api/v1/alerts/:id/notifications)', () => {
  let dbAvailable = false;
  let ownerToken = '';
  let ownerId = '';
  let otherToken = '';
  let otherId = '';
  let alertId = '';
  let contactId = '';

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (!dbAvailable) return;

    const owner = await request(app).post('/api/v1/auth/register').send({
      full_name: 'Receipt Owner',
      email: `receipts.owner.${Date.now()}@example.local`,
      password: 'ReceiptPassword123!',
    });
    ownerToken = owner.body.data.token;
    ownerId = owner.body.data.user.id;

    const other = await request(app).post('/api/v1/auth/register').send({
      full_name: 'Receipt Other',
      email: `receipts.other.${Date.now()}@example.local`,
      password: 'ReceiptPassword123!',
    });
    otherToken = other.body.data.token;
    otherId = other.body.data.user.id;

    const contact = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        contact_name: 'Receipt Contact',
        contact_phone: '+15550199001',
        contact_email: `receipt.contact.${Date.now()}@example.local`,
        priority_order: 1,
      });
    contactId = contact.body.data.contact.id;

    const trigger = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: { latitude: 40.7128, longitude: -74.006, accuracy_meters: 10 },
      });
    alertId = trigger.body.data.alert.id;

    await recordNotificationAttempt({
      alertId,
      contactId,
      channel: 'email',
      destination: 'receipt.contact@example.local',
      status: 'sent',
      providerMessageId: 'em_test_1',
      attemptNumber: 1,
    });
    await recordNotificationAttempt({
      alertId,
      contactId,
      channel: 'sms',
      destination: '+15550199001',
      status: 'failed',
      attemptNumber: 1,
      errorMessage: 'carrier rejected',
    });
  });

  after(async () => {
    if (dbAvailable) {
      for (const id of [ownerId, otherId]) {
        if (!id) continue;
        await query(
          `DELETE FROM notification_attempts WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
          [id]
        );
        await query(
          `DELETE FROM alert_locations WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
          [id]
        );
        await query(
          `DELETE FROM alert_events WHERE alert_id IN (SELECT id FROM alerts WHERE user_id = $1);`,
          [id]
        );
        await query(`DELETE FROM alerts WHERE user_id = $1;`, [id]);
        await query(`DELETE FROM emergency_contacts WHERE user_id = $1;`, [id]);
        await query(`DELETE FROM users WHERE id = $1;`, [id]);
      }
    }
    await closePool();
  });

  test('1. Unauthenticated requests are rejected with 401', async () => {
    if (!dbAvailable) return;
    await request(app).get(`/api/v1/alerts/${alertId}/notifications`).expect(401);
  });

  test('2. Invalid UUIDs are rejected with 400', async () => {
    if (!dbAvailable) return;
    await request(app)
      .get('/api/v1/alerts/not-a-uuid/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  test('3. Another user cannot read the receipts (tenant isolation)', async () => {
    if (!dbAvailable) return;
    await request(app)
      .get(`/api/v1/alerts/${alertId}/notifications`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  test('4. Owner receives masked receipts and per-channel counts', async () => {
    if (!dbAvailable) return;

    const res = await request(app)
      .get(`/api/v1/alerts/${alertId}/notifications`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const data = res.body.data;
    assert.equal(data.alert_id, alertId);
    assert.equal(data.counts.total, 2);
    assert.equal(data.counts.sent, 1);
    assert.equal(data.counts.failed, 1);
    assert.equal(data.counts.by_channel.email.sent, 1);
    assert.equal(data.counts.by_channel.sms.failed, 1);

    const emailRow = data.attempts.find((a) => a.channel === 'email');
    const smsRow = data.attempts.find((a) => a.channel === 'sms');
    assert.ok(emailRow);
    assert.ok(smsRow);

    assert.equal(emailRow.status, 'sent');
    assert.equal(emailRow.provider_message_id, 'em_test_1');
    assert.equal(emailRow.contact.contact_name, 'Receipt Contact');
    assert.equal(emailRow.destination, 'r***@example.local');
    assert.ok(!emailRow.destination.includes('receipt.contact'), 'raw address must not be returned');

    assert.equal(smsRow.status, 'failed');
    assert.equal(smsRow.destination, '+15***9001');
    assert.equal(smsRow.error_message, 'carrier rejected');
  });
});
