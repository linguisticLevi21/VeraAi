'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./src/config');
const { API_PREFIX } = require('./src/config/constants');
const requestContext = require('./src/middleware/requestContext');
const notFound = require('./src/middleware/notFound');
const errorHandler = require('./src/middleware/errorHandler');
const createRateLimiter = require('./src/middleware/rateLimiter');
const systemRoutes = require('./src/routes/system');
const apiRoutes = require('./src/routes/api');

/**
 * Creates and configures the Express application.
 * Exported as a factory function so the app can be imported in tests
 * without immediately binding to a port.
 *
 * @returns {import('express').Application}
 */
function createApp() {
  const app = express();

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(
    express.json({
      limit: `${Math.ceil(config.context.maxSizeBytes / 1024)}kb`,
      strict: true,
    })
  );

  // ── HTTP request logging (morgan → winston stream) ────────────────────────
  app.use(
    morgan(config.isProduction ? 'combined' : 'dev', {
      stream: {
        write: (message) => {
          const { createLogger } = require('winston');
          // Pipe morgan output through the root winston logger at 'http' level.
          require('./src/utils/logger').http(message.trim());
        },
      },
      skip: (req) => req.url === `${API_PREFIX}/healthz`,
    })
  );

  // ── Request context (ID + timing) ─────────────────────────────────────────
  app.use(requestContext);

  // ── Rate limiter ──────────────────────────────────────────────────────────
  app.use(createRateLimiter());

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use(API_PREFIX, systemRoutes);
  app.use(API_PREFIX, apiRoutes);

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use(notFound);

  // ── Global error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
