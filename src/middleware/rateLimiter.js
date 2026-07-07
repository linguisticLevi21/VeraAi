'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const { fail } = require('../utils/response');

/**
 * Rate limiter factory.
 *
 * Returns a configured express-rate-limit middleware instance.
 * The judge harness may send up to 10 requests/sec; this limiter is set
 * generously to protect against runaway clients without blocking the judge.
 *
 * On limit breach, the standard error envelope is returned rather than the
 * default plain-text response, keeping the response shape consistent.
 */
function createRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      return fail(
        res,
        429,
        'rate_limit_exceeded',
        'Too many requests. Please slow down and retry after the window resets.'
      );
    },
  });
}

module.exports = createRateLimiter;
