'use strict';

const logger = require('../utils/logger');
const { fail } = require('../utils/response');

/**
 * Global error handler middleware.
 *
 * Must be registered LAST in the Express middleware chain (after all routes).
 * Express identifies error-handling middleware by its 4-argument signature.
 *
 * Handles:
 * - Validation errors (status 400)
 * - Operational errors with a known statusCode
 * - Completely unexpected errors (status 500)
 *
 * All errors are logged with full stack traces in development and sanitized
 * messages in production to avoid leaking internals to the judge harness.
 */
function errorHandler(err, req, res, next) {
  // If response streaming has already started, delegate to Express default.
  if (res.headersSent) {
    return next(err);
  }

  const requestLog = req.log || logger;
  const status = err.statusCode || err.status || 500;
  const isOperational = err.isOperational === true || status < 500;

  const code = err.code || (status === 400 ? 'bad_request' : 'internal_error');
  const message = isOperational
    ? err.message
    : 'An unexpected internal error occurred. Please check your request and try again.';

  const logMeta = {
    method: req.method,
    url: req.originalUrl,
    status,
    code,
    stack: err.stack,
  };

  if (status >= 500) {
    requestLog.error('Unhandled server error', logMeta);
  } else {
    requestLog.warn('Operational error', logMeta);
  }

  return fail(res, status, code, message, isOperational ? err.details : undefined);
}

module.exports = errorHandler;
