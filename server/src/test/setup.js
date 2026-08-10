/**
 * Test environment bootstrap. Runs before any test module is imported, which matters
 * because config/env.js validates and freezes on import.
 */

import { config as loadEnv } from 'dotenv';

// Load .env first so DATABASE_URL's host/port/credentials are available, then override the
// database name so tests can never touch development data.
loadEnv();

// The logger silences itself when NODE_ENV is 'test', so LOG_LEVEL is left alone here —
// 'silent' is not one of the levels the env schema accepts.
process.env.NODE_ENV = 'test';
process.env.LOG_PRETTY = 'false';
// Deterministic provider: no network, no API key, no cost.
process.env.AI_PROVIDER = 'stub';

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error('DATABASE_URL must be set (copy server/.env.example to server/.env)');
}

if (!process.env.TEST_DATABASE_URL) {
  // Swap only the final path segment, preserving host, port, credentials and query string.
  process.env.TEST_DATABASE_URL = devUrl.replace(/\/([^/?]+)(\?|$)/, '/nudge_ai_test$2');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!/nudge_ai_test/.test(process.env.DATABASE_URL)) {
  // Guard against a misconfigured URL pointing the destructive helpers at real data.
  throw new Error(
    `Refusing to run tests against "${process.env.DATABASE_URL}" — the database name must contain nudge_ai_test`,
  );
}
