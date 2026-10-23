/**
 * ==============================================================================
 * Silent SOS - Asynchronous Dispatch Queue Service (pg-boss)
 * Description: Postgres-backed job queue for alert notification dispatch.
 * Jobs survive process restarts, retry with exponential backoff on failure,
 * and are processed asynchronously so slow delivery channels never block an
 * SOS trigger request.
 * ==============================================================================
 */

import { PgBoss } from 'pg-boss';
import { query } from '../config/database.js';
import { getIO } from './socketService.js';
import { getEmailStatus, sendAlertEmail } from './emailService.js';

export const ALERT_DISPATCH_QUEUE = 'alert.dispatch';

const RETRY_OPTIONS = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 300,
  // Dispatch payloads carry the raw tracking token (needed to build recipient
  // links), so jobs are purged quickly in every terminal state to limit token
  // retention. Retries complete well within the one-hour window.
  deleteAfterSeconds: 3600,
  retentionSeconds: 3600,
};

let bossInstance = null;
let startPromise = null;

function buildConnectionOptions() {
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
    database: process.env.DATABASE_NAME || 'silent_sos',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD ?? process.env.PGPASSWORD ?? '',
    max: parseInt(process.env.QUEUE_POOL_MAX, 10) || 5,
  };
}

/**
 * Sends the emergency email to every contact that has an address on file.
 * Partial failures are tolerated (already-delivered recipients are not emailed
 * twice); a retry is only requested when every attempted send failed.
 */
async function dispatchEmails({ alert, trackingToken }) {
  const summary = {
    attempted: false,
    transport: getEmailStatus().transport,
    sent: 0,
    failed: 0,
    skipped: 0,
    recipient_contact_ids: [],
    skip_reasons: [],
  };

  if (alert.status !== 'active') {
    summary.skip_reasons.push('alert_not_active');
    return { summary, shouldRetry: false };
  }

  if (!trackingToken) {
    summary.skip_reasons.push('missing_tracking_token');
    return { summary, shouldRetry: false };
  }

  const contacts = await query(
    `SELECT id, contact_email
     FROM emergency_contacts
     WHERE user_id = $1 AND contact_email IS NOT NULL AND TRIM(contact_email) <> ''
     ORDER BY priority_order ASC, created_at ASC;`,
    [alert.user_id]
  );

  summary.attempted = true;
  if (contacts.rowCount === 0) {
    summary.skip_reasons.push('no_email_contacts');
    return { summary, shouldRetry: false };
  }

  for (const contact of contacts.rows) {
    try {
      const result = await sendAlertEmail({
        to: contact.contact_email.trim(),
        victimName: alert.victim_name,
        triggeredAt: alert.triggered_at,
        trackingToken,
      });

      if (result.status === 'sent') {
        summary.sent += 1;
        summary.recipient_contact_ids.push(contact.id);
      } else {
        summary.skipped += 1;
        if (!summary.skip_reasons.includes(result.reason)) {
          summary.skip_reasons.push(result.reason);
        }
      }
    } catch (err) {
      summary.failed += 1;
      // Log the contact id only — recipient addresses and tokens are private.
      console.error(`[Email] Delivery failed for contact ${contact.id}:`, err.message);
    }
  }

  const shouldRetry = summary.failed > 0 && summary.sent === 0;
  return { summary, shouldRetry };
}

/**
 * Processes a batch of alert dispatch jobs.
 * Records a delivery audit event, notifies connected recipients, and emails
 * emergency contacts. Throwing requeues the job with backoff (pg-boss policy).
 */
async function processDispatchJobs(jobs) {
  for (const job of jobs) {
    const alertId = job.data?.alertId;
    if (!alertId) {
      console.warn(`[Queue] Skipping malformed dispatch job ${job.id}`);
      continue;
    }

    const result = await query(
      `SELECT a.id, a.user_id, a.status, a.triggered_at, u.full_name AS victim_name
       FROM alerts a
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1;`,
      [alertId]
    );

    if (result.rowCount === 0) {
      console.warn(`[Queue] Alert ${alertId} no longer exists; skipping dispatch job ${job.id}`);
      continue;
    }

    const alert = result.rows[0];
    const io = getIO();
    const realtimeEmitted = Boolean(io);
    if (io) {
      io.to(`alert:${alertId}`).emit('notification:dispatched', {
        alert_id: alertId,
        status: alert.status,
        triggered_at: alert.triggered_at,
        dispatched_at: new Date().toISOString(),
      });
    }

    const { summary: emailSummary, shouldRetry } = await dispatchEmails({
      alert,
      trackingToken: job.data?.trackingToken,
    });

    await query(
      `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
       VALUES ($1, 'notification_dispatched', $2, NOW());`,
      [
        alertId,
        JSON.stringify({
          channels: ['realtime', 'email'],
          realtime: { emitted: realtimeEmitted },
          email: emailSummary,
          attempt: job.retryCount + 1,
          job_id: job.id,
        }),
      ]
    );

    if (shouldRetry) {
      throw new Error(
        `Email dispatch failed for all ${emailSummary.failed} recipient(s) of alert ${alertId}`
      );
    }
  }
}

/**
 * Starts the pg-boss instance, creates the dispatch queue, and registers the worker.
 * Idempotent: concurrent or repeated calls share the same startup promise.
 * @returns {Promise<PgBoss>}
 */
export function initQueueService() {
  if (bossInstance) return Promise.resolve(bossInstance);
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const boss = new PgBoss(buildConnectionOptions());
    boss.on('error', (err) => console.error('[Queue] pg-boss error:', err.message));

    await boss.start();
    await boss.createQueue(ALERT_DISPATCH_QUEUE, RETRY_OPTIONS);
    await boss.work(ALERT_DISPATCH_QUEUE, processDispatchJobs);

    bossInstance = boss;
    return boss;
  })();

  // Allow a later call to retry startup after a failed attempt
  startPromise.catch(() => {
    startPromise = null;
  });

  return startPromise;
}

/**
 * Enqueues an alert dispatch job after the alert transaction has committed.
 * No-op (with a warning) when the queue is not running, so core alerting never
 * depends on queue availability.
 *
 * The raw tracking token is required to build recipient tracking links; it only
 * exists at trigger time because the database stores a SHA-256 hash. It travels
 * inside the job payload and is never logged.
 *
 * @param {string} alertId - UUID of the triggered alert
 * @param {string} [trackingToken] - Raw tracking token, used for email links
 * @returns {Promise<string|null>} pg-boss job id, or null when not enqueued
 */
export async function enqueueAlertDispatch(alertId, trackingToken) {
  if (!bossInstance) {
    console.warn('[Queue] Dispatch enqueue skipped: queue service not initialized.');
    return null;
  }

  return bossInstance.send(
    ALERT_DISPATCH_QUEUE,
    { alertId, trackingToken, enqueuedAt: new Date().toISOString() },
    RETRY_OPTIONS
  );
}

/**
 * Reports queue depth for health/diagnostics endpoints. Never throws.
 * @returns {Promise<{ available: boolean, queued?: number, ready?: number, active?: number, failed?: number, error?: string }>}
 */
export async function getQueueStatus() {
  if (!bossInstance) {
    return { available: false };
  }

  try {
    const queue = await bossInstance.getQueue(ALERT_DISPATCH_QUEUE);
    return {
      available: true,
      queued: queue?.queuedCount ?? 0,
      ready: queue?.readyCount ?? 0,
      active: queue?.activeCount ?? 0,
      failed: queue?.failedCount ?? 0,
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Gracefully stops the queue so in-flight jobs can finish.
 */
export async function closeQueueService() {
  if (!bossInstance) return;

  const boss = bossInstance;
  bossInstance = null;
  startPromise = null;
  await boss.stop({ graceful: true, timeout: 10000 });
}

export function isQueueInitialized() {
  return bossInstance !== null;
}

export default {
  ALERT_DISPATCH_QUEUE,
  initQueueService,
  enqueueAlertDispatch,
  getQueueStatus,
  closeQueueService,
  isQueueInitialized,
};
