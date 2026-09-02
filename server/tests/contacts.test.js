import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';

describe('Emergency Contacts API Tests (/api/v1/contacts)', () => {
  let dbAvailable = false;

  let userAToken = '';
  let userAId = '';
  let userBToken = '';
  let userBId = '';

  let contactA1Id = '';
  let contactA2Id = '';

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (dbAvailable) {
      // Register User A
      const resA = await request(app)
        .post('/api/v1/auth/register')
        .send({
          full_name: 'User Alpha',
          email: `alpha.${Date.now()}@example.local`,
          password: 'AlphaPassword123!',
        });
      if (resA.body.data) {
        userAToken = resA.body.data.token;
        userAId = resA.body.data.user.id;
      }

      // Register User B for ownership isolation testing
      const resB = await request(app)
        .post('/api/v1/auth/register')
        .send({
          full_name: 'User Beta',
          email: `beta.${Date.now()}@example.local`,
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
      if (userAId) await query('DELETE FROM users WHERE id = $1;', [userAId]);
      if (userBId) await query('DELETE FROM users WHERE id = $1;', [userBId]);
    }
    await closePool();
  });

  test('1. Unauthenticated requests to /api/v1/contacts are rejected with 401', async () => {
    await request(app).get('/api/v1/contacts').expect(401);
    await request(app).post('/api/v1/contacts').send({ contact_name: 'Test' }).expect(401);
  });

  test('2. POST /api/v1/contacts - Creates contact for User A with validation and priority', async (t) => {
    if (!dbAvailable || !userAToken) {
      t.skip('Database or user token unavailable');
      return;
    }

    // Add first contact
    const res1 = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        contact_name: 'Dr. Sarah Connor',
        contact_phone: '+15551234567',
        contact_email: 'sarah@example.local',
        priority_order: 1,
      })
      .expect(201);

    assert.equal(res1.body.status, 'ok');
    assert.equal(res1.body.data.contact.contact_name, 'Dr. Sarah Connor');
    assert.equal(res1.body.data.contact.priority_order, 1);
    assert.equal(res1.body.data.contact.user_id, userAId);
    contactA1Id = res1.body.data.contact.id;

    // Add second contact (auto-calculated priority)
    const res2 = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        contact_name: 'John Connor',
        contact_phone: '+15557654321',
      })
      .expect(201);

    assert.equal(res2.body.data.contact.priority_order, 2);
    contactA2Id = res2.body.data.contact.id;
  });

  test('3. POST /api/v1/contacts - Validates required contact fields', async (t) => {
    if (!dbAvailable || !userAToken) {
      t.skip('Database or user token unavailable');
      return;
    }

    // Missing communication method (neither phone nor email)
    await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ contact_name: 'Empty Contact' })
      .expect(400);

    // Empty contact_name
    await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ contact_name: '', contact_phone: '+15551234567' })
      .expect(400);

    // Invalid priority_order (0 or negative)
    await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ contact_name: 'Test', contact_phone: '+15551234567', priority_order: 0 })
      .expect(400);
  });

  test('4. GET /api/v1/contacts - Returns only User A contacts ordered by priority', async (t) => {
    if (!dbAvailable || !userAToken) {
      t.skip('Database or user token unavailable');
      return;
    }

    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.data.count, 2);
    assert.equal(res.body.data.contacts[0].priority_order, 1);
    assert.equal(res.body.data.contacts[1].priority_order, 2);
  });

  test('5. Strict Multi-Tenant Isolation - User B cannot view User A contacts', async (t) => {
    if (!dbAvailable || !userBToken || !contactA1Id) {
      t.skip('Database or tokens unavailable');
      return;
    }

    // User B lists their own contacts -> should be empty
    const listRes = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(200);

    assert.equal(listRes.body.data.count, 0, 'User B must not see User A contacts');

    // User B attempts to access User A contact directly by ID -> 404 (preventing leakage)
    await request(app)
      .get(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(404);

    // User B attempts to modify User A contact -> 404
    await request(app)
      .put(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ contact_name: 'Malicious Change' })
      .expect(404);

    // User B attempts to delete User A contact -> 404
    await request(app)
      .delete(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(404);
  });

  test('6. PUT /api/v1/contacts/:id - Updates contact details and priority for User A', async (t) => {
    if (!dbAvailable || !userAToken || !contactA1Id) {
      t.skip('Database or contact ID unavailable');
      return;
    }

    const res = await request(app)
      .put(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        contact_name: 'Dr. Sarah Connor (Updated)',
        contact_phone: '+15559998888',
      })
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.data.contact.contact_name, 'Dr. Sarah Connor (Updated)');
    assert.equal(res.body.data.contact.contact_phone, '+15559998888');
  });

  test('7. DELETE /api/v1/contacts/:id - Deletes contact and recompactions priority for User A', async (t) => {
    if (!dbAvailable || !userAToken || !contactA1Id) {
      t.skip('Database or contact ID unavailable');
      return;
    }

    const delRes = await request(app)
      .delete(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(delRes.body.status, 'ok');

    // Verify contact is gone
    await request(app)
      .get(`/api/v1/contacts/${contactA1Id}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);

    // Verify remaining contact recompacted to priority 1
    const listRes = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    assert.equal(listRes.body.data.count, 1);
    assert.equal(listRes.body.data.contacts[0].priority_order, 1);
  });
});
