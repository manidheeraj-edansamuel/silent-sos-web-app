/**
 * ==============================================================================
 * Silent SOS - Alert Routes (`/api/v1/alerts`)
 * Description: Protected emergency SOS endpoints for triggering alerts, updating
 * location breadcrumbs (PostGIS), and resolving alerts with tenant isolation.
 * ==============================================================================
 */

import { Router } from 'express';
import crypto from 'crypto';
import { getClient, query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { trackingRateLimiter } from '../middleware/rateLimiter.js';
import { emitLocationUpdate, emitStatusUpdate } from '../services/socketService.js';
import { enqueueAlertDispatch } from '../services/queueService.js';

const router = Router();

// UUID format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Tracking token validation regex (high-entropy base64url string, 16-128 chars)
const TRACKING_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * GET /api/v1/alerts/track/:token
 * Public recipient emergency tracking endpoint.
 *
 * Security & Privacy:
 * - Public endpoint accessed by trusted emergency recipients via unguessable tracking links.
 * - Raw token is validated, then hashed with SHA-256 before looking up the record in PostgreSQL.
 * - Raw tokens or token hashes are NEVER stored, logged, or returned in responses.
 * - Sensitive user data (user_id, email, phone_number, password_hash) is strictly excluded.
 * - Only permitted victim display name (users.full_name) and public alert state are exposed.
 * - Returns historical GPS breadcrumb coordinates in ascending chronological order (logged_at ASC).
 * - Expiration policy: Active alerts are fully trackable; resolved/false_alarm alerts remain accessible
 *   for a configurable safety window (default 24h) so responders can confirm safe arrival,
 *   after which the link safely expires with 404 Not Found.
 */
router.get('/track/:token', trackingRateLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;

    // 1. Defensively validate token format and length
    if (!token || typeof token !== 'string' || !TRACKING_TOKEN_REGEX.test(token)) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Invalid tracking token format.',
      });
    }

    // 2. Compute SHA-256 hash of the supplied raw token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 3. Look up alert and permitted victim display name via parameterized query on indexed tracking_token_hash
    const alertResult = await query(
      `SELECT
         a.id,
         a.status,
         a.triggered_at,
         a.acknowledged_at,
         a.resolved_at,
         a.created_at,
         a.updated_at,
         u.full_name AS victim_name
       FROM alerts a
       JOIN users u ON a.user_id = u.id
       WHERE a.tracking_token_hash = $1;`,
      [tokenHash]
    );

    if (alertResult.rowCount === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Emergency tracking session not found or link has expired.',
      });
    }

    const alertRow = alertResult.rows[0];

    // 4. Enforce expiration policy for resolved alerts (default 24-hour safety window)
    if (alertRow.status === 'resolved' || alertRow.status === 'false_alarm') {
      const windowHours = parseFloat(process.env.TRACKING_RESOLVED_WINDOW_HOURS || '24');
      const resolvedTimestamp = new Date(alertRow.resolved_at || alertRow.updated_at).getTime();
      const now = Date.now();
      if (now - resolvedTimestamp > windowHours * 60 * 60 * 1000) {
        return res.status(404).json({
          status: 'error',
          message: 'Emergency tracking session not found or link has expired.',
        });
      }
    }

    // 5. Query historical GPS coordinate breadcrumbs in chronological order
    const locationResult = await query(
      `SELECT
         id,
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude,
         accuracy_meters,
         altitude_meters,
         heading_degrees,
         speed_mps,
         logged_at
       FROM alert_locations
       WHERE alert_id = $1
       ORDER BY logged_at ASC;`,
      [alertRow.id]
    );

    // 6. Format location list safely
    const locations = locationResult.rows.map((row) => ({
      id: row.id,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      accuracy_meters:
        row.accuracy_meters !== null && row.accuracy_meters !== undefined
          ? parseFloat(row.accuracy_meters)
          : null,
      altitude_meters:
        row.altitude_meters !== null && row.altitude_meters !== undefined
          ? parseFloat(row.altitude_meters)
          : null,
      heading_degrees:
        row.heading_degrees !== null && row.heading_degrees !== undefined
          ? parseFloat(row.heading_degrees)
          : null,
      speed_mps:
        row.speed_mps !== null && row.speed_mps !== undefined
          ? parseFloat(row.speed_mps)
          : null,
      logged_at: row.logged_at,
    }));

    const currentLocation = locations.length > 0 ? locations[locations.length - 1] : null;

    // 7. Return privacy-hardened public tracking payload
    return res.status(200).json({
      status: 'ok',
      data: {
        alert: {
          id: alertRow.id,
          status: alertRow.status,
          victim_name: alertRow.victim_name,
          triggered_at: alertRow.triggered_at,
          acknowledged_at: alertRow.acknowledged_at,
          resolved_at: alertRow.resolved_at,
          current_location: currentLocation,
          locations: locations,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// All subsequent alert endpoints strictly require authentication
router.use(authenticateToken);

/**
 * Validates coordinate inputs defensively
 */
function validateCoordinates(latitude, longitude, accuracy_meters, heading_degrees, speed_mps) {
  const errors = [];

  if (latitude === undefined || latitude === null || typeof latitude !== 'number' || isNaN(latitude)) {
    errors.push('latitude is required and must be a valid number.');
  } else if (latitude < -90 || latitude > 90) {
    errors.push('latitude must be between -90 and 90 degrees.');
  }

  if (longitude === undefined || longitude === null || typeof longitude !== 'number' || isNaN(longitude)) {
    errors.push('longitude is required and must be a valid number.');
  } else if (longitude < -180 || longitude > 180) {
    errors.push('longitude must be between -180 and 180 degrees.');
  }

  if (accuracy_meters !== undefined && accuracy_meters !== null) {
    if (typeof accuracy_meters !== 'number' || isNaN(accuracy_meters) || accuracy_meters < 0) {
      errors.push('accuracy_meters must be a non-negative number.');
    }
  }

  if (heading_degrees !== undefined && heading_degrees !== null) {
    if (typeof heading_degrees !== 'number' || isNaN(heading_degrees) || heading_degrees < 0 || heading_degrees > 360) {
      errors.push('heading_degrees must be between 0 and 360 degrees.');
    }
  }

  if (speed_mps !== undefined && speed_mps !== null) {
    if (typeof speed_mps !== 'number' || isNaN(speed_mps) || speed_mps < 0) {
      errors.push('speed_mps must be a non-negative number.');
    }
  }

  return errors;
}

/**
 * GET /api/v1/alerts/active
 * Retrieve currently active SOS alert for the authenticated user (if any)
 */
router.get('/active', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT a.id, a.user_id, a.status, a.triggered_at, a.created_at, a.updated_at,
              l.id AS location_id,
              ST_Y(l.location::geometry) AS latitude,
              ST_X(l.location::geometry) AS longitude,
              l.accuracy_meters,
              l.altitude_meters,
              l.heading_degrees,
              l.speed_mps,
              l.logged_at AS location_logged_at
       FROM alerts a
       LEFT JOIN LATERAL (
         SELECT id, location, accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at
         FROM alert_locations
         WHERE alert_id = a.id
         ORDER BY logged_at DESC
         LIMIT 1
       ) l ON true
       WHERE a.user_id = $1 AND a.status = 'active'
       ORDER BY a.triggered_at DESC
       LIMIT 1;`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(200).json({
        status: 'ok',
        data: {
          alert: null,
        },
      });
    }

    const row = result.rows[0];
    const alertData = {
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      triggered_at: row.triggered_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      location: row.location_id
        ? {
            id: row.location_id,
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            accuracy_meters: row.accuracy_meters ? parseFloat(row.accuracy_meters) : null,
            altitude_meters: row.altitude_meters ? parseFloat(row.altitude_meters) : null,
            heading_degrees: row.heading_degrees ? parseFloat(row.heading_degrees) : null,
            speed_mps: row.speed_mps ? parseFloat(row.speed_mps) : null,
            logged_at: row.location_logged_at,
          }
        : null,
    };

    return res.status(200).json({
      status: 'ok',
      data: {
        alert: alertData,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/alerts/trigger
 * Silently trigger an emergency SOS alert.
 * Transactional: creates alert record, stores initial coordinates if available, and logs audit event.
 */
router.post('/trigger', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const { trigger_source, location, location_error } = req.body || {};

    // 1. Generate high-entropy tracking token (192 bits of entropy)
    const rawTrackingToken = crypto.randomBytes(24).toString('base64url');
    const trackingTokenHash = crypto.createHash('sha256').update(rawTrackingToken).digest('hex');

    await client.query('BEGIN');

    // 2. Insert alert into alerts table
    const alertRes = await client.query(
      `INSERT INTO alerts (user_id, status, tracking_token_hash, triggered_at, created_at, updated_at)
       VALUES ($1, 'active', $2, NOW(), NOW(), NOW())
       RETURNING id, user_id, status, triggered_at, created_at, updated_at;`,
      [userId, trackingTokenHash]
    );

    const alert = alertRes.rows[0];
    let initialLocation = null;
    let hasLocation = false;

    // 3. Process initial location if provided
    if (location && typeof location === 'object') {
      const {
        latitude,
        longitude,
        accuracy_meters,
        altitude_meters,
        heading_degrees,
        speed_mps,
      } = location;

      const coordErrors = validateCoordinates(
        latitude,
        longitude,
        accuracy_meters,
        heading_degrees,
        speed_mps
      );

      if (coordErrors.length === 0) {
        const locRes = await client.query(
          `INSERT INTO alert_locations (
             alert_id, location, accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at
           )
           VALUES (
             $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7, NOW()
           )
           RETURNING id, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                     accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at;`,
          [
            alert.id,
            longitude,
            latitude,
            accuracy_meters !== undefined ? accuracy_meters : null,
            altitude_meters !== undefined ? altitude_meters : null,
            heading_degrees !== undefined ? heading_degrees : null,
            speed_mps !== undefined ? speed_mps : null,
          ]
        );

        const locRow = locRes.rows[0];
        initialLocation = {
          id: locRow.id,
          latitude: parseFloat(locRow.latitude),
          longitude: parseFloat(locRow.longitude),
          accuracy_meters: locRow.accuracy_meters ? parseFloat(locRow.accuracy_meters) : null,
          altitude_meters: locRow.altitude_meters ? parseFloat(locRow.altitude_meters) : null,
          heading_degrees: locRow.heading_degrees ? parseFloat(locRow.heading_degrees) : null,
          speed_mps: locRow.speed_mps ? parseFloat(locRow.speed_mps) : null,
          logged_at: locRow.logged_at,
        };
        hasLocation = true;
      }
    }

    // 4. Record audit event (CRITICAL: Never put rawTrackingToken in event_data!)
    const auditEventData = {
      trigger_source: trigger_source || 'manual_ui',
      has_location: hasLocation,
      ...(hasLocation && initialLocation && {
        accuracy_meters: initialLocation.accuracy_meters,
      }),
      ...(!hasLocation && {
        location_status: 'unavailable',
        reason: location_error || 'location_not_provided',
      }),
    };

    await client.query(
      `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
       VALUES ($1, 'triggered', $2, NOW());`,
      [alert.id, JSON.stringify(auditEventData)]
    );

    await client.query('COMMIT');

    // 5. Enqueue asynchronous notification dispatch AFTER commit so a job can
    // never reference an uncommitted alert. Queue failures must not fail the
    // trigger itself — the alert is already durably persisted.
    try {
      await enqueueAlertDispatch(alert.id);
    } catch (queueErr) {
      console.error('[Queue] Failed to enqueue alert dispatch:', queueErr.message);
    }

    // 6. Build safe client response (raw tracking token returned ONLY on initial trigger)
    return res.status(201).json({
      status: 'ok',
      message: 'Emergency SOS alert triggered successfully.',
      data: {
        alert: {
          id: alert.id,
          status: alert.status,
          triggered_at: alert.triggered_at,
          tracking_token: rawTrackingToken,
          location: initialLocation,
        },
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/alerts/:id/location
 * Push updated location coordinate breadcrumbs for an active emergency alert.
 */
router.post('/:id/location', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const alertId = req.params.id;

    if (!UUID_REGEX.test(alertId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Invalid alert ID format. Expected UUID.',
      });
    }

    const {
      latitude,
      longitude,
      accuracy_meters,
      altitude_meters,
      heading_degrees,
      speed_mps,
    } = req.body || {};

    const validationErrors = validateCoordinates(
      latitude,
      longitude,
      accuracy_meters,
      heading_degrees,
      speed_mps
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    await client.query('BEGIN');

    // Verify alert exists, belongs to user, and is currently active
    const alertRes = await client.query(
      'SELECT id, user_id, status FROM alerts WHERE id = $1 AND user_id = $2;',
      [alertId, userId]
    );

    if (alertRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        message: 'Emergency alert not found.',
      });
    }

    const alert = alertRes.rows[0];

    if (alert.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        status: 'error',
        message: `Cannot push location updates to an alert with status '${alert.status}'.`,
      });
    }

    // Insert new coordinate breadcrumb into PostGIS alert_locations
    const locRes = await client.query(
      `INSERT INTO alert_locations (
         alert_id, location, accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at
       )
       VALUES (
         $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7, NOW()
       )
       RETURNING id, alert_id, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                 accuracy_meters, altitude_meters, heading_degrees, speed_mps, logged_at;`,
      [
        alertId,
        longitude,
        latitude,
        accuracy_meters !== undefined ? accuracy_meters : null,
        altitude_meters !== undefined ? altitude_meters : null,
        heading_degrees !== undefined ? heading_degrees : null,
        speed_mps !== undefined ? speed_mps : null,
      ]
    );

    const locRow = locRes.rows[0];

    // Record audit event
    const eventData = {
      accuracy_meters: locRow.accuracy_meters ? parseFloat(locRow.accuracy_meters) : null,
      speed_mps: locRow.speed_mps ? parseFloat(locRow.speed_mps) : null,
    };

    await client.query(
      `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
       VALUES ($1, 'location_updated', $2, NOW());`,
      [alertId, JSON.stringify(eventData)]
    );

    // Update alert's updated_at timestamp
    await client.query('UPDATE alerts SET updated_at = NOW() WHERE id = $1;', [alertId]);

    await client.query('COMMIT');

    const locationData = {
      id: locRow.id,
      alert_id: locRow.alert_id,
      latitude: parseFloat(locRow.latitude),
      longitude: parseFloat(locRow.longitude),
      accuracy_meters: locRow.accuracy_meters ? parseFloat(locRow.accuracy_meters) : null,
      altitude_meters: locRow.altitude_meters ? parseFloat(locRow.altitude_meters) : null,
      heading_degrees: locRow.heading_degrees ? parseFloat(locRow.heading_degrees) : null,
      speed_mps: locRow.speed_mps ? parseFloat(locRow.speed_mps) : null,
      logged_at: locRow.logged_at,
    };

    // Emit real-time location telemetry to verified recipient room AFTER commit succeeds
    emitLocationUpdate(alertId, {
      status: alert.status,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      accuracy_meters: locationData.accuracy_meters,
      altitude_meters: locationData.altitude_meters,
      heading_degrees: locationData.heading_degrees,
      speed_mps: locationData.speed_mps,
      logged_at: locationData.logged_at,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Location breadcrumb recorded successfully.',
      data: {
        location: locationData,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/alerts/:id/resolve
 * Mark an active emergency alert as resolved with audit event logging.
 */
router.post('/:id/resolve', async (req, res, next) => {
  const client = await getClient();
  try {
    const userId = req.user.id;
    const alertId = req.params.id;
    const { reason } = req.body || {};

    if (!UUID_REGEX.test(alertId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Invalid alert ID format. Expected UUID.',
      });
    }

    await client.query('BEGIN');

    // Verify ownership and check current status
    const alertRes = await client.query(
      'SELECT id, user_id, status, triggered_at, acknowledged_at, resolved_at FROM alerts WHERE id = $1 AND user_id = $2;',
      [alertId, userId]
    );

    if (alertRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        message: 'Emergency alert not found.',
      });
    }

    const currentAlert = alertRes.rows[0];

    // Idempotent resolution check
    if (currentAlert.status === 'resolved') {
      await client.query('COMMIT');
      return res.status(200).json({
        status: 'ok',
        message: 'Alert is already resolved.',
        data: {
          alert: currentAlert,
        },
      });
    }

    // Update alert status to resolved
    const updateRes = await client.query(
      `UPDATE alerts
       SET status = 'resolved',
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, status, triggered_at, acknowledged_at, resolved_at, created_at, updated_at;`,
      [alertId, userId]
    );

    const resolvedAlert = updateRes.rows[0];

    // Record audit event
    const auditData = {
      resolved_by: 'user',
      reason: reason ? String(reason).trim() : 'safe_arrival',
    };

    await client.query(
      `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
       VALUES ($1, 'resolved', $2, NOW());`,
      [alertId, JSON.stringify(auditData)]
    );

    await client.query('COMMIT');

    // Emit real-time resolution update to verified recipient room AFTER commit succeeds
    emitStatusUpdate(alertId, {
      status: 'resolved',
      resolved_at: resolvedAlert.resolved_at,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Emergency alert marked as resolved.',
      data: {
        alert: resolvedAlert,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

export default router;
