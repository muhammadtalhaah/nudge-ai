/**
 * Structured logging.
 *
 * pino over winston: it is meaningfully faster, its default output is newline-delimited
 * JSON that log aggregators ingest without a parser, and redaction is a first-class
 * config option rather than a custom format function.
 */

import pino from 'pino';

import { env } from '../config/env.js';

/**
 * Paths scrubbed before anything is written. Secrets end up in logs by accident — an
 * error object carrying a whole request, a debug dump of headers — so this is declared
 * once centrally rather than left to each call site.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.MISTRAL_API_KEY',
  '*.apiKey',
];

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'nudge-ai-api' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(env.LOG_PRETTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

/** Child loggers so each subsystem's lines are attributable without repeating a field. */
export const dbLogger = logger.child({ module: 'db' });
export const aiLogger = logger.child({ module: 'ai' });
export const socketLogger = logger.child({ module: 'socket' });
export const authLogger = logger.child({ module: 'auth' });
