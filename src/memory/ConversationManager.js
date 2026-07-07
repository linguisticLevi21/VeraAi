'use strict';

const memoryStore = require('./MemoryStore');
const stateManager = require('./StateManager');
const { MAX_CONVERSATION_MESSAGES, AUTO_REPLY_THRESHOLD, MERCHANT_STATES } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * ConversationManager — owns all conversation memory operations.
 *
 * Responsibilities:
 *   - Record every inbound and outbound message in the merchant's
 *     conversationHistory (trimmed at MAX_CONVERSATION_MESSAGES)
 *   - Detect auto-replies via consecutive identical messages
 *   - Detect intent transitions (merchant signals readiness to act)
 *   - Update the replyHistory with each bot response
 *   - Force state transitions via StateManager when conversation events occur
 *   - Update suppressionKeys after a message is sent
 *
 * This class works alongside the existing ConversationStore (which tracks
 * turn-level conversation state). ConversationManager adds the *merchant-level*
 * memory dimension: a merchant's cross-conversation history.
 */
class ConversationManager {
  // ---------------------------------------------------------------------------
  // Record messages
  // ---------------------------------------------------------------------------

  /**
   * Records an inbound message from a merchant or customer.
   *
   * @param {object} params
   * @param {string}      params.merchantId
   * @param {string}      params.conversationId
   * @param {string}      params.speaker       - 'merchant' | 'customer'
   * @param {string}      params.body
   * @param {number}      params.turnNumber
   * @param {string}      params.receivedAt
   * @param {object}      [params.log]
   * @returns {{ isAutoReply: boolean, consecutiveAutoReplies: number }}
   */
  recordInbound({ merchantId, conversationId, speaker, body, turnNumber, receivedAt, log = logger }) {
    const m = memoryStore.getOrCreate(merchantId);

    const isAutoReply = this._detectAutoReply(m, body);
    const consecutiveAutoReplies = this._updateAutoReplyCounter(m, body, isAutoReply);

    memoryStore.storeConversation(merchantId, {
      conversationId,
      speaker,
      body,
      turnNumber,
      receivedAt,
      intent: this._inferIntent(body),
      replyStatus: 'pending',
      isAutoReply,
      timestamp: receivedAt,
    });

    // Update timestamps and analytics
    const now = new Date().toISOString();
    m.analytics.lastActivity = now;
    m.timestamps.lastReplyAt = now;
    if (!m.timestamps.firstReplyAt) m.timestamps.firstReplyAt = now;
    m.metadata.replyCount++;
    m.lastUpdated = now;

    if (isAutoReply && consecutiveAutoReplies >= AUTO_REPLY_THRESHOLD) {
      stateManager.forceTransition(merchantId, MERCHANT_STATES.NEEDS_ATTENTION, 'auto_reply_threshold_reached');
      memoryStore.updateContext(merchantId, { merchantState: MERCHANT_STATES.NEEDS_ATTENTION });
    }

    log.debug('ConversationManager: inbound recorded', {
      merchantId,
      conversationId,
      turnNumber,
      isAutoReply,
      consecutiveAutoReplies,
    });

    return { isAutoReply, consecutiveAutoReplies };
  }

  /**
   * Records an outbound message sent by Vera (or on merchant's behalf).
   *
   * @param {object} params
   * @param {string}      params.merchantId
   * @param {string}      params.conversationId
   * @param {string}      params.body
   * @param {string}      params.cta
   * @param {string}      params.rationale
   * @param {string}      params.triggerId
   * @param {string}      params.strategy
   * @param {object}      [params.log]
   */
  recordOutbound({ merchantId, conversationId, body, cta, rationale, triggerId, strategy, log = logger }) {
    const m = memoryStore.getOrCreate(merchantId);
    const now = new Date().toISOString();

    memoryStore.storeConversation(merchantId, {
      conversationId,
      speaker: 'vera',
      body,
      cta,
      rationale,
      triggerId,
      intent: 'outbound',
      replyStatus: 'pending',
      isAutoReply: false,
      timestamp: now,
    });

    // Update reply history
    m.replyHistory.push({
      conversationId,
      body,
      cta,
      rationale,
      triggerId,
      strategy,
      sentAt: now,
    });

    // Update suppression keys
    m.suppressionKeys.lastTrigger = triggerId || null;
    m.suppressionKeys.lastCta = cta || null;
    m.suppressionKeys.lastStrategy = strategy || null;

    // Update analytics
    m.analytics.replyCount++;
    m.analytics.lastActivity = now;
    m.timestamps.lastReplyAt = now;
    m.metadata.replyCount++;
    m.lastUpdated = now;

    // Transition to WAITING_REPLY
    stateManager.forceTransition(merchantId, MERCHANT_STATES.WAITING_REPLY, 'vera_sent_message');
    memoryStore.updateContext(merchantId, { merchantState: MERCHANT_STATES.WAITING_REPLY });

    log.debug('ConversationManager: outbound recorded', { merchantId, conversationId });
  }

  /**
   * Marks the most recent pending conversation entry as replied.
   * Called after the merchant sends a genuine (non-auto) reply.
   *
   * @param {string} merchantId
   * @param {string} conversationId
   */
  markReplied(merchantId, conversationId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return;

    for (let i = m.conversationHistory.length - 1; i >= 0; i--) {
      const entry = m.conversationHistory[i];
      if (entry.conversationId === conversationId && entry.replyStatus === 'pending') {
        entry.replyStatus = 'replied';
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the last N messages from a merchant's conversation history.
   *
   * @param {string} merchantId
   * @param {number} [n=10]
   * @returns {object[]}
   */
  getRecentMessages(merchantId, n = 10) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return [];
    return m.conversationHistory.slice(-n);
  }

  /**
   * Returns the number of messages currently stored for a merchant.
   *
   * @param {string} merchantId
   * @returns {number}
   */
  getMessageCount(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    return m ? m.conversationHistory.length : 0;
  }

  /**
   * Returns the current consecutive auto-reply count for a merchant.
   *
   * @param {string} merchantId
   * @returns {number}
   */
  getAutoReplyCount(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    return m ? (m._autoReplyConsecutive || 0) : 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detects whether a message body matches the merchant's most recent message
   * (i.e., it is a canned WhatsApp auto-reply being repeated).
   *
   * @param {MerchantMemory} m
   * @param {string} body
   * @returns {boolean}
   */
  _detectAutoReply(m, body) {
    if (!body || body.trim().length === 0) return false;
    const normalised = body.trim().toLowerCase();

    // Check the last AUTO_REPLY_THRESHOLD messages from this merchant
    const recent = m.conversationHistory
      .filter((msg) => msg.speaker === 'merchant')
      .slice(-AUTO_REPLY_THRESHOLD);

    if (recent.length < 2) return false;

    // Identical to all recent merchant messages → auto-reply
    return recent.every((msg) => msg.body.trim().toLowerCase() === normalised);
  }

  /**
   * Updates the merchant's internal consecutive auto-reply counter.
   * Returns the current count after update.
   *
   * @param {MerchantMemory} m
   * @param {string} body
   * @param {boolean} isAutoReply
   * @returns {number}
   */
  _updateAutoReplyCounter(m, body, isAutoReply) {
    if (isAutoReply) {
      m._autoReplyConsecutive = (m._autoReplyConsecutive || 0) + 1;
    } else {
      m._autoReplyConsecutive = 0;
    }
    return m._autoReplyConsecutive;
  }

  /**
   * Infers a high-level intent label from a merchant's message body.
   * These labels feed into the reply classification logic.
   *
   * @param {string} body
   * @returns {string}
   */
  _inferIntent(body) {
    if (!body) return 'unknown';
    const lower = body.toLowerCase();

    if (/yes|haan|haa|ok|okay|sure|bilkul|chalega|chalo|proceed|go ahead|let's do|karo/.test(lower)) {
      return 'affirmative';
    }
    if (/no|nahi|nope|stop|band karo|mat karo|not interested|bandh|nope/.test(lower)) {
      return 'negative';
    }
    if (/join|judrna|subscribe|add me|sign me|register/.test(lower)) {
      return 'intent_join';
    }
    if (/\?|what|how|kya|kaise|kyun|when|kab|where|kahan|bata/.test(lower)) {
      return 'question';
    }
    if (/thank|shukriya|dhanyavad|thanks/.test(lower)) {
      return 'gratitude';
    }

    return 'informational';
  }
}

// Singleton export
module.exports = new ConversationManager();

/**
 * @typedef {import('./MemoryStore').MerchantMemory} MerchantMemory
 */
