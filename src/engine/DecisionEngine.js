'use strict';

const signalExtractor = require('./SignalExtractor');
const inferenceEngine = require('./InferenceEngine');
const strategySelector = require('./StrategySelector');
const actionRanker = require('./ActionRanker');
const suppressionEngine = require('./SuppressionEngine');
const messageComposer = require('./MessageComposer');
const merchantRepository = require('../memory/MerchantRepository');
const memoryStore = require('../memory/MemoryStore');
const { generateConversationId } = require('../utils/ids');
const logger = require('../utils/logger');
const { MAX_ACTIONS_PER_TICK } = require('../config/constants');

/**
 * DecisionEngine — the full AI reasoning pipeline for POST /v1/tick.
 *
 * Pipeline:
 *   resolved triggers
 *     → for each (merchantId, triggerId):
 *         1. Assemble 4-context bundle from MerchantRepository
 *         2. SignalExtractor   → signals[]
 *         3. InferenceEngine  → observations[]
 *         4. StrategySelector → candidates[]
 *         5. ActionRanker     → best candidate
 *         6. SuppressionEngine → check / skip
 *         7. strategy.compose() → raw message
 *         8. MessageComposer  → final action
 *     → return actions[]
 */
class DecisionEngine {
  /**
   * @param {object} contextStore     - Legacy ContextStore (kept for interface compatibility)
   * @param {object} conversationStore
   */
  constructor(contextStore, conversationStore) {
    this.contextStore = contextStore;
    this.conversationStore = conversationStore;
    /** @type {Set<string>} Session-level suppression keys for this tick */
    this._sessionKeys = new Set();
  }

  /**
   * Evaluates active triggers and produces proactive action objects.
   *
   * @param {object}   params
   * @param {string}   params.now               - Simulated ISO-8601 time
   * @param {string[]} params.availableTriggers  - Trigger IDs from judge
   * @returns {Promise<ActionItem[]>}
   */
  async evaluateTick({ now, availableTriggers, resolvedTriggers: preResolved }) {
    // Reset session suppression each tick
    this._sessionKeys = new Set();

    // Use pre-resolved triggers from tickService if provided (avoids double lookup)
    const resolvedTriggers = preResolved || merchantRepository.resolveActiveTriggers(availableTriggers);
    logger.debug('DecisionEngine: resolved triggers', {
      requested: availableTriggers.length,
      resolved: resolvedTriggers.length,
    });

    if (resolvedTriggers.length === 0) return [];

    const actions = [];

    for (const { merchantId, triggerId, payload: triggerPayload } of resolvedTriggers) {
      if (actions.length >= MAX_ACTIONS_PER_TICK) break;

      try {
        const action = await this._processOneTrigger(merchantId, triggerId, triggerPayload, now);
        if (action) actions.push(action);
      } catch (err) {
        logger.warn('DecisionEngine: error processing trigger', { merchantId, triggerId, error: err.message });
      }
    }

    return actions;
  }

  // ---------------------------------------------------------------------------
  // Private — single trigger pipeline
  // ---------------------------------------------------------------------------

  async _processOneTrigger(merchantId, triggerId, triggerPayload, now) {
    // Step 1 — assemble context bundle
    const bundle = merchantRepository.assembleContextBundle(merchantId, triggerId);
    if (!bundle || !bundle.merchant) {
      logger.debug('DecisionEngine: no context bundle for merchant', { merchantId, triggerId });
      return null;
    }

    const { merchant, category, trigger, customer } = bundle;

    // Step 2 — extract signals
    const signals = signalExtractor.extract(merchant, category, trigger || triggerPayload, customer, now);

    // Step 3 — infer observations
    const observations = inferenceEngine.infer(signals, merchant);

    // Step 4 — select strategy candidates
    const context = {
      merchant,
      category: category || {},
      trigger: trigger || triggerPayload || {},
      customer: customer || null,
    };
    const candidates = strategySelector.selectCandidates(context, observations);

    if (candidates.length === 0) {
      logger.debug('DecisionEngine: no strategy candidates', { merchantId, triggerId });
      return null;
    }

    // Step 5 — rank candidates
    const ranked = actionRanker.rank(candidates, observations, merchant, trigger || triggerPayload, merchant.suppressionKeys);
    if (!ranked) return null;

    const { best } = ranked;

    // Step 6 — compose via winning strategy
    let composed;
    try {
      composed = await best.strategyInstance.compose(context);
    } catch (err) {
      logger.warn('DecisionEngine: compose failed', { strategy: best.strategy, error: err.message });
      return null;
    }

    // Step 7 — suppression check
    const suppression = suppressionEngine.check(composed, merchant, this._sessionKeys);
    if (suppression.suppressed) {
      logger.debug('DecisionEngine: action suppressed', { merchantId, triggerId, reason: suppression.reason });
      return null;
    }
    suppressionEngine.markUsed(composed.suppression_key, this._sessionKeys);

    // Step 8 — finalise via MessageComposer
    const final = messageComposer.finalise(composed, merchant, trigger || triggerPayload, category, observations, ranked);

    // Build the ActionItem shape expected by the judge contract
    const conversationId = generateConversationId(merchantId, triggerId);

    // Register the conversation in ConversationStore
    if (!this.conversationStore.get(conversationId)) {
      this.conversationStore.create({
        conversationId,
        merchantId,
        customerId: customer && customer.customer_id || null,
        triggerId,
        sendAs: 'vera',
      });
    }

    // Update merchant's last decision
    const m = memoryStore.getMerchant(merchantId);
    if (m) m.lastDecision = { ...final, decidedAt: new Date().toISOString() };

    logger.info('DecisionEngine: action produced', {
      merchantId,
      triggerId,
      strategy: best.strategy,
      confidence: final.confidence,
      cta: final.cta,
    });

    return {
      conversation_id: conversationId,
      merchant_id: merchantId,
      customer_id: customer && customer.customer_id || null,
      send_as: 'vera',
      trigger_id: triggerId,
      template_name: `vera_${best.strategy}_v1`,
      template_params: this._extractTemplateParams(final.message, merchant),
      body: final.message,
      cta: final.cta,
      suppression_key: final.suppression_key,
      rationale: final.reason,
    };
  }

  /**
   * Extracts up to 3 key values from a message for template_params.
   * Used by the judge for structured replay analysis.
   *
   * @param {string} message
   * @param {object} merchant
   * @returns {string[]}
   */
  _extractTemplateParams(message, merchant) {
    const params = [];
    const name = merchant.identity && merchant.identity.name;
    if (name) params.push(name);

    const ctrStr = merchant.metrics && merchant.metrics.currentCtr !== null
      ? `${(merchant.metrics.currentCtr * 100).toFixed(1)}%`
      : null;
    if (ctrStr) params.push(ctrStr);

    const offers = merchant.offers || [];
    const offerTitle = offers[0] && offers[0].title;
    if (offerTitle) params.push(offerTitle);

    return params.slice(0, 3);
  }
}

module.exports = DecisionEngine;

/**
 * @typedef {object} ActionItem
 * @property {string}      conversation_id
 * @property {string}      merchant_id
 * @property {string|null} customer_id
 * @property {string}      send_as
 * @property {string}      trigger_id
 * @property {string}      template_name
 * @property {string[]}    template_params
 * @property {string}      body
 * @property {string}      cta
 * @property {string}      suppression_key
 * @property {string}      rationale
 */
