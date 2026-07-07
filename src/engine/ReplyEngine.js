'use strict';

/**
 * ReplyEngine — placeholder interface.
 *
 * The Reply Engine is the multi-turn conversation handler. It will be
 * implemented in a future iteration. Its responsibility is:
 *
 *   1. Receive the merchant/customer reply delivered by the judge.
 *   2. Resolve the conversation state from ConversationStore.
 *   3. Classify the reply intent:
 *      - Genuine engaged reply     → produce next send action
 *      - Auto-reply (canned text)  → increment counter; exit if threshold reached
 *      - Intent transition         → switch strategy (pitch → action)
 *      - Hard refusal / opt-out    → graceful end
 *      - Off-topic / curveball     → stay on-mission, redirect politely
 *   4. Return one of: { action: "send" }, { action: "wait" }, { action: "end" }
 *
 * @class ReplyEngine
 */
class ReplyEngine {
  /**
   * @param {import('../memory/contextStore')} contextStore
   * @param {import('../memory/conversationStore')} conversationStore
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
   * @param {string}      params.fromRole      - "merchant" | "customer"
   * @param {string}      params.message
   * @param {string}      params.receivedAt    - ISO-8601
   * @param {number}      params.turnNumber
   * @returns {Promise<ReplyAction>}
   */
  async handleReply({ conversationId, merchantId, customerId, fromRole, message, receivedAt, turnNumber }) {
    // Will be implemented in the AI reasoning phase.
    return {
      action: 'end',
      rationale: 'Reply engine not yet implemented. Gracefully ending conversation.',
    };
  }
}

module.exports = ReplyEngine;

/**
 * @typedef {object} ReplyAction
 * @property {'send'|'wait'|'end'} action
 * @property {string}   [body]           - Present when action === 'send'
 * @property {string}   [cta]            - Present when action === 'send'
 * @property {number}   [wait_seconds]   - Present when action === 'wait'
 * @property {string}   rationale
 */
