/**
 * Liveness and readiness.
 *
 * /health answers as long as the process is up — that is what a load balancer polls.
 * /ready additionally proves the database is reachable, which is what a deploy should gate
 * on. Conflating the two means a transient DB blip gets your container killed.
 */

import { Router } from 'express';

import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { sendData } from '../utils/httpResponse.js';

const router = Router();

router.get('/health', (_req, res) => {
  sendData(res, {
    status: 'ok',
    environment: env.NODE_ENV,
    aiProvider: env.aiProvider,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get('/ready', async (_req, res) => {
  const startedAt = performance.now();
  await pool.query('SELECT 1');

  sendData(res, {
    status: 'ready',
    database: { reachable: true, latencyMs: Math.round(performance.now() - startedAt) },
  });
});

export default router;
