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
const logger = require('./src/utils/logger');

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
  app.use(
    helmet({
      contentSecurityPolicy: false, // Not needed for a JSON API
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

  // ── Body parsing ──────────────────────────────────────────────────────────
  // express.json enforces the max context size from config.
  // If the body exceeds the limit, Express throws a 413 PayloadTooLarge
  // error that our errorHandler converts to a clean JSON 413 response.
  app.use(
    express.json({
      limit: `${Math.ceil(config.context.maxSizeBytes / 1024)}kb`,
      strict: true,
    })
  );

  // Handle JSON parse errors from express.json before they reach routes
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        accepted: false,
        reason: 'invalid_json',
        details: 'Request body is not valid JSON.',
        _meta: { requestId: res.locals.requestId, timestamp: new Date().toISOString() },
      });
    }
    if (err.status === 413) {
      return res.status(413).json({
        accepted: false,
        reason: 'payload_too_large',
        details: `Request body exceeds the maximum allowed size of ${config.context.maxSizeBytes} bytes.`,
        _meta: { requestId: res.locals.requestId, timestamp: new Date().toISOString() },
      });
    }
    return next(err);
  });

  // ── HTTP request logging (morgan → winston stream) ────────────────────────
  app.use(
    morgan(config.isProduction ? 'combined' : 'dev', {
      stream: {
        write: (message) => {
          logger.http(message.trim());
        },
      },
      skip: (req) => req.url === `${API_PREFIX}/healthz`,
    })
  );

  // ── Request context (ID + timing + observability) ─────────────────────────
  app.use(requestContext);

  // ── Rate limiter (generous — judge-compatible) ────────────────────────────
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
