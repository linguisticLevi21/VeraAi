'use strict';

const config = require('./src/config');
const logger = require('./src/utils/logger');
const createApp = require('./app');

const app = createApp();
let server;

// ── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Cleanly shuts down the HTTP server, giving in-flight requests up to 10s
 * to complete before forcefully closing connections.
 *
 * This is critical for a judge harness scenario — an abrupt SIGTERM during
 * a /v1/tick or /v1/reply call would cause a timeout penalty.
 *
 * @param {string} signal - The OS signal that triggered the shutdown
 */
function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown…`);

  if (!server) {
    logger.warn('Server not yet bound — exiting immediately.');
    process.exit(0);
  }

  server.close((err) => {
    if (err) {
      logger.error('Error during graceful shutdown', { error: err.message });
      process.exit(1);
    }
    logger.info('HTTP server closed. Goodbye.');
    process.exit(0);
  });

  // Force-kill after 10s if connections don't drain.
  setTimeout(() => {
    logger.error('Graceful shutdown timed out (10s). Force exiting.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise),
  });
  // Do not exit — let the request timeout so the judge logs it correctly.
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — process unstable, shutting down', {
    error: err.message,
    stack: err.stack,
  });
  gracefulShutdown('uncaughtException');
});

// ── Start ────────────────────────────────────────────────────────────────────

server = app.listen(config.port, () => {
  logger.info('Server started', {
    env: config.env,
    port: config.port,
    pid: process.pid,
    node: process.version,
  });
  logger.info(`API available at http://localhost:${config.port}/v1`);
});

module.exports = server;
