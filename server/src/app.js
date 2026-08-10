/**
 * Express application assembly.
 *
 * Kept separate from server.js (which owns the HTTP listener, sockets and shutdown) so
 * tests can mount the app with supertest without binding a port.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './logger/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { globalRateLimit } from './middlewares/rateLimit.js';
import { requestId } from './middlewares/requestId.js';
import apiRouter from './routes/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export const createApp = () => {
  const app = express();

  // Behind Render/Railway's proxy, req.ip must come from X-Forwarded-For or every client
  // shares one rate-limit bucket. Trust exactly one hop, not `true` — trusting the whole
  // chain lets a client spoof its own address.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA and API share an origin in production, so the default same-origin policies
      // are correct. CSP is left off because a hashless Vite bundle would need
      // 'unsafe-inline' anyway — documented as a known limitation rather than a fig leaf.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      // requestId middleware runs first, so this is always populated; the fallback exists
      // only for the case where this middleware is somehow reached without it.
      genReqId: (_req, res) => String(res.locals.requestId ?? randomUUID()),
      // Health checks would otherwise dominate the log at info level.
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    }),
  );

  // Only needed for the Vite dev server; in production the client is same-origin.
  // `credentials` is required for the httpOnly refresh cookie to be sent at all.
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );

  app.use(compression());
  // A body limit is a cheap denial-of-service guard; nothing here needs a large payload.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', globalRateLimit);
  app.use('/api', apiRouter);

  // ---------------------------------------------------------------- static client ----
  // In production this process serves the built SPA from the same origin as the API, so
  // there is no CORS and no cross-site cookie. In development Vite serves it instead.
  const clientDist = resolve(here, '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));

    // SPA fallback: any non-/api path is a client route. Registered after the API so it
    // can never shadow an endpoint, and unknown /api paths still get a JSON 404.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(resolve(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
