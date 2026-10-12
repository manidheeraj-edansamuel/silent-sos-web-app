import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import app from '../src/app.js';
import { query, checkDbHealth, closePool } from '../src/config/database.js';
import { initSocketServer, closeSocketServer } from '../src/services/socketService.js';

describe('Step 5B: Real-Time Location Gateway Tests (Socket.IO)', () => {
  let dbAvailable = false;
  let httpServer;
  let serverPort;
  let serverUrl;

  let userAToken = '';
  let userAId = '';
  let alertAId = '';
  let alertATrackingToken = '';

  let userBToken = '';
  let userBId = '';
  let alertBId = '';
  let alertBTrackingToken = '';

  const activeSockets = [];

  // Helper to create and track test socket client
  function createClient(options = {}) {
    const client = Client(serverUrl, {
      transports: ['websocket'],
      autoConnect: true,
      forceNew: true,
      ...options,
    });
    activeSockets.push(client);
    return client;
  }

  before(async () => {
    const health = await checkDbHealth();
    dbAvailable = health.isHealthy;
    assert.ok(dbAvailable, 'Database must be available for Socket.IO tests');

    // 1. Start HTTP Server and attach Socket.IO
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        serverUrl = `http://localhost:${serverPort}`;
        resolve();
      });
    });

    // 2. Setup Test User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        full_name: 'Socket Test User Alpha',
        email: `socket.alpha.${Date.now()}@example.local`,
        password: 'PasswordAlpha123!',
      });
    userAToken = resA.body.data.token;
    userAId = resA.body.data.user.id;

    // Trigger Alert for User A
    const alertResA = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy_meters: 10.0,
        },
      });
    alertAId = alertResA.body.data.alert.id;
    alertATrackingToken = alertResA.body.data.alert.tracking_token;

    // 3. Setup Test User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        full_name: 'Socket Test User Beta',
        email: `socket.beta.${Date.now()}@example.local`,
        password: 'PasswordBeta123!',
      });
    userBToken = resB.body.data.token;
    userBId = resB.body.data.user.id;

    // Trigger Alert for User B
    const alertResB = await request(app)
      .post('/api/v1/alerts/trigger')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        trigger_source: 'manual_ui',
        location: {
          latitude: 40.7128,
          longitude: -74.006,
          accuracy_meters: 5.0,
        },
      });
    alertBId = alertResB.body.data.alert.id;
    alertBTrackingToken = alertResB.body.data.alert.tracking_token;
  });

  after(async () => {
    // Disconnect all socket clients
    for (const socket of activeSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }

    // Close Socket.IO server
    await closeSocketServer();

    // Close HTTP Server
    if (httpServer && httpServer.listening) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Clean up test database data
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

  test('1. Authorized recipient subscription via event message', async () => {
    const client = createClient();

    await new Promise((resolve) => {
      client.on('connect', resolve);
    });

    const confirmed = await new Promise((resolve) => {
      client.emit(
        'subscribe:alert',
        { token: alertATrackingToken },
        (res) => {
          resolve(res);
        }
      );
    });

    assert.equal(confirmed.status, 'ok');
    assert.equal(confirmed.alert_id, alertAId);
    assert.equal(confirmed.alert_status, 'active');
  });

  test('2. Authorized recipient subscription via handshake auth token', async () => {
    const client = createClient({
      auth: { token: alertATrackingToken },
    });

    const confirmed = await new Promise((resolve) => {
      client.on('subscription:confirmed', (data) => {
        resolve(data);
      });
    });

    assert.equal(confirmed.status, 'ok');
    assert.equal(confirmed.alert_id, alertAId);
  });

  test('3. Rejection of invalid and unknown tracking tokens', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));

    // Malformed token format
    const malformedErr = await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: 'bad!token' }, (res) => {
        resolve(res);
      });
    });
    assert.equal(malformedErr.status, 'error');
    assert.match(malformedErr.message, /invalid tracking token format/i);

    // Unknown/unregistered token
    const unknownErr = await new Promise((resolve) => {
      client.emit(
        'subscribe:alert',
        { token: 'nonExistentToken1234567890123456' },
        (res) => {
          resolve(res);
        }
      );
    });
    assert.equal(unknownErr.status, 'error');
    assert.match(unknownErr.message, /not found or link has expired/i);
  });

  test('4. Handshake authentication rejection for invalid token', async () => {
    const client = createClient({
      auth: { token: 'invalidToken12345678901234567890' },
    });

    const err = await new Promise((resolve) => {
      client.on('connect_error', (error) => {
        resolve(error);
      });
    });

    assert.ok(err);
    assert.match(err.message, /Authentication failed/i);
  });

  test('5. Rejection of unauthorized room subscription spoofing (token does not match requested alert_id)', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));

    // Client supplies Token A, but requests to subscribe to Alert B ID
    const spoofErr = await new Promise((resolve) => {
      client.emit(
        'subscribe:alert',
        {
          token: alertATrackingToken,
          alert_id: alertBId, // Mismatched!
        },
        (res) => {
          resolve(res);
        }
      );
    });

    assert.equal(spoofErr.status, 'error');
    assert.match(spoofErr.message, /token does not match requested alert/i);
  });

  test('6. Real-time GPS coordinate breadcrumb delivery to authorized subscriber', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));

    await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });

    // Set up listener for real-time location update event
    const updatePromise = new Promise((resolve) => {
      client.on('location:update', (data) => {
        resolve(data);
      });
    });

    // Push new location via REST API
    await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.776,
        longitude: -122.418,
        accuracy_meters: 6.2,
        speed_mps: 1.8,
      })
      .expect(200);

    const received = await updatePromise;
    assert.equal(received.alert_id, alertAId);
    assert.equal(received.status, 'active');
    assert.equal(received.latitude, 37.776);
    assert.equal(received.longitude, -122.418);
    assert.equal(received.accuracy_meters, 6.2);
    assert.equal(received.speed_mps, 1.8);
    assert.ok(received.logged_at);

    // Verify sensitive fields are never emitted over WebSocket
    assert.equal(received.user_id, undefined);
    assert.equal(received.tracking_token_hash, undefined);
    assert.equal(received.token, undefined);
    assert.equal(received.password, undefined);
  });

  test('7. Cross-alert room isolation (Recipient A receives only Alert A updates, never Alert B)', async () => {
    const clientA = createClient();
    const clientB = createClient();

    await Promise.all([
      new Promise((resolve) => clientA.on('connect', resolve)),
      new Promise((resolve) => clientB.on('connect', resolve)),
    ]);

    await Promise.all([
      new Promise((resolve) =>
        clientA.emit('subscribe:alert', { token: alertATrackingToken }, resolve)
      ),
      new Promise((resolve) =>
        clientB.emit('subscribe:alert', { token: alertBTrackingToken }, resolve)
      ),
    ]);

    let clientBReceivedAlertA = false;
    clientB.on('location:update', (data) => {
      if (data.alert_id === alertAId) {
        clientBReceivedAlertA = true;
      }
    });

    const clientAReceivedPromise = new Promise((resolve) => {
      clientA.on('location:update', (data) => {
        resolve(data);
      });
    });

    // Push location update to Alert A ONLY
    await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.777,
        longitude: -122.417,
        accuracy_meters: 4.0,
      })
      .expect(200);

    const receivedA = await clientAReceivedPromise;
    assert.equal(receivedA.alert_id, alertAId);

    // Allow time to verify Client B receives NOTHING from Alert A
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(clientBReceivedAlertA, false, 'Client B must never receive Alert A telemetry');
  });

  test('8. No location broadcast before persistence succeeds (Validation failure)', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));
    await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });

    let broadcastReceived = false;
    client.on('location:update', () => {
      broadcastReceived = true;
    });

    // Attempt to push invalid coordinates (out of range latitude 999.0)
    await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 999.0, // Invalid!
        longitude: -122.417,
      })
      .expect(400);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(broadcastReceived, false, 'No event should be broadcast when persistence fails');
  });

  test('9. Missing optional GPS accuracy is handled cleanly in WebSocket emission', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));
    await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });

    const updatePromise = new Promise((resolve) => {
      client.on('location:update', resolve);
    });

    // Push coordinate without accuracy_meters
    await request(app)
      .post(`/api/v1/alerts/${alertAId}/location`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        latitude: 37.778,
        longitude: -122.416,
      })
      .expect(200);

    const received = await updatePromise;
    assert.equal(received.accuracy_meters, null);
    assert.equal(received.latitude, 37.778);
  });

  test('10. Real-time alert resolution notification and subscription policy', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));
    await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });

    const resolvePromise = new Promise((resolve) => {
      client.on('alert:resolved', (data) => {
        resolve(data);
      });
    });

    // Mark Alert A as resolved via REST
    await request(app)
      .post(`/api/v1/alerts/${alertAId}/resolve`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ reason: 'Reached safety' })
      .expect(200);

    const resolvedData = await resolvePromise;
    assert.equal(resolvedData.alert_id, alertAId);
    assert.equal(resolvedData.status, 'resolved');
    assert.ok(resolvedData.resolved_at);

    // Subscribing to an alert resolved within 24h still succeeds
    const newClient = createClient();
    await new Promise((resolve) => newClient.on('connect', resolve));
    const subRes = await new Promise((resolve) => {
      newClient.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });
    assert.equal(subRes.status, 'ok');
    assert.equal(subRes.alert_status, 'resolved');

    // Subscribing to an alert resolved >24h ago is rejected as expired
    await query(
      `UPDATE alerts SET resolved_at = NOW() - INTERVAL '25 hours' WHERE id = $1;`,
      [alertAId]
    );

    const expiredClient = createClient();
    await new Promise((resolve) => expiredClient.on('connect', resolve));
    const expiredRes = await new Promise((resolve) => {
      expiredClient.emit('subscribe:alert', { token: alertATrackingToken }, resolve);
    });
    assert.equal(expiredRes.status, 'error');
    assert.match(expiredRes.message, /not found or link has expired/i);
  });

  test('11. Client disconnection and reconnection behavior', async () => {
    const client = createClient();
    await new Promise((resolve) => client.on('connect', resolve));

    // Subscribe to Alert B
    await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertBTrackingToken }, resolve);
    });

    // Disconnect client
    client.disconnect();
    assert.equal(client.connected, false);

    // Reconnect client
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));
    assert.equal(client.connected, true);

    // Re-subscribe to Alert B
    const reSubRes = await new Promise((resolve) => {
      client.emit('subscribe:alert', { token: alertBTrackingToken }, resolve);
    });
    assert.equal(reSubRes.status, 'ok');

    // Push new coordinate to Alert B and verify reception after reconnect
    const updatePromise = new Promise((resolve) => {
      client.on('location:update', resolve);
    });

    await request(app)
      .post(`/api/v1/alerts/${alertBId}/location`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        latitude: 40.7135,
        longitude: -74.0055,
        accuracy_meters: 4.8,
      })
      .expect(200);

    const received = await updatePromise;
    assert.equal(received.alert_id, alertBId);
    assert.equal(received.latitude, 40.7135);
  });

  test('12. Existing REST endpoints remain fully functional alongside Socket.IO', async () => {
    // Health check
    const healthRes = await request(app).get('/api/v1/health').expect(200);
    assert.equal(healthRes.body.status, 'ok');

    // Active alert query
    const activeRes = await request(app)
      .get('/api/v1/alerts/active')
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(200);
    assert.equal(activeRes.body.status, 'ok');
    assert.equal(activeRes.body.data.alert.id, alertBId);

    // Public tracking REST query
    const trackRes = await request(app)
      .get(`/api/v1/alerts/track/${alertBTrackingToken}`)
      .expect(200);
    assert.equal(trackRes.body.status, 'ok');
    assert.equal(trackRes.body.data.alert.id, alertBId);
  });
});
