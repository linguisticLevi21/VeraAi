'use strict';

const { fail } = require('../utils/response');

/**
 * 404 Not Found handler.
 *
 * Registered AFTER all route definitions and BEFORE the error handler.
 * Any request that reaches this point matched no route.
 */
function notFound(req, res) {
  return fail(res, 404, 'not_found', `Route not found: ${req.method} ${req.originalUrl}`);
}

module.exports = notFound;
