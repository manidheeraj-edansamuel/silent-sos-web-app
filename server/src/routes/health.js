import { Router } from 'express';
import { checkDbHealth } from '../config/database.js';

const router = Router();

/**
 * GET /api/v1/health
 * Public health check and diagnostic endpoint
 * Inspects both API service health and PostgreSQL database connectivity.
 */
router.get('/', async (req, res) => {
  const dbHealth = await checkDbHealth();
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
    },
  };

  // Include latency metadata if healthy, or error details if in non-production
  if (isHealthy && dbHealth.latencyMs !== undefined) {
    payload.databaseLatencyMs = dbHealth.latencyMs;
  } else if (!isHealthy && process.env.NODE_ENV !== 'production' && dbHealth.error) {
    payload.databaseError = dbHealth.error;
  }

  const statusCode = isHealthy ? 200 : 503;
  return res.status(statusCode).json(payload);
});

export default router;
