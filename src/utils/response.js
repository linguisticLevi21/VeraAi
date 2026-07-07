'use strict';

/**
 * Centralized HTTP response formatter.
 *
 * All controller methods must use these helpers rather than calling
 * res.json() directly. This guarantees a consistent envelope shape
 * for every response the bot sends to the judge.
 *
 * Envelope shape:
 * {
 *   success: boolean,
 *   data:    <payload> | null,
 *   error:   { code: string, message: string, details?: any } | null,
 *   meta: {
 *     requestId: string,
 *     timestamp:  ISO-8601,
 *     durationMs: number
 *   }
 * }
 *
 * NOTE: /v1/context, /v1/tick, /v1/reply, /v1/healthz, /v1/metadata
 * all have specific contract-mandated top-level keys (e.g. "accepted",
 * "actions", "status"). Those are placed directly inside `data` so the
 * controller can spread them at the top level when required.
 */

/**
 * Sends a successful response.
 *
 * @param {import('express').Response} res
 * @param {object}  data        - Response payload (spread at top level by controllers when needed)
 * @param {number}  [status=200]
 */
function success(res, data, status = 200) {
  const startedAt = res.locals.startedAt || Date.now();
  return res.status(status).json({
    ...data,
    _meta: {
      requestId: res.locals.requestId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
  });
}

/**
 * Sends a structured error response.
 *
 * @param {import('express').Response} res
 * @param {number}  status
 * @param {string}  code        - Machine-readable error code (snake_case)
 * @param {string}  message     - Human-readable explanation
 * @param {any}     [details]   - Optional extra context
 */
function fail(res, status, code, message, details) {
  const startedAt = res.locals.startedAt || Date.now();
  const body = {
    success: false,
    error: { code, message },
    _meta: {
      requestId: res.locals.requestId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return res.status(status).json(body);
}

module.exports = { success, fail };
