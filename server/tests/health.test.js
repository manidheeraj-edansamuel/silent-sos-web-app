import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/database.js';

describe('API v1 Health Endpoint Tests', () => {
  after(async () => {
    await closePool();
  });

  test('GET /api/v1/health should return valid health payload with services report', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/);

    // Response could be 200 (healthy) or 503 (degraded if db unreachable in isolated test)
    assert.ok(
      [200, 503].includes(response.status),
      `Expected status 200 or 503, got ${response.status}`
    );
    assert.ok(
      ['ok', 'degraded'].includes(response.body.status),
      'Response status must be ok or degraded'
    );
    assert.equal(response.body.service, 'silent-sos-api', 'Service identifier must match');
    assert.equal(response.body.version, 'v1', 'API version must be "v1"');
    assert.ok(response.body.timestamp, 'Timestamp must be present');
    assert.ok(!isNaN(Date.parse(response.body.timestamp)), 'Timestamp must be a valid ISO date');
    assert.ok(response.body.services, 'Services health breakdown must be present');
    assert.equal(response.body.services.api, 'ok', 'API service status must be "ok"');
    assert.ok(
      ['ok', 'unavailable'].includes(response.body.services.database),
      'Database service status must be "ok" or "unavailable"'
    );
  });

  test('GET /api/v1/unknown-route should return HTTP 404 with error payload', async () => {
    const response = await request(app)
      .get('/api/v1/unknown-route')
      .expect('Content-Type', /json/)
      .expect(404);

    assert.equal(response.status, 404, 'HTTP status code must be 404');
    assert.equal(response.body.status, 'error', 'Response status field must be "error"');
  });
});
