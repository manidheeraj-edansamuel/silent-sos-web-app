import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';

describe('Authentication API Endpoint Tests (/api/v1/auth)', () => {
  let dbAvailable = false;
  const testUser = {
    full_name: 'Test Emergency User',
    email: `test.auth.${Date.now()}@example.local`,
    phone_number: '+15550001122',
    password: 'SecureAuthPassword123!',
  };

  let authToken = '';
  let registeredUserId = '';

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    if (dbAvailable) {
      // Ensure migration 008 columns exist if db is active
      await query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL,
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;
      `);
    }
  });

  after(async () => {
    if (dbAvailable && registeredUserId) {
      // Clean up test user
      await query('DELETE FROM users WHERE id = $1;', [registeredUserId]);
    }
    await closePool();
  });

  test('1. POST /api/v1/auth/register - Successfully registers user and hashes password with Argon2id', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(201);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.user, 'User object should be returned');
    assert.ok(res.body.data.token, 'JWT token should be returned');
    assert.equal(res.body.data.user.email, testUser.email.toLowerCase());
    assert.equal(res.body.data.user.full_name, testUser.full_name);

    // SECURITY CHECK: password_hash must NEVER be exposed
    assert.equal(res.body.data.user.password_hash, undefined, 'password_hash must NEVER be returned in response');
    assert.equal(res.body.data.user.password, undefined, 'Plaintext password must NEVER be in response');

    registeredUserId = res.body.data.user.id;
    authToken = res.body.data.token;

    // Direct database verification of Argon2id storage
    const dbRecord = await query('SELECT password_hash FROM users WHERE id = $1;', [registeredUserId]);
    assert.ok(dbRecord.rows[0].password_hash.startsWith('$argon2id$'), 'Stored password in DB must be Argon2id hash');
    assert.notEqual(dbRecord.rows[0].password_hash, testUser.password, 'DB must not store plaintext password');
  });

  test('2. POST /api/v1/auth/register - Rejects duplicate email registration with 409 Conflict', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        full_name: 'Duplicate User',
        email: testUser.email.toUpperCase(), // Test case-insensitive duplicate check
        password: 'AnotherPassword123!',
      })
      .expect(409);

    assert.equal(res.body.status, 'error');
    assert.ok(res.body.message.includes('already exists'), 'Should state account already exists');
  });

  test('3. POST /api/v1/auth/register - Validates input fields defensively', async () => {
    // Missing full_name
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'bad@example.com', password: 'ValidPassword123!' })
      .expect(400);

    // Invalid email format
    await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'John Doe', email: 'invalid-email', password: 'ValidPassword123!' })
      .expect(400);

    // Password too short (< 8 chars)
    await request(app)
      .post('/api/v1/auth/register')
      .send({ full_name: 'John Doe', email: 'john@example.com', password: 'short' })
      .expect(400);
  });

  test('4. POST /api/v1/auth/login - Successfully logs in with correct credentials', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.data.token, 'Token must be provided on login');
    assert.equal(res.body.data.user.id, registeredUserId);
    assert.equal(res.body.data.user.password_hash, undefined, 'password_hash must NOT be in login response');
    assert.ok(res.body.data.user.last_login_at, 'last_login_at must be populated');

    authToken = res.body.data.token;
  });

  test('5. POST /api/v1/auth/login - Rejects invalid password with generic 401', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testUser.email,
        password: 'IncorrectPassword999!',
      })
      .expect(401);

    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Invalid email or password.');
  });

  test('6. POST /api/v1/auth/login - Rejects non-existent email with generic 401', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'does.not.exist@example.local',
        password: 'SomePassword123!',
      })
      .expect(401);

    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Invalid email or password.');
  });

  test('7. GET /api/v1/auth/me - Returns safe profile for authenticated user', async (t) => {
    if (!dbAvailable) {
      t.skip('Database unavailable for live query tests');
      return;
    }

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.data.user.id, registeredUserId);
    assert.equal(res.body.data.user.email, testUser.email.toLowerCase());
    assert.equal(res.body.data.user.password_hash, undefined, 'password_hash must NEVER be exposed in /me');
  });

  test('8. GET /api/v1/auth/me - Rejects unauthenticated or malformed requests with 401', async () => {
    // Missing Authorization header
    await request(app)
      .get('/api/v1/auth/me')
      .expect(401);

    // Invalid format
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Basic 12345')
      .expect(401);

    // Invalid / forged token
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid_forged_token_xyz')
      .expect(401);
  });

  test('9. POST /api/v1/auth/logout - Returns success response', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .expect(200);

    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.message.includes('Logged out'), 'Should confirm logout');
  });
});
