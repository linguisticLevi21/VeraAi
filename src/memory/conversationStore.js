'use strict';

const logger = require('../utils/logger');
const { MAX_TURNS_PER_CONVERSATION } = require('../config/constants');

/**
 * ConversationStore — in-memory store for all active conversation states.
 *
 * Each conversation tracks:
 *   - The full turn history (both Vera and merchant/customer turns)
 *   - The current conversation state (active | waiting | ended)
 *   - Auto-reply detection counters
 *   - Timestamps for wait/back-off logic
 *
 * The Decision Engine and Reply Handler will read and mutate conversations
 * through this store. No persistence layer — memory is sufficient per spec.
 */
class ConversationStore {
  constructor() {
    /** @type {Map<string, ConversationEntry>} */
    this._conversations = new Map();
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Creates a new conversation entry.
   *
   * @param {object} params
   * @param {string} params.conversationId
   * @param {string} params.merchantId
   * @param {string|null} params.customerId
   * @param {string} params.triggerId
   * @param {string} params.sendAs - "vera" | "merchant_on_behalf"
   * @returns {ConversationEntry}
   */
  create({ conversationId, merchantId, customerId = null, triggerId, sendAs }) {
    if (this._conversations.has(conversationId)) {
      throw new Error(`Conversation already exists: ${conversationId}`);
    }

    const entry = {
      conversationId,
      merchantId,
      customerId,
      triggerId,
      sendAs,
      state: 'active',
      turns: [],
      autoReplyCount: 0,
      consecutiveAutoReplies: 0,
      waitUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._conversations.set(conversationId, entry);
    logger.debug('Conversation created', { conversationId, merchantId, triggerId });
    return entry;
  }

  /**
   * Appends a turn to an existing conversation.
   *
   * @param {string} conversationId
   * @param {{ from: string, body: string, action?: string, rationale?: string }} turn
   * @returns {ConversationEntry}
   */
  appendTurn(conversationId, turn) {
    const conv = this._getOrThrow(conversationId);
    conv.turns.push({ ...turn, timestamp: new Date().toISOString() });
    conv.updatedAt = new Date().toISOString();
    return conv;
  }

  /**
   * Updates the state of a conversation.
   *
   * @param {string} conversationId
   * @param {'active'|'waiting'|'ended'} state
   * @param {Date|null} [waitUntil] - Only relevant when state is 'waiting'
   */
  setState(conversationId, state, waitUntil = null) {
    const conv = this._getOrThrow(conversationId);
    conv.state = state;
    conv.waitUntil = waitUntil ? waitUntil.toISOString() : null;
    conv.updatedAt = new Date().toISOString();
    logger.debug('Conversation state changed', { conversationId, state });
  }

  /**
   * Increments the auto-reply counter for a conversation.
   *
   * @param {string} conversationId
   * @returns {number} The new consecutive auto-reply count
   */
  incrementAutoReply(conversationId) {
    const conv = this._getOrThrow(conversationId);
    conv.autoReplyCount++;
    conv.consecutiveAutoReplies++;
    conv.updatedAt = new Date().toISOString();
    return conv.consecutiveAutoReplies;
  }

  /**
   * Resets the consecutive auto-reply counter (called on a genuine merchant message).
   *
   * @param {string} conversationId
   */
  resetAutoReply(conversationId) {
    const conv = this._getOrThrow(conversationId);
    conv.consecutiveAutoReplies = 0;
    conv.updatedAt = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the full conversation entry, or null.
   *
   * @param {string} conversationId
   * @returns {ConversationEntry | null}
   */
  get(conversationId) {
    return this._conversations.get(conversationId) || null;
  }

  /**
   * Returns true if the conversation has reached the maximum turn limit.
   *
   * @param {string} conversationId
   * @returns {boolean}
   */
  isExhausted(conversationId) {
    const conv = this.get(conversationId);
    return conv ? conv.turns.length >= MAX_TURNS_PER_CONVERSATION : false;
  }

  /**
   * Returns all active (non-ended) conversations.
   *
   * @returns {ConversationEntry[]}
   */
  getActive() {
    return Array.from(this._conversations.values()).filter((c) => c.state !== 'ended');
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  /**
   * Wipes all conversation state.
   */
  clear() {
    const count = this._conversations.size;
    this._conversations.clear();
    logger.info('ConversationStore cleared', { conversationsWiped: count });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _getOrThrow(conversationId) {
    const conv = this._conversations.get(conversationId);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);
    return conv;
  }
}

// Singleton export
module.exports = new ConversationStore();

/**
 * @typedef {object} ConversationEntry
 * @property {string}   conversationId
 * @property {string}   merchantId
 * @property {string|null} customerId
 * @property {string}   triggerId
 * @property {string}   sendAs
 * @property {'active'|'waiting'|'ended'} state
 * @property {Array}    turns
 * @property {number}   autoReplyCount
 * @property {number}   consecutiveAutoReplies
 * @property {string|null} waitUntil
 * @property {string}   createdAt
 * @property {string}   updatedAt
 */
