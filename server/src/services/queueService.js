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

export const ALERT_DISPATCH_QUEUE = 'alert.dispatch';

const RETRY_OPTIONS = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 300,
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
 * Processes a batch of alert dispatch jobs.
 * Records a delivery attempt audit event and notifies any connected recipients.
 * Throwing requeues the batch with backoff (pg-boss retry policy).
 */
async function processDispatchJobs(jobs) {
  for (const job of jobs) {
    const alertId = job.data?.alertId;
    if (!alertId) {
      console.warn(`[Queue] Skipping malformed dispatch job ${job.id}`);
      continue;
    }

    const result = await query(
      `SELECT id, status, triggered_at FROM alerts WHERE id = $1;`,
      [alertId]
    );

    if (result.rowCount === 0) {
      console.warn(`[Queue] Alert ${alertId} no longer exists; skipping dispatch job ${job.id}`);
      continue;
    }

    const alert = result.rows[0];
    const io = getIO();
    if (io) {
      io.to(`alert:${alertId}`).emit('notification:dispatched', {
        alert_id: alertId,
        status: alert.status,
        triggered_at: alert.triggered_at,
        dispatched_at: new Date().toISOString(),
      });
    }

    await query(
      `INSERT INTO alert_events (alert_id, event_type, event_data, created_at)
       VALUES ($1, 'notification_dispatched', $2, NOW());`,
      [
        alertId,
        JSON.stringify({
          channel: 'realtime',
          attempt: job.retryCount + 1,
          job_id: job.id,
        }),
      ]
    );
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
 * @param {string} alertId - UUID of the triggered alert
 * @returns {Promise<string|null>} pg-boss job id, or null when not enqueued
 */
export async function enqueueAlertDispatch(alertId) {
  if (!bossInstance) {
    console.warn('[Queue] Dispatch enqueue skipped: queue service not initialized.');
    return null;
  }

  return bossInstance.send(
    ALERT_DISPATCH_QUEUE,
    { alertId, enqueuedAt: new Date().toISOString() },
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
