/**
 * Rate limiting.
 *
 * Three tiers, because the endpoints have very different abuse profiles:
 *   global — blunt protection against runaway clients
 *   auth   — credential stuffing is free to attempt, so login/signup get a small budget
 *   chat   — every message may trigger a paid model call, so this is the tightest
 *
 * In-memory store: correct for a single instance, which is what this prototype deploys as.
 * Behind more than one instance the counters would need to move to Redis; noted in the
 * README rather than pretended away.
 */

import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';

import { ERROR_CODES } from '@shared/constants.ts';

import { env } from '../config/env.ts';
import { logger } from '../logger/index.ts';
import { sendError } from '../utils/httpResponse.ts';

const handler = (req: Request, res: Response): void => {
  logger.warn(
    { requestId: res.locals.requestId, ip: req.ip, path: req.originalUrl },
    'rate limit exceeded',
  );
  sendError(res, 429, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please slow down.');
};

const baseOptions: Partial<Options> = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  // Tests would otherwise trip the limiter and fail for the wrong reason.
  skip: () => env.isTest,
};

export const globalRateLimit = rateLimit({
  ...baseOptions,
  limit: env.RATE_LIMIT_MAX,
});

export const authRateLimit = rateLimit({
  ...baseOptions,
  limit: env.AUTH_RATE_LIMIT_MAX,
  // Count failures only: a user logging in successfully many times is not an attack,
  // and this stops a shared office IP from locking itself out.
  skipSuccessfulRequests: true,
});

/**
 * Keyed by user id when authenticated, falling back to IP. Chat is behind auth, so this
 * budgets per account rather than per network — several users on one NAT do not starve
 * each other.
 */
export const chatRateLimit = rateLimit({
  ...baseOptions,
  limit: env.CHAT_RATE_LIMIT_MAX,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
});
