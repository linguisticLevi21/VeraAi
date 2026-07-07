'use strict';

const memoryStore = require('./MemoryStore');
const stateManager = require('./StateManager');
const versionManager = require('./VersionManager');
const logger = require('../utils/logger');

/**
 * MerchantRepository — the single point of access for all merchant memory operations.
 *
 * Coordinates MemoryStore (data), StateManager (state machine), and
 * VersionManager (version gating). No other module should call these three
 * directly — all reads and writes must flow through this repository.
 *
 * Responsibilities:
 *   - Resolve incoming context versions before any write occurs
 *   - Route context payloads to the correct MemoryStore writers
 *   - Trigger StateManager recomputation after every write
 *   - Expose clean query methods for services and engines
 */
class MerchantRepository {
  // ---------------------------------------------------------------------------
  // Context ingestion (called by ContextManager)
  // ---------------------------------------------------------------------------

  /**
   * Processes an incoming merchant-scope context push.
   * Handles version resolution, memory hydration, and state recomputation.
   *
   * @param {string} merchantId
   * @param {number} version
   * @param {object} payload
   * @returns {{ accepted: boolean, reason?: string, currentVersion?: number }}
   */
  ingestMerchantContext(merchantId, version, payload) {
    const resolution = versionManager.resolve(merchantId, 'merchant', version);

    if (resolution === 'STALE') {
      logger.debug('MerchantRepository: stale merchant context ignored', {
        merchantId,
        incomingVersion: version,
        currentVersion: versionManager.getCurrentVersion(merchantId, 'merchant'),
      });
      return {
        accepted: false,
        reason: 'stale_version',
        currentVersion: versionManager.getCurrentVersion(merchantId, 'merchant'),
      };
    }

    if (resolution === 'SAME') {
      logger.debug('MerchantRepository: same version, idempotent no-op', { merchantId, version });
      return { accepted: true };
    }

    // UPGRADE — create or hydrate
    const isNew = !memoryStore.merchantExists(merchantId);
    if (isNew) {
      memoryStore.createMerchant(merchantId, payload.category_slug || 'unknown');
      stateManager.init(merchantId);
    }

    memoryStore.replaceContext(merchantId, payload, version);

    if (payload.performance) {
      memoryStore.storePerformance(merchantId, payload.performance);
    }
    if (payload.offers) {
      memoryStore.storeOffers(merchantId, payload.offers);
    }

    versionManager.commit(merchantId, 'merchant', version);

    const signals = this._buildSignals(merchantId);
    const stateEntry = stateManager.compute(merchantId, signals);

    memoryStore.updateContext(merchantId, {
      merchantState: stateEntry.state,
    });

    logger.info('MerchantRepository: merchant context ingested', {
      merchantId,
      version,
      newState: stateEntry.state,
      isNew,
    });

    return { accepted: true };
  }

  /**
   * Processes an incoming category-scope context push.
   * Stores the category payload on all merchants that reference this slug.
   *
   * @param {string} categorySlug   - e.g. "dentists"
   * @param {number} version
   * @param {object} payload
   * @returns {{ accepted: boolean }}
   */
  ingestCategoryContext(categorySlug, version, payload) {
    const resolution = versionManager.resolve(categorySlug, 'category', version);

    if (resolution === 'STALE') {
      return {
        accepted: false,
        reason: 'stale_version',
        currentVersion: versionManager.getCurrentVersion(categorySlug, 'category'),
      };
    }

    if (resolution === 'SAME') {
      return { accepted: true };
    }

    versionManager.commit(categorySlug, 'category', version);

    // Push category data to every merchant in this category
    const merchantIds = memoryStore.allMerchantIds();
    let updated = 0;
    for (const merchantId of merchantIds) {
      const m = memoryStore.getMerchant(merchantId);
      if (m && m.scope === categorySlug) {
        memoryStore.updateContext(merchantId, {
          category: payload,
        });

        if (payload.peer_stats && payload.peer_stats.avg_ctr !== undefined) {
          memoryStore.storeMetrics(merchantId, {
            peerMedianCtr: payload.peer_stats.avg_ctr,
          });
        }
        updated++;
      }
    }

    logger.info('MerchantRepository: category context ingested', {
      categorySlug,
      version,
      merchantsUpdated: updated,
    });

    return { accepted: true };
  }

  /**
   * Processes an incoming customer-scope context push.
   * The customer is stored on its owning merchant's memory.
   *
   * @param {string} customerId
   * @param {number} version
   * @param {object} payload
   * @returns {{ accepted: boolean, reason?: string }}
   */
  ingestCustomerContext(customerId, version, payload) {
    const merchantId = payload.merchant_id;
    if (!merchantId) {
      return { accepted: false, reason: 'customer_payload_missing_merchant_id' };
    }

    const resolution = versionManager.resolve(customerId, 'customer', version);
    if (resolution === 'STALE') {
      return {
        accepted: false,
        reason: 'stale_version',
        currentVersion: versionManager.getCurrentVersion(customerId, 'customer'),
      };
    }
    if (resolution === 'SAME') {
      return { accepted: true };
    }

    memoryStore.getOrCreate(merchantId);
    memoryStore.storeCustomer(merchantId, customerId, payload, version);
    versionManager.commit(customerId, 'customer', version);

    logger.debug('MerchantRepository: customer context ingested', {
      customerId,
      merchantId,
      version,
    });
    return { accepted: true };
  }

  /**
   * Processes an incoming trigger-scope context push.
   * Stores the trigger in the merchant's triggerHistory.
   *
   * @param {string} triggerId
   * @param {number} version
   * @param {object} payload
   * @returns {{ accepted: boolean, reason?: string }}
   */
  ingestTriggerContext(triggerId, version, payload) {
    const resolution = versionManager.resolve(triggerId, 'trigger', version);
    if (resolution === 'STALE') {
      return {
        accepted: false,
        reason: 'stale_version',
        currentVersion: versionManager.getCurrentVersion(triggerId, 'trigger'),
      };
    }
    if (resolution === 'SAME') {
      return { accepted: true };
    }

    versionManager.commit(triggerId, 'trigger', version);

    const merchantId = payload.merchant_id;
    if (merchantId) {
      const m = memoryStore.getOrCreate(merchantId);
      m.triggerHistory.push({
        triggerId,
        version,
        payload: { ...payload },
        storedAt: new Date().toISOString(),
      });
      m.lastUpdated = new Date().toISOString();
    }

    logger.debug('MerchantRepository: trigger context ingested', { triggerId, merchantId, version });
    return { accepted: true };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the full MerchantMemory for a given merchantId, or null.
   *
   * @param {string} merchantId
   * @returns {import('./MemoryStore').MerchantMemory | null}
   */
  getMerchant(merchantId) {
    return memoryStore.getMerchant(merchantId);
  }

  /**
   * Returns the assembled 4-context bundle for a given (merchantId, triggerId).
   * Used by the DecisionEngine when composing messages.
   *
   * @param {string} merchantId
   * @param {string} triggerId
   * @returns {{ merchant, category, trigger, customer } | null}
   */
  assembleContextBundle(merchantId, triggerId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return null;

    const triggerEntry = m.triggerHistory.find((t) => t.triggerId === triggerId);
    const trigger = triggerEntry ? triggerEntry.payload : null;

    let customer = null;
    if (trigger && trigger.customer_id) {
      customer = m.customerContexts.get(trigger.customer_id) || null;
    }

    return {
      merchant: m,
      category: m.category,
      trigger,
      customer,
    };
  }

  /**
   * Returns all merchants whose current state equals the given state.
   *
   * @param {string} state
   * @returns {string[]} merchantIds
   */
  getMerchantsByState(state) {
    return memoryStore.allMerchantIds().filter((id) => {
      const m = memoryStore.getMerchant(id);
      return m && m.merchantState === state;
    });
  }

  /**
   * Returns all active trigger entries across all merchants for the given triggerIds.
   *
   * @param {string[]} triggerIds
   * @returns {Array<{ merchantId, triggerId, payload }>}
   */
  resolveActiveTriggers(triggerIds) {
    const results = [];
    for (const merchantId of memoryStore.allMerchantIds()) {
      const m = memoryStore.getMerchant(merchantId);
      if (!m) continue;
      for (const entry of m.triggerHistory) {
        if (triggerIds.includes(entry.triggerId)) {
          results.push({ merchantId, triggerId: entry.triggerId, payload: entry.payload });
        }
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  /**
   * Wipes all merchant memory and associated state.
   * Called on POST /v1/teardown.
   */
  clearAll() {
    memoryStore.clear();
    stateManager.clear();
    versionManager.clear();
    logger.info('MerchantRepository: all state cleared');
  }

  // ---------------------------------------------------------------------------
  // Private — signal builder
  // ---------------------------------------------------------------------------

  /**
   * Builds a MerchantSignals object from the stored memory for a given merchant.
   * This is passed to StateManager.compute() to drive state transitions.
   *
   * @param {string} merchantId
   * @returns {import('./StateManager').MerchantSignals}
   */
  _buildSignals(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) {
      return {
        subscriptionStatus: null,
        hasActiveCampaign: false,
        awaitingMerchantReply: false,
        ctr: null,
        peerMedianCtr: null,
        viewsDelta7d: null,
        activeCustomerConversations: null,
        lapsedCustomers: null,
        totalCustomers: null,
        hasStaleSignals: false,
        hasPerformanceData: false,
      };
    }

    const perf = m.performance || {};
    const identity = m.identity || {};
    const sub = identity.subscription || (m.performance ? {} : {});

    // Subscription status — check top-level identity or payload.subscription
    const subscriptionStatus = m._subscriptionStatus || null;

    // CTR
    const ctr = m.metrics.currentCtr !== null ? m.metrics.currentCtr :
                 (perf.ctr !== undefined ? perf.ctr : null);
    const peerMedianCtr = m.metrics.peerMedianCtr;

    // Views delta
    const viewsDelta7d = perf.delta_7d ? (perf.delta_7d.views_pct || null) : null;

    // Campaign detection
    const hasActiveCampaign = m.campaigns.some((c) => c.status === 'active');

    // Awaiting reply
    const lastConv = m.conversationHistory[m.conversationHistory.length - 1];
    const awaitingMerchantReply = lastConv ? lastConv.speaker === 'vera' : false;

    // Customer signals
    const customerAggregate = perf.customer_aggregate || {};
    const lapsedCustomers = customerAggregate.lapsed_180d_plus || null;
    const totalCustomers = customerAggregate.total_unique_ytd || null;
    const activeCustomerConversations = m.customerContexts.size > 0 ? m.customerContexts.size : null;

    // Stale signals
    const rawSignals = perf.signals || [];
    const hasStaleSignals = rawSignals.some(
      (s) => typeof s === 'string' && (s.includes('stale_posts') || s.includes('ctr_below_peer'))
    );

    const hasPerformanceData = m.performance !== null;

    return {
      subscriptionStatus,
      hasActiveCampaign,
      awaitingMerchantReply,
      ctr,
      peerMedianCtr,
      viewsDelta7d,
      activeCustomerConversations,
      lapsedCustomers,
      totalCustomers,
      hasStaleSignals,
      hasPerformanceData,
    };
  }
}

// Singleton export
module.exports = new MerchantRepository();
