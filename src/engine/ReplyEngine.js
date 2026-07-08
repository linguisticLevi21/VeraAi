'use strict';

const signalExtractor = require('./SignalExtractor');
const inferenceEngine = require('./InferenceEngine');
const strategySelector = require('./StrategySelector');
const actionRanker = require('./ActionRanker');
const suppressionEngine = require('./SuppressionEngine');
const replayGuard = require('./ReplayGuard');
const messageComposer = require('./MessageComposer');
const merchantRepository = require('../memory/MerchantRepository');
const memoryStore = require('../memory/MemoryStore');
const logger = require('../utils/logger');

/**
 * ReplyEngine — the full AI reasoning pipeline for POST /v1/reply.
 *
 * Pipeline:
 *   incoming reply
 *     → 1. Signal extraction from merchant memory + message
 *     → 2. Inference (classify this reply in context)
 *     → 3. ReplayGuard (check for hard exits: refusal, auto-reply, max turns)
 *     → 4. Strategy selection
 *     → 5. Action ranking
 *     → 6. Compose via winning strategy
 *     → 7. Suppression check
 *     → 8. MessageComposer → final reply action
 */
class ReplyEngine {
  /**
   * @param {object} contextStore
   * @param {object} conversationStore
   */
  constructor(contextStore, conversationStore) {
    this.contextStore = contextStore;
    this.conversationStore = conversationStore;
  }

  /**
   * Processes an incoming reply and returns the bot's next action.
   *
   * @param {object} params
   * @param {string}      params.conversationId
   * @param {string|null} params.merchantId
   * @param {string|null} params.customerId
   * @param {string}      params.fromRole
   * @param {string}      params.message
   * @param {string}      params.receivedAt
   * @param {number}      params.turnNumber
   * @param {object|null} params.merchantMemory
   * @param {boolean}     params.isAutoReply
   * @param {number}      params.consecutiveAutoReplies
   * @returns {Promise<ReplyAction>}
   */
  async handleReply({
    conversationId,
    merchantId,
    customerId,
    fromRole,
    message,
    receivedAt,
    turnNumber,
    merchantMemory,
    isAutoReply,
    consecutiveAutoReplies,
  }) {
    const now = receivedAt || new Date().toISOString();

    // No merchant — cannot reason; gracefully end
    if (!merchantMemory) {
      logger.warn('ReplyEngine: no merchant memory — ending', { conversationId });
      return { action: 'end', rationale: 'No merchant context available for this conversation.' };
    }

    const merchant = merchantMemory;
    const conv = this.conversationStore.get(conversationId);
    const triggerId = conv && conv.triggerId;

    // Resolve trigger and category context
    const bundle = triggerId && triggerId !== 'unknown'
      ? merchantRepository.assembleContextBundle(merchant.merchantId, triggerId)
      : { merchant, category: merchant.category, trigger: null, customer: null };

    const trigger = (bundle && bundle.trigger) || null;
    const category = (bundle && bundle.category) || merchant.category || null;
    const customer = (bundle && bundle.customer) || null;

    // ── Step 1: Extract signals ──────────────────────────────────────────────
    const signals = signalExtractor.extract(merchant, category, trigger, customer, now);

    // ── Step 2: Infer observations ───────────────────────────────────────────
    const observations = inferenceEngine.infer(signals, merchant);

    // ── Step 3: ReplayGuard ──────────────────────────────────────────────────
    const guardDecision = replayGuard.evaluate({
      message,
      fromRole,
      isAutoReply,
      consecutiveAutoReplies,
      merchant,
      observations,
      turnNumber,
      now,
    });

    if (guardDecision) {
      // Augment with a graceful body for hard refusals
      if (guardDecision.action === 'end' && guardDecision.guard === 'merchant_refused') {
        const name = merchant.identity && merchant.identity.name || 'there';
        const graceful = replayGuard.buildGracefulExit(name);
        return {
          action: graceful.action,
          body: graceful.body,
          cta: graceful.cta,
          rationale: graceful.rationale,
          strategy: 'guard',
        };
      }
      return guardDecision;
    }

    // ── Step 4: Strategy selection ───────────────────────────────────────────
    const context = {
      merchant,
      category: category || {},
      trigger: trigger || {},
      customer: customer || null,
    };
    const candidates = strategySelector.selectCandidates(context, observations);

    if (candidates.length === 0) {
      logger.debug('ReplyEngine: no strategy candidates — waiting', { conversationId });
      return {
        action: 'wait',
        wait_seconds: 3600,
        rationale: 'No applicable strategy for current merchant state. Waiting for next trigger.',
      };
    }

    // ── Step 5: Rank ─────────────────────────────────────────────────────────
    const ranked = actionRanker.rank(candidates, observations, merchant, trigger, merchant.suppressionKeys);
    if (!ranked) {
      return { action: 'wait', wait_seconds: 1800, rationale: 'Ranking produced no winner.' };
    }

    const { best } = ranked;

    // ── Step 6: Compose ──────────────────────────────────────────────────────
    let composed;
    try {
      composed = await best.strategyInstance.compose(context);
    } catch (err) {
      logger.warn('ReplyEngine: compose failed', { strategy: best.strategy, error: err.message });
      return { action: 'wait', wait_seconds: 1800, rationale: 'Composition error — retrying at next tick.' };
    }

    // ── Step 7: Suppression ──────────────────────────────────────────────────
    const sessionKeys = new Set();
    const suppression = suppressionEngine.check(composed, merchant, sessionKeys);
    if (suppression.suppressed) {
      logger.debug('ReplyEngine: action suppressed', { conversationId, reason: suppression.reason });
      return {
        action: 'wait',
        wait_seconds: 3600,
        rationale: `Action suppressed (${suppression.reason}) — backing off.`,
      };
    }

    // ── Step 8: MessageComposer ──────────────────────────────────────────────
    const final = messageComposer.finalise(composed, merchant, trigger, category, observations, ranked);

    // Persist lastDecision on merchant memory
    const m = memoryStore.getMerchant(merchant.merchantId);
    if (m) m.lastDecision = { ...final, decidedAt: new Date().toISOString() };

    logger.info('ReplyEngine: reply action produced', {
      conversationId,
      strategy: best.strategy,
      confidence: final.confidence,
      action: 'send',
    });

    return {
      action: 'send',
      body: final.message,
      cta: final.cta,
      strategy: best.strategy,
      rationale: final.reason,
      confidence: final.confidence,
      merchant_state: final.merchant_state,
      suppression_key: final.suppression_key,
      metadata: final.metadata,
    };
  }
}

module.exports = ReplyEngine;

/**
 * @typedef {object} ReplyAction
 * @property {'send'|'wait'|'end'} action
 * @property {string}   [body]
 * @property {string}   [cta]
 * @property {string}   [strategy]
 * @property {number}   [confidence]
 * @property {number}   [wait_seconds]
 * @property {string}   rationale
 * @property {object}   [metadata]
 */
