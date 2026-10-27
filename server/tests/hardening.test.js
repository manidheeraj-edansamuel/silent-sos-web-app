import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/database.js';

describe('Phase E: Production Hardening', () => {
  after(async () => {
    await closePool();
  });

  test('1. Does not advertise Express and sets baseline security headers', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    assert.equal(res.headers['x-powered-by'], undefined, 'X-Powered-By must be removed');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['content-security-policy'], 'CSP header must be present');
    assert.ok(res.headers['x-frame-options'], 'Frame protection header must be present');
    assert.ok(res.headers['referrer-policy'], 'Referrer policy header must be present');
  });

  test('2. API responses are marked no-store', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('3. Rejects JSON payloads larger than 64kb with 413', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Content-Type', 'application/json')
      .send({ padding: 'x'.repeat(100 * 1024) })
      .expect(413);

    assert.equal(res.body.status, 'error');
  });

  test('4. Rejects malformed JSON with a JSON 400 response', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "broken"')
      .expect(400);

    assert.equal(res.body.status, 'error');
  });

  test('5. Unknown API routes return JSON 404 without leaking internals', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);

    assert.equal(res.body.status, 'error');
    assert.match(res.body.message, /Resource not found/);
    assert.equal(res.body.stack, undefined, '404 responses must not include stack traces');
  });

  test('6. Public push config exposes only the public VAPID key', async () => {
    const res = await request(app).get('/api/v1/alerts/push/config').expect(200);

    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.data.enabled, 'boolean');
    assert.ok(typeof res.body.data.public_key === 'string' && res.body.data.public_key.length > 0);
    assert.equal(res.body.data.private_key, undefined);
    assert.equal(res.body.data.privateKey, undefined);
  });
});
