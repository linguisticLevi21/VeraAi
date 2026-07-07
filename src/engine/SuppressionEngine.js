'use strict';

/**
 * SuppressionEngine — prevents repetitive or duplicate messages.
 *
 * Checks a candidate action against the merchant's suppressionKeys memory
 * and a global session-level key set. Returns whether the action should be
 * suppressed and the reason.
 *
 * Suppression rules (in priority order):
 *   1. Exact suppression key match — same key already sent this session
 *   2. Same strategy sent < 6h ago
 *   3. Same CTA sent in last 2 turns
 *   4. Same trigger sent to same merchant in last 24h
 */
class SuppressionEngine {
  /**
   * Checks whether a candidate action should be suppressed.
   *
   * @param {object} composed          — composed message from a strategy
   * @param {object} merchant          — MerchantMemory
   * @param {Set<string>} sessionKeys  — keys already sent this tick session
   * @returns {{ suppressed: boolean, reason: string | null }}
   */
  check(composed, merchant, sessionKeys) {
    const key = composed.suppression_key;
    const strategy = composed.strategy;
    const cta = composed.cta;
    const suppressionKeys = merchant.suppressionKeys || {};
    const replyHistory = merchant.replyHistory || [];

    // 1. Exact key match in session
    if (key && sessionKeys.has(key)) {
      return { suppressed: true, reason: `exact_key_session:${key}` };
    }

    // 2. Exact key match in merchant suppression memory
    if (key && suppressionKeys.lastTrigger === key) {
      return { suppressed: true, reason: `exact_key_memory:${key}` };
    }

    // 3. Same strategy used < 6h ago
    const lastWithStrategy = [...replyHistory].reverse().find((r) => r.strategy === strategy);
    if (lastWithStrategy) {
      const hoursAgo = (Date.now() - new Date(lastWithStrategy.sentAt).getTime()) / 3_600_000;
      if (hoursAgo < 6) {
        return { suppressed: true, reason: `strategy_too_recent:${strategy}:${hoursAgo.toFixed(1)}h` };
      }
    }

    // 4. Identical CTA sent in last 2 conversation turns from Vera
    const veraMessages = (merchant.conversationHistory || [])
      .filter((m) => m.speaker === 'vera')
      .slice(-2);
    const ctaCount = veraMessages.filter((m) => m.cta === cta).length;
    if (ctaCount >= 2 && cta !== 'none') {
      return { suppressed: true, reason: `cta_repeated:${cta}` };
    }

    // Not suppressed
    return { suppressed: false, reason: null };
  }

  /**
   * Marks a suppression key as used in the session set.
   *
   * @param {string} key
   * @param {Set<string>} sessionKeys
   */
  markUsed(key, sessionKeys) {
    if (key) sessionKeys.add(key);
  }
}

// Singleton export
module.exports = new SuppressionEngine();
