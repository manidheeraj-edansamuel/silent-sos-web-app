import { Router } from 'express';
import { checkDbHealth } from '../config/database.js';
import { getEmailStatus } from '../services/emailService.js';
import { getSmsStatus } from '../services/smsService.js';
import { getQueueStatus } from '../services/queueService.js';
import { getPushConfig } from '../services/webPushService.js';

const router = Router();

/**
 * GET /api/v1/health
 * Public health check and diagnostic endpoint
 * Inspects API service health, PostgreSQL connectivity, dispatch queue depth,
 * and email transport configuration.
 */
router.get('/', async (req, res) => {
  const dbHealth = await checkDbHealth();
  const queueStatus = await getQueueStatus();
  const emailStatus = getEmailStatus();
  const smsStatus = getSmsStatus();
  const pushStatus = getPushConfig();
  const isHealthy = dbHealth.isHealthy;

  const payload = {
    status: isHealthy ? 'ok' : 'degraded',
    service: 'silent-sos-api',
    version: 'v1',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    services: {
      api: 'ok',
      database: isHealthy ? 'ok' : 'unavailable',
      queue: queueStatus.available ? 'ok' : 'unavailable',
      email: emailStatus.transport === 'none' ? 'unavailable' : 'ok',
      sms: smsStatus.configured ? 'ok' : 'unavailable',
      push: pushStatus.enabled ? 'ok' : 'unavailable',
    },
    email: {
      transport: emailStatus.transport,
      smtp_configured: emailStatus.configured,
    },
    sms: {
      transport: smsStatus.transport,
      twilio_configured: smsStatus.configured,
    },
    push: {
      enabled: pushStatus.enabled,
      vapid_configured: pushStatus.vapid_configured,
    },
  };

  // Include latency metadata if healthy, or error details if in non-production
  if (isHealthy && dbHealth.latencyMs !== undefined) {
    payload.databaseLatencyMs = dbHealth.latencyMs;
  } else if (!isHealthy && process.env.NODE_ENV !== 'production' && dbHealth.error) {
    payload.databaseError = dbHealth.error;
  }

  if (queueStatus.available) {
    payload.queue = {
      queued: queueStatus.queued,
      ready: queueStatus.ready,
      active: queueStatus.active,
      failed: queueStatus.failed,
    };
  }

  const statusCode = isHealthy ? 200 : 503;
  return res.status(statusCode).json(payload);
});

export default router;
