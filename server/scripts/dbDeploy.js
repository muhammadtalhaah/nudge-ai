/**
 * Brings a deployment's database up to date, then exits. Run from the service start
 * command, before the server boots:
 *
 *   npm run db:deploy && npm start
 *
 * Why the start command and not the build command: Render's free plan has no
 * pre-deploy hook, and a build runs in a different container from the one that serves
 * traffic. Running here also means a failed bootstrap fails the deploy loudly, rather
 * than letting the service come up against an unusable database — /api/ready only
 * issues `SELECT 1`, so it cannot tell a schemaless database from a healthy one.
 *
 * Safe to run on every boot, which is what the free plan's spin-down makes it do:
 *
 *   * the schema is applied only when it is actually absent. db/schema.sql uses bare
 *     CREATE TABLE, so applying it twice is an error, not a no-op — hence the probe
 *     rather than an unconditional apply.
 *   * db/seed-tenant.sql is guarded by ON CONFLICT DO NOTHING throughout, so it is
 *     re-applied unconditionally and simply does nothing on a warm database. That also
 *     means a provider added to the file later lands on the next deploy.
 *
 * Deliberately does NOT apply db/seed-demo.sql: those accounts carry password hashes
 * that are public in this repository. A deployment starts with no users, and the first
 * real account is created through the normal registration flow.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

/** Any app table would do as the probe; businesses is the one everything else hangs off. */
const SENTINEL_TABLE = 'businesses';

const main = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('db:deploy — DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`db:deploy — could not connect: ${error.message}`);
    process.exit(1);
  }

  try {
    const { rows } = await client.query('SELECT to_regclass($1) AS oid', [
      `public.${SENTINEL_TABLE}`,
    ]);
    const alreadyApplied = rows[0]?.oid !== null;

    if (alreadyApplied) {
      console.log('db:deploy — schema already present, skipping db/schema.sql');
    } else {
      console.log('db:deploy — empty database, applying db/schema.sql');
      // schema.sql wraps itself in BEGIN/COMMIT, so it is sent as one statement batch.
      await client.query(await readFile(resolve(repoRoot, 'db/schema.sql'), 'utf8'));

      const { rows: excl } = await client.query(
        `SELECT conname FROM pg_constraint WHERE contype = 'x'`,
      );
      if (excl.length < 2) {
        console.error(
          'db:deploy — expected 2 exclusion constraints; double-booking guard missing.',
        );
        process.exit(1);
      }
    }

    console.log('db:deploy — applying db/seed-tenant.sql');
    await client.query(await readFile(resolve(repoRoot, 'db/seed-tenant.sql'), 'utf8'));

    // Proves the row authService resolves on every registration actually exists. Without
    // it nobody can create an account, and the failure would only surface at signup.
    const slug = process.env.DEFAULT_BUSINESS_SLUG || 'northside-health';
    const { rows: business } = await client.query('SELECT 1 FROM businesses WHERE slug = $1', [
      slug,
    ]);
    if (business.length === 0) {
      console.error(
        `db:deploy — DEFAULT_BUSINESS_SLUG "${slug}" matches no business after seeding.\n` +
          'Registration would fail for every user. Check db/seed-tenant.sql.',
      );
      process.exit(1);
    }

    const { rows: counts } = await client.query(
      `SELECT (SELECT count(*)::text FROM businesses) AS businesses,
              (SELECT count(*)::text FROM providers) AS providers,
              (SELECT count(*)::text FROM users)     AS users`,
    );
    console.log('db:deploy — ready:', counts[0]);
  } catch (error) {
    console.error(`db:deploy — failed: ${error.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
};

await main();
