'use strict';

const { generateRequestId } = require('../utils/ids');
const logger = require('../utils/logger');

/**
 * Request ID + timing middleware.
 *
 * Attaches a unique `X-Request-Id` header to every request and response,
 * records the start timestamp, and logs the completed request with timing.
 *
 * This must be registered BEFORE routes and AFTER morgan so the request ID
 * is available in both the request logger and all downstream middleware.
 */
function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || generateRequestId();

  res.locals.requestId = requestId;
  res.locals.startedAt = Date.now();

  req.log = logger.forRequest(requestId);

  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - res.locals.startedAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    req.log[level]('request completed', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      contentLength: res.get('Content-Length') || 0,
      userAgent: req.headers['user-agent'] || '',
    });
  });

  next();
}

module.exports = requestContext;
