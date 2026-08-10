/**
 * Process entry point: boot checks, HTTP listener, and graceful shutdown.
 */

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { assertDatabaseReachable, closePool } from './db/pool.js';
import { logger } from './logger/index.js';
import { attachSocketServer } from './socket.js';

const start = async () => {
  // Fail before accepting traffic rather than 500ing the first request.
  try {
    await assertDatabaseReachable();
  } catch (error) {
    logger.fatal({ err: error }, 'cannot reach the database — check DATABASE_URL');
    process.exit(1);
  }

  const app = createApp();
  const httpServer = createServer(app);
  const io = attachSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, aiProvider: env.aiProvider },
      `listening on http://localhost:${env.PORT}`,
    );
  });

  // ------------------------------------------------------------ graceful shutdown ----
  // Stop accepting connections, let in-flight requests finish, then release the pool.
  // Without this, a deploy can drop requests mid-flight and leak DB connections.
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out after 10s — exiting anyway');
      process.exit(1);
    }, 10_000);
    // Do not let this timer hold the event loop open if shutdown finishes first.
    forceExit.unref();

    // Close sockets first: open WebSockets keep the HTTP server alive, so httpServer.close()
    // would otherwise never fire its callback and shutdown would hit the force-exit timer.
    await io.close();

    httpServer.close(async () => {
      try {
        await closePool();
        clearTimeout(forceExit);
        logger.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A promise rejection nobody handled leaves the process in an unknown state. Log it
  // loudly and exit so the supervisor restarts a clean one.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
};

await start();
