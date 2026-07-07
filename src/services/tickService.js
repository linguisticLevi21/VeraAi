'use strict';

const contextStore = require('../memory/contextStore');
const conversationStore = require('../memory/conversationStore');
const merchantRepository = require('../memory/MerchantRepository');
const tickManager = require('../memory/TickManager');
const analyticsManager = require('../memory/AnalyticsManager');
const DecisionEngine = require('../engine/DecisionEngine');
const { MAX_ACTIONS_PER_TICK } = require('../config/constants');
const logger = require('../utils/logger');

const engine = new DecisionEngine(contextStore, conversationStore);

/**
 * TickService — business logic for POST /v1/tick.
 *
 * Sequence on each tick:
 *   1. Resolve active trigger IDs to (merchantId, triggerId, payload) tuples
 *      using MerchantRepository.
 *   2. Run TickManager to append tick records, calculate deltas, and
 *      update analytics for all affected merchants.
 *   3. Record a tick analytics event for every resolved merchant.
 *   4. Delegate to DecisionEngine for action generation (currently returns []).
 *   5. Cap actions at MAX_ACTIONS_PER_TICK and return.
 *
 * @param {object}   params
 * @param {string}   params.now               - Simulated current time (ISO-8601)
 * @param {string[]} params.availableTriggers  - Trigger context IDs marked active by the judge
 * @param {object}   [params.log]
 * @returns {Promise<{ actions: import('../engine/DecisionEngine').ActionItem[] }>}
 */
async function processTick({ now, availableTriggers, log = logger }) {
  log.info('TickService: processing tick', { now, triggerCount: availableTriggers.length });

  // Step 1 — resolve triggers to merchant context
  const resolvedTriggers = merchantRepository.resolveActiveTriggers(availableTriggers);

  log.debug('TickService: resolved triggers', {
    requested: availableTriggers.length,
    resolved: resolvedTriggers.length,
  });

  // Step 2 — record tick in merchant memory
  tickManager.processTick({
    now,
    activeTriggerIds: availableTriggers,
    resolvedTriggers,
    log,
  });

  // Step 3 — update per-merchant tick analytics
  const seenMerchants = new Set();
  for (const { merchantId } of resolvedTriggers) {
    if (!seenMerchants.has(merchantId)) {
      analyticsManager.recordTick(merchantId);
      seenMerchants.add(merchantId);
    }
  }

  // Step 4 — DecisionEngine (currently a placeholder returning [])
  const actions = await engine.evaluateTick({ now, availableTriggers });

  // Step 5 — enforce cap
  const capped = actions.slice(0, MAX_ACTIONS_PER_TICK);

  if (actions.length > MAX_ACTIONS_PER_TICK) {
    log.warn('TickService: actions capped', {
      total: actions.length,
      cap: MAX_ACTIONS_PER_TICK,
      dropped: actions.length - MAX_ACTIONS_PER_TICK,
    });
  }

  log.info('TickService: tick complete', {
    resolvedTriggers: resolvedTriggers.length,
    actionsProduced: capped.length,
  });

  return { actions: capped };
}

module.exports = { processTick };
