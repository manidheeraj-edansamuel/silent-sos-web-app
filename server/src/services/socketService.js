/**
 * ==============================================================================
 * Silent SOS - Socket.IO Real-Time Gateway Service
 * Description: Manages WebSocket connections for real-time location streaming.
 * Authenticates recipient subscriptions using cryptographic tracking tokens,
 * maintains isolated rooms per emergency alert, and emits minimal telemetry payloads.
 * ==============================================================================
 */

import { Server } from 'socket.io';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { isOriginAllowed } from '../config/origins.js';

// High-entropy tracking token validation regex (16-128 base64url characters)
const TRACKING_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

let ioInstance = null;

/**
 * Validates and authenticates a tracking token against PostgreSQL.
 * Reuses the established SHA-256 token lookup to prevent weak parallel auth.
 * @param {string} token - Raw tracking token provided by recipient client
 * @returns {Promise<{ valid: boolean, alert?: object, error?: string }>}
 */
export async function verifyTrackingToken(token) {
  if (!token || typeof token !== 'string' || !TRACKING_TOKEN_REGEX.test(token)) {
    return { valid: false, error: 'Validation error: Invalid tracking token format.' };
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const result = await query(
    `SELECT a.id, a.status, a.triggered_at, a.resolved_at, a.updated_at
     FROM alerts a
     WHERE a.tracking_token_hash = $1;`,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    return { valid: false, error: 'Emergency tracking session not found or link has expired.' };
  }

  const alert = result.rows[0];

  // Enforce 24-hour safety window for resolved/false_alarm alerts
  if (alert.status === 'resolved' || alert.status === 'false_alarm') {
    const windowHours = parseFloat(process.env.TRACKING_RESOLVED_WINDOW_HOURS || '24');
    const resolvedTimestamp = new Date(alert.resolved_at || alert.updated_at).getTime();
    if (Date.now() - resolvedTimestamp > windowHours * 60 * 60 * 1000) {
      return { valid: false, error: 'Emergency tracking session not found or link has expired.' };
    }
  }

  return { valid: true, alert };
}

/**
 * Initializes Socket.IO on the provided HTTP server instance
 * @param {import('http').Server} httpServer
 * @returns {Server}
 */
export function initSocketServer(httpServer) {
  if (ioInstance) {
    return ioInstance;
  }

  // Allow the configured origins plus the deployment's own public URL so that
  // a same-origin production deployment (client served by this Express server)
  // can complete the WebSocket handshake, which always sends an Origin header.
  ioInstance = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Optional connection-level handshake authentication middleware
  ioInstance.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
      try {
        const authRes = await verifyTrackingToken(token);
        if (!authRes.valid) {
          return next(new Error(`Authentication failed: ${authRes.error}`));
        }
        socket.verifiedAlertId = authRes.alert.id;
        socket.verifiedAlertStatus = authRes.alert.status;
      } catch (err) {
        return next(new Error('Internal database error during handshake authentication.'));
      }
    }
    next();
  });

  ioInstance.on('connection', (socket) => {
    // If authenticated via handshake, automatically join the verified alert room
    if (socket.verifiedAlertId) {
      const roomName = `alert:${socket.verifiedAlertId}`;
      socket.join(roomName);
      socket.emit('subscription:confirmed', {
        status: 'ok',
        alert_id: socket.verifiedAlertId,
        alert_status: socket.verifiedAlertStatus,
      });
    }

    /**
     * Subscribe to emergency alert updates via event message
     * Requires valid tracking token; rejects mismatched or unverified alert IDs.
     */
    socket.on('subscribe:alert', async (payload, callback) => {
      try {
        const { token, alert_id: requestedAlertId } = payload || {};
        const authRes = await verifyTrackingToken(token);

        if (!authRes.valid) {
          const errPayload = { status: 'error', message: authRes.error };
          socket.emit('subscription:error', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        const alert = authRes.alert;

        // Never trust client-supplied alert ID alone:
        // If client supplied an alert_id and it does not match the token's alert, reject
        if (requestedAlertId && requestedAlertId !== alert.id) {
          const errPayload = {
            status: 'error',
            message: 'Unauthorized room subscription: token does not match requested alert.',
          };
          socket.emit('subscription:error', errPayload);
          if (typeof callback === 'function') callback(errPayload);
          return;
        }

        const roomName = `alert:${alert.id}`;
        socket.join(roomName);
        socket.verifiedAlertId = alert.id;

        const successPayload = {
          status: 'ok',
          message: 'Successfully subscribed to real-time emergency alert stream.',
          alert_id: alert.id,
          alert_status: alert.status,
        };

        socket.emit('subscription:confirmed', successPayload);
        if (typeof callback === 'function') callback(successPayload);
      } catch (err) {
        const errPayload = {
          status: 'error',
          message: 'Internal server error processing room subscription.',
        };
        socket.emit('subscription:error', errPayload);
        if (typeof callback === 'function') callback(errPayload);
      }
    });

    /**
     * Unsubscribe from an alert room
     */
    socket.on('unsubscribe:alert', (payload, callback) => {
      const { alert_id } = payload || {};
      if (alert_id) {
        socket.leave(`alert:${alert_id}`);
      }
      const successPayload = { status: 'ok', message: 'Unsubscribed from alert stream.' };
      if (typeof callback === 'function') callback(successPayload);
    });

    socket.on('disconnect', (reason) => {
      if (process.env.NODE_ENV === 'development' && process.env.DEBUG_SOCKET === 'true') {
        console.log(`[Socket.IO] Client disconnected (${socket.id}): ${reason}`);
      }
    });
  });

  return ioInstance;
}

/**
 * Returns active Socket.IO server instance
 * @returns {Server|null}
 */
export function getIO() {
  return ioInstance;
}

/**
 * Broadcasts location update to the isolated room for the specific alert.
 * Emits ONLY the minimum required data; never emits user IDs, hashes, or credentials.
 * @param {string} alertId - Target alert UUID
 * @param {object} locationData - Persisted location coordinates and metadata
 */
export function emitLocationUpdate(alertId, locationData) {
  if (!ioInstance) return;

  const payload = {
    alert_id: alertId,
    status: locationData.status || 'active',
    latitude: parseFloat(locationData.latitude),
    longitude: parseFloat(locationData.longitude),
    accuracy_meters:
      locationData.accuracy_meters !== undefined && locationData.accuracy_meters !== null
        ? parseFloat(locationData.accuracy_meters)
        : null,
    altitude_meters:
      locationData.altitude_meters !== undefined && locationData.altitude_meters !== null
        ? parseFloat(locationData.altitude_meters)
        : null,
    heading_degrees:
      locationData.heading_degrees !== undefined && locationData.heading_degrees !== null
        ? parseFloat(locationData.heading_degrees)
        : null,
    speed_mps:
      locationData.speed_mps !== undefined && locationData.speed_mps !== null
        ? parseFloat(locationData.speed_mps)
        : null,
    logged_at: locationData.logged_at || new Date().toISOString(),
  };

  // Strictly broadcast to the specific alert room
  ioInstance.to(`alert:${alertId}`).emit('location:update', payload);
}

/**
 * Broadcasts status updates (e.g. alert resolved) to the isolated alert room.
 * @param {string} alertId - Target alert UUID
 * @param {object} statusData - Status transition metadata
 */
export function emitStatusUpdate(alertId, statusData) {
  if (!ioInstance) return;

  const payload = {
    alert_id: alertId,
    status: statusData.status,
    resolved_at: statusData.resolved_at || null,
  };

  ioInstance.to(`alert:${alertId}`).emit('status:update', payload);

  if (statusData.status === 'resolved') {
    ioInstance.to(`alert:${alertId}`).emit('alert:resolved', payload);
  }
}

/**
 * Gracefully shuts down the Socket.IO server
 */
export async function closeSocketServer() {
  if (ioInstance) {
    const io = ioInstance;
    ioInstance = null;
    await new Promise((resolve) => io.close(resolve));
  }
}

export default {
  initSocketServer,
  getIO,
  verifyTrackingToken,
  emitLocationUpdate,
  emitStatusUpdate,
  closeSocketServer,
};
