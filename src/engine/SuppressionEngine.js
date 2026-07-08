'use strict';

/**
 * SuppressionEngine — prevents repetitive or duplicate messages.
 *
 * Checks a candidate action against merchant memory and session-level key set.
 *
 * Suppression rules (in priority order):
 *   1. Exact suppression key match — same key already sent this session
 *   2. Exact key match in merchant suppressionKeys memory (last sent key)
 *   3. Same strategy sent < 6h ago
 *   4. Identical CTA sent in last 2 conversation turns from Vera
 *   5. Conversation loop detected — same suppression key in last 3 Vera messages
 *      This catches cases where strategy rotation has stalled.
 *   6. Identical message body sent in last 3 Vera messages (body-level dedup)
 */
class SuppressionEngine {
  /**
   * Checks whether a candidate action should be suppressed.
   *
   * @param {object}       composed      — composed message from a strategy
   * @param {object}       merchant      — MerchantMemory
   * @param {Set<string>}  sessionKeys   — keys already sent this tick session
   * @returns {{ suppressed: boolean, reason: string | null }}
   */
  check(composed, merchant, sessionKeys) {
    const key = composed.suppression_key;
    const strategy = composed.strategy;
    const cta = composed.cta;
    const body = composed.body || '';
    const suppressionKeys = merchant.suppressionKeys || {};
    const replyHistory = merchant.replyHistory || [];
    const history = merchant.conversationHistory || [];

    // ── Rule 1: Exact key in session ──────────────────────────────────────
    if (key && sessionKeys.has(key)) {
      return { suppressed: true, reason: `exact_key_session:${key}` };
    }

    // ── Rule 2: Exact key in merchant memory ───────────────────────────────
    // lastKey stores the suppression_key of the last outbound message (not triggerId)
    if (key && suppressionKeys.lastKey === key) {
      return { suppressed: true, reason: `exact_key_memory:${key}` };
    }

    // ── Rule 3: Same strategy sent < 6h ago ──────────────────────────────
    const lastWithStrategy = [...replyHistory].reverse().find((r) => r.strategy === strategy);
    if (lastWithStrategy) {
      const hoursAgo = (Date.now() - new Date(lastWithStrategy.sentAt || 0).getTime()) / 3_600_000;
      if (hoursAgo < 6) {
        return { suppressed: true, reason: `strategy_too_recent:${strategy}:${hoursAgo.toFixed(1)}h` };
      }
    }

    // ── Rule 4: Same CTA repeated in last 2 Vera turns ───────────────────
    const veraMessages = history.filter((m) => m.speaker === 'vera').slice(-2);
    const ctaCount = veraMessages.filter((m) => m.cta === cta).length;
    if (ctaCount >= 2 && cta !== 'none') {
      return { suppressed: true, reason: `cta_repeated:${cta}` };
    }

    // ── Rule 5: Conversation loop — same suppression key in last 3 Vera ──
    // This catches strategy stagnation where the same action fires repeatedly.
    const last3VeraKeys = history
      .filter((m) => m.speaker === 'vera' && m.suppression_key)
      .slice(-3)
      .map((m) => m.suppression_key);

    if (key && last3VeraKeys.length >= 2 && last3VeraKeys.every((k) => k === key)) {
      return { suppressed: true, reason: `loop_detected:${key}` };
    }

    // ── Rule 6: Same body text in last 3 Vera messages (exact dedup) ─────
    const last3VeraBodies = history
      .filter((m) => m.speaker === 'vera' && m.body)
      .slice(-3)
      .map((m) => m.body);

    if (body && last3VeraBodies.length >= 2 && last3VeraBodies.slice(-2).every((b) => b === body)) {
      return { suppressed: true, reason: `body_repeated:exact_duplicate` };
    }

    return { suppressed: false, reason: null };
  }

  /**
   * Marks a suppression key as used in the session set.
   *
   * @param {string}       key
   * @param {Set<string>}  sessionKeys
   */
  markUsed(key, sessionKeys) {
    if (key) sessionKeys.add(key);
  }
}

// Singleton export
module.exports = new SuppressionEngine();
