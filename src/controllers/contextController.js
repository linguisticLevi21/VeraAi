'use strict';

const { validateContextBody } = require('../validators/schemas');
const { pushContext } = require('../services/contextService');
const { success, fail } = require('../utils/response');

/**
 * POST /v1/context
 *
 * Receives a context push from the judge. Stores or updates the context
 * entry according to version-conflict semantics.
 *
 * Success response (200):
 *   { accepted: true, ack_id: string, stored_at: ISO-8601 }
 *
 * Conflict response (409):
 *   { accepted: false, reason: "stale_version", current_version: number }
 *
 * Error response (400):
 *   { accepted: false, reason: "invalid_scope", details: [...] }
 */
function pushContextHandler(req, res, next) {
  try {
    validateContextBody(req.body);
  } catch (err) {
    // Validation errors must return the contract-specific shape for 400.
    return res.status(400).json({
      accepted: false,
      reason: 'invalid_scope',
      details: err.details || err.message,
      _meta: {
        requestId: res.locals.requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - (res.locals.startedAt || Date.now()),
      },
    });
  }

  const { scope, context_id, version, payload, delivered_at } = req.body;

  const result = pushContext({
    scope,
    contextId: context_id,
    version,
    payload,
    deliveredAt: delivered_at,
    log: req.log,
  });

  if (!result.accepted) {
    // Stale version conflict — 409 per contract.
    return res.status(409).json({
      accepted: false,
      reason: result.reason,
      current_version: result.current_version,
      _meta: {
        requestId: res.locals.requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - (res.locals.startedAt || Date.now()),
      },
    });
  }

  return success(res, {
    accepted: true,
    ack_id: result.ack_id,
    stored_at: result.stored_at,
  });
}

module.exports = { pushContextHandler };
