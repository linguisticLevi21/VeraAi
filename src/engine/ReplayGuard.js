'use strict';

/**
 * ReplayGuard — handles all cases where the merchant's reply requires a
 * special path instead of normal strategy execution.
 *
 * Handles:
 *   - Merchant ignored (no reply)
 *   - Merchant replied NO / hostile / opt-out
 *   - Merchant replied YES (routes to FollowUpStrategy)
 *   - Auto-reply (canned WhatsApp text)
 *   - Off-topic reply
 *   - Duplicate trigger
 *   - Expired trigger
 *
 * Returns null if no special handling is needed (normal pipeline proceeds).
 */
class ReplayGuard {
  /**
   * Evaluates the current state and determines if special routing is needed.
   *
   * @param {object} params
   * @param {string}      params.message
   * @param {string}      params.fromRole
   * @param {boolean}     params.isAutoReply
   * @param {number}      params.consecutiveAutoReplies
   * @param {object}      params.merchant        - MerchantMemory
   * @param {import('./InferenceEngine').Observation[]} params.observations
   * @param {number}      params.turnNumber
   * @returns {GuardDecision | null}  null = proceed normally
   */
  evaluate({ message, fromRole, isAutoReply, consecutiveAutoReplies, merchant, observations, turnNumber }) {
    const obsSet = new Set(observations.map((o) => o.observation));

    // ── Rule 1: Explicit refusal / negative / hostile ───────────────────────
    if (obsSet.has('merchant_refused')) {
      return {
        action: 'end',
        rationale: 'Merchant has declined — closing conversation gracefully with an open door.',
        body: null,
        guard: 'merchant_refused',
      };
    }

    // ── Rule 2: Auto-reply threshold exceeded ───────────────────────────────
    if (isAutoReply && consecutiveAutoReplies >= 3) {
      return {
        action: 'wait',
        wait_seconds: 7200, // 2h back-off
        rationale: 'WhatsApp auto-reply detected — backing off for 2 hours to avoid spam.',
        guard: 'auto_reply_threshold',
      };
    }

    // ── Rule 3: Single auto-reply — acknowledge and wait ────────────────────
    if (isAutoReply) {
      return {
        action: 'wait',
        wait_seconds: 3600, // 1h
        rationale: 'Auto-reply detected — waiting 1 hour before next outbound.',
        guard: 'auto_reply_single',
      };
    }

    // ── Rule 4: Expired trigger — do not act ───────────────────────────────
    if (obsSet.has('trigger_expired')) {
      return {
        action: 'end',
        rationale: 'The trigger that initiated this conversation has expired. Closing cleanly.',
        body: null,
        guard: 'expired_trigger',
      };
    }

    // ── Rule 5: Conversation exhausted (max turns) ─────────────────────────
    const { MAX_TURNS_PER_CONVERSATION } = require('../config/constants');
    if (turnNumber >= MAX_TURNS_PER_CONVERSATION) {
      return {
        action: 'end',
        rationale: `Conversation has reached max turns (${MAX_TURNS_PER_CONVERSATION}). Closing gracefully.`,
        body: null,
        guard: 'max_turns',
      };
    }

    // ── Rule 6: Merchant stalled > 72h — close unless high value ───────────
    if (obsSet.has('conversation_stalled')) {
      const history = merchant.conversationHistory || [];
      const lastVera = [...history].reverse().find((m) => m.speaker === 'vera');
      if (lastVera) {
        const hoursElapsed = (Date.now() - new Date(lastVera.storedAt || lastVera.timestamp || 0).getTime()) / 3_600_000;
        if (hoursElapsed > 72) {
          return {
            action: 'end',
            rationale: 'Merchant has not replied in 72h. Closing to avoid spam; re-engagement can happen at next relevant trigger.',
            body: null,
            guard: 'stalled_72h',
          };
        }
      }
    }

    // Normal pipeline — no special routing needed
    return null;
  }

  /**
   * Builds an end-action response for a hard refusal.
   * Called externally when a merchant sends a clear opt-out.
   *
   * @param {string} merchantName
   * @returns {object}
   */
  buildGracefulExit(merchantName) {
    return {
      action: 'end',
      body: `Absolutely, ${merchantName || 'there'} — no further messages from us on this. If you ever want to revisit, just reach out. Good luck!`,
      cta: 'none',
      rationale: 'Merchant opted out — closing with an open door.',
    };
  }
}

// Singleton export
module.exports = new ReplayGuard();

/**
 * @typedef {object} GuardDecision
 * @property {'send'|'wait'|'end'} action
 * @property {string|null}  body
 * @property {string}       rationale
 * @property {string}       guard         - which rule fired
 * @property {number}       [wait_seconds]
 */
