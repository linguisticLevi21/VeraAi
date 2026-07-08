'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const { fail } = require('../utils/response');

/**
 * Rate Limiter Factory
 *
 * Two tiers:
 *   1. judgeApiLimiter   — applied to /context, /tick, /reply
 *                          Generous limits: 300 req/min (judge hammers these)
 *   2. defaultLimiter    — applied globally as a safety backstop
 *                          Conservative: 60 req/min
 *
 * Both use a consistent error envelope to keep the response shape uniform.
 * The judge is unlikely to exceed 300/min, so these limits should never
 * fire in normal evaluation — they exist purely as protection.
 */

function makeHandler(label) {
  return function (req, res) {
    return fail(
      res,
      429,
      'rate_limit_exceeded',
      `Too many requests to ${label}. Please slow down and retry after the window resets.`
    );
  };
}

/**
 * Generous limiter for judge-facing AI endpoints.
 * 300 requests per 60-second window per IP.
 */
function createJudgeLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,      // default 60s
    max: config.rateLimit.max,                 // default 300
    standardHeaders: true,
    legacyHeaders: false,
    handler: makeHandler('/v1/context, /v1/tick, /v1/reply'),
    keyGenerator: (req) => {
      // Use forwarded IP (Render/Railway proxy) or fallback to direct IP
      return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
    },
  });
}

/**
 * Conservative default limiter applied globally as a backstop.
 * 60 requests per 60-second window per IP.
 */
function createDefaultLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: makeHandler('this endpoint'),
    keyGenerator: (req) => {
      return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
    },
  });
}

/**
 * Default export: the judge-compatible rate limiter.
 * (Called as createRateLimiter() throughout the app.)
 */
function createRateLimiter() {
  return createJudgeLimiter();
}

module.exports = createRateLimiter;
module.exports.createJudgeLimiter = createJudgeLimiter;
module.exports.createDefaultLimiter = createDefaultLimiter;
