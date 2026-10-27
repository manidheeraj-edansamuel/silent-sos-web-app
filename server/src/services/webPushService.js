/**
 * ==============================================================================
 * Silent SOS - Web Push Notification Service
 * Description: Alert-scoped browser push notifications for recipients viewing
 * the tracking portal. Subscriptions are created with the tracking token and can
 * receive throttled live-location updates and a final resolution notification.
 *
 * Security notes:
 * - Raw tracking tokens are stored AES-256-GCM encrypted with the subscription
 *   so click-through links work without plaintext tokens at rest.
 * - Push endpoints and keys are never logged; only subscription ids appear.
 * - Stale subscriptions (404/410/403) are deleted automatically.
 * ==============================================================================
 */

import crypto from 'crypto';
import webpush from 'web-push';
import { query } from '../config/database.js';
import { buildTrackingUrl } from './emailService.js';

const DEFAULT_LOCATION_INTERVAL_SECONDS = 120;

let vapidState = null;

function initWebPush() {
  if (vapidState) return vapidState;

  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) {
    if (process.env.NODE_ENV === 'production') {
      vapidState = { enabled: false, ephemeral: false, publicKey: null };
      console.warn('[WebPush] VAPID keys are not configured; web push is disabled.');
      return vapidState;
    }

    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    vapidState = { enabled: true, ephemeral: true, publicKey };
    console.warn(
      '[WebPush] VAPID keys missing; generated ephemeral development keys. ' +
        'Recipients must resubscribe after a server restart.'
    );
  } else {
    vapidState = { enabled: true, ephemeral: false, publicKey };
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:no-reply@silent-sos.local',
    publicKey,
    privateKey
  );

  return vapidState;
}

/**
 * Public, non-secret push configuration for the recipient portal.
 * @returns {{ enabled: boolean, public_key: string|null, vapid_configured: boolean }}
 */
export function getPushConfig() {
  const state = initWebPush();
  return {
    enabled: state.enabled,
    public_key: state.publicKey,
    vapid_configured: state.enabled && !state.ephemeral,
  };
}

function getEncryptionKey() {
  const secret =
    process.env.PUSH_TOKEN_SECRET || process.env.JWT_SECRET || 'silent-sos-dev-push-token';
  return crypto.createHash('sha256').update(`push-token:${secret}`).digest();
}

/**
 * Encrypts a raw tracking token for storage alongside a push subscription.
 * Format: base64url(iv).base64url(authTag).base64url(ciphertext)
 */
export function encryptTrackingToken(trackingToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(trackingToken, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptTrackingToken(encrypted) {
  const [iv, tag, ciphertext] = String(encrypted).split('.');
  if (!iv || !tag || !ciphertext) {
    throw new Error('Malformed encrypted tracking token');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function defaultSendNotification(subscription, payload, options) {
  return webpush.sendNotification(subscription, payload, options);
}

/**
 * Delivers a payload to the supplied subscription rows.
 * Transport failures never throw: stale endpoints are removed, other failures
 * are counted so a caller can report delivery health.
 *
 * @param {Array<{id: string, endpoint: string, p256dh: string, auth: string, expiration_time: number|string|null}>} subscriptions
 * @param {object} payload
 * @param {Function} [sendNotification] - Injectable transport (tests)
 * @returns {Promise<{attempted: number, sent: number, failed: number, removed: number}>}
 */
export async function deliverPushToSubscriptions(
  subscriptions,
  payload,
  sendNotification = defaultSendNotification
) {
  const summary = { attempted: subscriptions.length, sent: 0, failed: 0, removed: 0 };
  const body = JSON.stringify(payload);

  for (const subscription of subscriptions) {
    try {
      await sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          expirationTime: subscription.expiration_time
            ? Number(subscription.expiration_time)
            : null,
        },
        body,
        { TTL: 300, urgency: 'high' }
      );

      summary.sent += 1;
      await query(
        `UPDATE push_subscriptions SET last_notified_at = NOW(), updated_at = NOW() WHERE id = $1;`,
        [subscription.id]
      );
    } catch (err) {
      const statusCode = err?.statusCode;
      if (statusCode === 404 || statusCode === 410 || statusCode === 403) {
        summary.removed += 1;
        try {
          await query(`DELETE FROM push_subscriptions WHERE id = $1;`, [subscription.id]);
        } catch (dbErr) {
          console.error(`[WebPush] Failed to remove stale subscription ${subscription.id}:`, dbErr.message);
        }
      } else {
        summary.failed += 1;
        // Subscription endpoints are capability URLs and must not be logged.
        console.error(
          `[WebPush] Delivery failed for subscription ${subscription.id}:`,
          err?.message || 'unknown error'
        );
      }
    }
  }

  return summary;
}

async function loadAlertWithVictim(alertId) {
  const result = await query(
    `SELECT a.id, a.status, a.triggered_at, a.resolved_at, u.full_name AS victim_name
     FROM alerts a
     JOIN users u ON a.user_id = u.id
     WHERE a.id = $1;`,
    [alertId]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/**
 * Sends a throttled live-location notification to subscriptions that have not
 * been notified within PUSH_LOCATION_INTERVAL_SECONDS.
 */
export async function notifyLocationUpdate(alertId, location, { sendFn, intervalSeconds } = {}) {
  const state = initWebPush();
  if (!state.enabled) {
    return { enabled: false, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'disabled' };
  }

  const alert = await loadAlertWithVictim(alertId);
  if (!alert || alert.status !== 'active') {
    return { enabled: true, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'alert_not_active' };
  }

  const interval =
    intervalSeconds || parseInt(process.env.PUSH_LOCATION_INTERVAL_SECONDS, 10) ||
    DEFAULT_LOCATION_INTERVAL_SECONDS;

  const subscriptions = await query(
    `SELECT id, endpoint, p256dh, auth, expiration_time, tracking_token_encrypted
     FROM push_subscriptions
     WHERE alert_id = $1
       AND (last_notified_at IS NULL OR last_notified_at < NOW() - ($2 * INTERVAL '1 second'))
     ORDER BY created_at ASC;`,
    [alertId, interval]
  );

  if (subscriptions.rowCount === 0) {
    return { enabled: true, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'throttled' };
  }

  let trackingUrl;
  try {
    trackingUrl = buildTrackingUrl(
      decryptTrackingToken(subscriptions.rows[0].tracking_token_encrypted)
    );
  } catch (err) {
    console.error('[WebPush] Unable to decrypt tracking token for location push:', err.message);
    return { enabled: true, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'decrypt_failed' };
  }

  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracy = Number(location?.accuracy_meters);
  const coords =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}${
          Number.isFinite(accuracy) && accuracy > 0 ? ` (±${Math.round(accuracy)} m)` : ''
        }`
      : 'a new coordinate';

  const payload = {
    event: 'location_update',
    title: `Live location update — ${alert.victim_name}`,
    body: `Latest GPS fix: ${coords}. Open the emergency map for live tracking.`,
    url: trackingUrl,
    tag: `sos-${alertId}-location`,
  };

  return { enabled: true, ...(await deliverPushToSubscriptions(subscriptions.rows, payload, sendFn)) };
}

/**
 * Sends a final notification when an alert is resolved, then removes all
 * subscriptions (and their encrypted tokens) for that alert.
 */
export async function notifyAlertResolved(alertId, { sendFn } = {}) {
  const state = initWebPush();
  if (!state.enabled) {
    return { enabled: false, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'disabled' };
  }

  const alert = await loadAlertWithVictim(alertId);
  if (!alert) {
    return { enabled: true, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'alert_not_found' };
  }

  const subscriptions = await query(
    `SELECT id, endpoint, p256dh, auth, expiration_time, tracking_token_encrypted
     FROM push_subscriptions
     WHERE alert_id = $1
     ORDER BY created_at ASC;`,
    [alertId]
  );

  if (subscriptions.rowCount === 0) {
    return { enabled: true, attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'no_subscriptions' };
  }

  let trackingUrl = null;
  try {
    trackingUrl = buildTrackingUrl(
      decryptTrackingToken(subscriptions.rows[0].tracking_token_encrypted)
    );
  } catch (err) {
    console.error('[WebPush] Unable to decrypt tracking token for resolution push:', err.message);
  }

  const payload = {
    event: 'resolved',
    title: 'Emergency alert resolved',
    body: `${alert.victim_name} marked the SOS emergency alert as resolved.`,
    url: trackingUrl || '/',
    tag: `sos-${alertId}-resolved`,
  };

  const summary = await deliverPushToSubscriptions(subscriptions.rows, payload, sendFn);

  // The alert is closed; drop subscriptions and their encrypted tokens.
  await query(`DELETE FROM push_subscriptions WHERE alert_id = $1;`, [alertId]);

  await query(
    `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
     VALUES ($1, 'push_dispatched', $2, NOW());`,
    [alertId, JSON.stringify({ event: 'resolved', ...summary })]
  );

  return { enabled: true, ...summary };
}

export default {
  getPushConfig,
  encryptTrackingToken,
  deliverPushToSubscriptions,
  notifyLocationUpdate,
  notifyAlertResolved,
};
