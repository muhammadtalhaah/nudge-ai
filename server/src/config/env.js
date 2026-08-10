/**
 * Environment configuration.
 *
 * Validated with Zod at import time and exported as a frozen object. A misconfigured server
 * fails immediately at boot with a readable list of problems, rather than throwing
 * `undefined is not a function` from inside a request three hours later.
 */

import 'dotenv/config';
import { z } from 'zod';

/** Env vars arrive as strings or not at all, so booleans need coercing by hand. */
const booleanish = (fallback) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
    return value;
  }, z.boolean());

/** Treat an empty string like an absent value — `FOO=` in a .env file is not a value. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

    /** Only consulted in development; production serves the client from this process. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: booleanish(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /**
     * Tenant that self-signups join. The schema is multi-tenant but there is no tenant
     * picker in the UI, so signup needs one designated business. A production app would
     * resolve this from a subdomain or an invite token instead.
     */
    DEFAULT_BUSINESS_SLUG: z.string().min(1).default('northside-health'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    AI_PROVIDER: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.enum(['mistral', 'stub']).optional(),
    ),
    MISTRAL_API_KEY: optionalString,
    MISTRAL_MODEL: z.string().default('mistral-small-latest'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
    AI_HISTORY_TURNS: z.coerce.number().int().min(1).max(50).default(10),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanish(false),
  })
  .transform((raw) => ({
    ...raw,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
    /**
     * Resolved once here so no other module has to re-derive it: use whatever was asked
     * for, otherwise Mistral when a key exists, otherwise the offline stub. This is what
     * makes the app runnable with no credentials at all.
     */
    aiProvider: raw.AI_PROVIDER ?? (raw.MISTRAL_API_KEY ? 'mistral' : 'stub'),
  }))
  .superRefine((config, ctx) => {
    if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }

    if (config.aiProvider === 'mistral' && !config.MISTRAL_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MISTRAL_API_KEY'],
        message: 'AI_PROVIDER=mistral requires MISTRAL_API_KEY (or use AI_PROVIDER=stub)',
      });
    }

    if (config.isProduction) {
      if (config.JWT_ACCESS_SECRET.includes('replace-me')) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'Placeholder secret cannot be used in production',
        });
      }
      if (config.LOG_PRETTY) {
        ctx.addIssue({
          code: 'custom',
          path: ['LOG_PRETTY'],
          message: 'LOG_PRETTY must be false in production so logs stay machine-readable',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  console.error(`\nInvalid server configuration:\n${problems}\n`);
  console.error('Copy server/.env.example to server/.env and fill in the missing values.\n');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
