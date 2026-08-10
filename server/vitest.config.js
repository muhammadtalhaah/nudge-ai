import { defineConfig } from 'vitest/config';

/**
 * Server tests run against a real PostgreSQL database rather than a mocked one.
 *
 * That is a deliberate choice: the most important guarantees in this system — the
 * double-booking exclusion constraint, refresh-token rotation under concurrency — are
 * enforced *by* the database. A mocked pg client would happily let all of them pass while
 * the real behaviour was broken, which is precisely the bug class these tests exist to catch.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Each file gets a clean process, and files run one at a time so tests sharing the
    // database cannot interleave and truncate each other's rows mid-assertion.
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./src/test/setup.js'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
