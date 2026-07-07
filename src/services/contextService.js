'use strict';

const contextStore = require('../memory/contextStore');
const contextManager = require('../memory/ContextManager');
const { generateAckId } = require('../utils/ids');
const logger = require('../utils/logger');

/**
 * ContextService — business logic for POST /v1/context.
 *
 * Two-layer write on every push:
 *   1. contextStore.upsert()   — keeps the raw versioned payload in the global store
 *                                so /v1/healthz can count loaded contexts correctly.
 *   2. contextManager.push()   — hydrates merchant-level memory, drives state transitions,
 *                                and updates per-merchant analytics.
 *
 * Both writes are gated on the same version semantics so they stay in sync.
 */

/**
 * Stores or updates a context entry.
 *
 * @param {object} params
 * @param {string} params.scope
 * @param {string} params.contextId
 * @param {number} params.version
 * @param {object} params.payload
 * @param {string} params.deliveredAt
 * @param {object} [params.log]
 * @returns {{ accepted: boolean, ack_id?: string, stored_at?: string, reason?: string, current_version?: number }}
 */
function pushContext({ scope, contextId, version, payload, deliveredAt, log = logger }) {
  log.debug('ContextService: pushing context', { scope, contextId, version });

  // Layer 1 — raw global store (drives /v1/healthz counts)
  const storeResult = contextStore.upsert(scope, contextId, version, payload);

  if (!storeResult.accepted) {
    log.warn('ContextService: context rejected by store', {
      scope,
      contextId,
      incoming_version: version,
      reason: storeResult.reason,
      current_version: storeResult.current_version,
    });
    return storeResult;
  }

  // Layer 2 — merchant memory (drives state machine, analytics, conversation history)
  const memoryResult = contextManager.push({ scope, contextId, version, payload, deliveredAt, log });

  if (!memoryResult.accepted) {
    // Memory layer may legitimately return not-accepted for reasons like
    // missing merchant_id on a customer payload. Log and pass through.
    log.warn('ContextService: memory layer did not accept context', {
      scope,
      contextId,
      reason: memoryResult.reason,
    });
  }

  log.info('ContextService: context accepted', {
    scope,
    contextId,
    version,
    stored_at: storeResult.stored_at,
  });

  return {
    accepted: true,
    ack_id: generateAckId(contextId, version),
    stored_at: storeResult.stored_at,
  };
}

/**
 * Returns the current context count breakdown by scope.
 * Used by /v1/healthz.
 *
 * @returns {{ category: number, merchant: number, customer: number, trigger: number }}
 */
function getContextCounts() {
  return contextStore.counts();
}

/**
 * Wipes all stored context and merchant memory.
 * Called from the teardown endpoint at the end of a test session.
 */
function clearAll() {
  contextStore.clear();
  const merchantRepository = require('../memory/MerchantRepository');
  merchantRepository.clearAll();
}

module.exports = { pushContext, getContextCounts, clearAll };
