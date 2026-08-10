/**
 * Applies db/seed.sql. Idempotent — safe to run repeatedly.
 *
 *   npm run db:seed
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const main = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env first.');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Refusing to seed a production database: db/seed.sql contains publicly known demo passwords.',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const seed = await readFile(resolve(repoRoot, 'db/seed.sql'), 'utf8');

    console.log('applying db/seed.sql');
    await client.query(seed);

    const { rows } = await client.query(
      `SELECT (SELECT count(*)::text FROM businesses)          AS businesses,
              (SELECT count(*)::text FROM users)               AS users,
              (SELECT count(*)::text FROM providers)           AS providers,
              (SELECT count(*)::text FROM appointments)        AS appointments,
              (SELECT count(*)::text FROM chat_sessions)       AS chat_sessions,
              (SELECT count(*)::text FROM chat_messages)       AS chat_messages,
              (SELECT count(*)::text FROM ai_interaction_logs) AS ai_logs`,
    );

    console.log('done —', rows[0]);
    console.log('\nDemo logins (development only):');
    console.log('  ada@example.com    / Password123!');
    console.log('  grace@example.com  / Password123!');
    console.log('  admin@example.com  / AdminPass123!');
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
};

await main();
