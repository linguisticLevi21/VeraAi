'use strict';

/**
 * DecisionEngine — placeholder interface.
 *
 * The Decision Engine is the core AI reasoning layer. It will be implemented
 * in a future iteration. Its responsibility is:
 *
 *   1. Given a set of active triggers from the judge's /v1/tick call,
 *      rank and select the best trigger(s) to act on per merchant.
 *   2. For each selected (merchant, trigger) pair, assemble the 4-context
 *      bundle (category, merchant, trigger, customer?) from the ContextStore.
 *   3. Delegate message composition to the MessageComposer service.
 *   4. Return a list of action objects ready to be returned in the tick response.
 *
 * Design constraints:
 *   - Must return within 30 seconds (judge SLA).
 *   - Must not send more than MAX_ACTIONS_PER_TICK actions.
 *   - Must respect suppression keys to avoid duplicate sends.
 *
 * @class DecisionEngine
 */
class DecisionEngine {
  /**
   * @param {import('../memory/contextStore')} contextStore
   * @param {import('../memory/conversationStore')} conversationStore
   */
  constructor(contextStore, conversationStore) {
    this.contextStore = contextStore;
    this.conversationStore = conversationStore;
  }

  /**
   * Evaluates available triggers and produces a list of proactive actions.
   *
   * @param {object} params
   * @param {string}   params.now               - Simulated current time (ISO-8601)
   * @param {string[]} params.availableTriggers  - Trigger context IDs from the judge
   * @returns {Promise<ActionItem[]>}
   */
  async evaluateTick({ now, availableTriggers }) {
    // Will be implemented in the AI reasoning phase.
    return [];
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
