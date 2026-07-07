'use strict';

const merchantRepository = require('./MerchantRepository');
const analyticsManager = require('./AnalyticsManager');
const logger = require('../utils/logger');

/**
 * ContextManager — top-level orchestrator for POST /v1/context.
 *
 * Routes each context push to the correct MerchantRepository ingestion method
 * based on the scope field, then updates analytics regardless of outcome.
 *
 * This is the only module that services/contextService.js should interact with
 * for merchant-memory operations. It returns the exact response shape the
 * controller expects.
 */
class ContextManager {
  /**
   * Processes a context push from the judge.
   *
   * @param {object} params
   * @param {string} params.scope
   * @param {string} params.contextId
   * @param {number} params.version
   * @param {object} params.payload
   * @param {string} params.deliveredAt
   * @param {object} [params.log]
   * @returns {{ accepted: boolean, reason?: string, current_version?: number }}
   */
  push({ scope, contextId, version, payload, deliveredAt, log = logger }) {
    log.debug('ContextManager: routing context push', { scope, contextId, version });

    let result;

    switch (scope) {
      case 'merchant':
        result = merchantRepository.ingestMerchantContext(contextId, version, payload);
        break;

      case 'category':
        result = merchantRepository.ingestCategoryContext(contextId, version, payload);
        break;

      case 'customer':
        result = merchantRepository.ingestCustomerContext(contextId, version, payload);
        break;

      case 'trigger':
        result = merchantRepository.ingestTriggerContext(contextId, version, payload);
        break;

      default:
        return { accepted: false, reason: 'invalid_scope' };
    }

    // Update analytics on the owning merchant
    const merchantId = this._resolveMerchantId(scope, contextId, payload);
    if (merchantId) {
      if (result.accepted) {
        analyticsManager.recordContextAccepted(merchantId);
      } else {
        analyticsManager.recordContextIgnored(merchantId);
      }
    }

    log.debug('ContextManager: push complete', {
      scope,
      contextId,
      version,
      accepted: result.accepted,
      reason: result.reason,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Resolves which merchantId to attribute an analytics event to,
   * given the context scope and its payload.
   *
   * @param {string} scope
   * @param {string} contextId
   * @param {object} payload
   * @returns {string | null}
   */
  _resolveMerchantId(scope, contextId, payload) {
    switch (scope) {
      case 'merchant':  return contextId;
      case 'customer':  return payload.merchant_id || null;
      case 'trigger':   return payload.merchant_id || null;
      case 'category':  return null; // category applies to many merchants
      default:          return null;
    }
  }
}

// Singleton export
module.exports = new ContextManager();
