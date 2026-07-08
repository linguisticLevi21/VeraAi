'use strict';

const contextStore = require('../memory/contextStore');
const conversationStore = require('../memory/conversationStore');
const merchantRepository = require('../memory/MerchantRepository');
const conversationManager = require('../memory/ConversationManager');
const analyticsManager = require('../memory/AnalyticsManager');
const ReplyEngine = require('../engine/ReplyEngine');
const logger = require('../utils/logger');

const engine = new ReplyEngine(contextStore, conversationStore);

/**
 * ReplyService — business logic for POST /v1/reply.
 *
 * Sequence on each reply:
 *   1. Resolve merchant memory from MerchantRepository (loads full context).
 *   2. Ensure the conversation exists in ConversationStore (stub if needed).
 *   3. Record the inbound message in ConversationManager (updates merchant-level history).
 *   4. Detect auto-reply and intent signals from ConversationManager.
 *   5. Delegate to ReplyEngine — full 8-step AI reasoning pipeline:
 *        Signal extraction → Inference → ReplayGuard → Strategy selection →
 *        Ranking → Composition → Suppression → MessageComposer → FinalAction.
 *   6. If action='send', record the outbound message in ConversationManager.
 *   7. Update reply analytics (Welford rolling-average latency).
 *   8. Persist conversation state transitions in ConversationStore.
 *
 * @param {object}      params
 * @param {string}      params.conversationId
 * @param {string|null} params.merchantId
 * @param {string|null} params.customerId
 * @param {string}      params.fromRole
 * @param {string}      params.message
 * @param {string}      params.receivedAt
 * @param {number}      params.turnNumber
 * @param {object}      [params.log]
 * @returns {Promise<import('../engine/ReplyEngine').ReplyAction>}
 */
async function processReply({
  conversationId,
  merchantId,
  customerId,
  fromRole,
  message,
  receivedAt,
  turnNumber,
  log = logger,
}) {
  const replyReceivedAt = Date.now();
  log.info('ReplyService: processing reply', { conversationId, fromRole, turnNumber, merchantId });

  // Step 1 — load merchant memory
  const merchantMemory = merchantId ? merchantRepository.getMerchant(merchantId) : null;

  if (merchantId && !merchantMemory) {
    log.warn('ReplyService: reply for unknown merchant — memory will be initialised on-demand', {
      merchantId,
      conversationId,
    });
  }

  // Step 2 — ensure ConversationStore entry exists
  let conv = conversationStore.get(conversationId);
  if (!conv) {
    log.warn('ReplyService: unknown conversation — creating stub', { conversationId, merchantId });
    conv = conversationStore.create({
      conversationId,
      merchantId: merchantId || 'unknown',
      customerId,
      triggerId: 'unknown',
      sendAs: 'vera',
    });
  }

  // Step 3 — record inbound message in ConversationStore
  conversationStore.appendTurn(conversationId, {
    from: fromRole,
    body: message,
    turn_number: turnNumber,
    received_at: receivedAt,
  });

  // Step 4 — record inbound in merchant-level ConversationManager
  const { isAutoReply, consecutiveAutoReplies } = merchantId
    ? conversationManager.recordInbound({
        merchantId,
        conversationId,
        speaker: fromRole,
        body: message,
        turnNumber,
        receivedAt,
        log,
      })
    : { isAutoReply: false, consecutiveAutoReplies: 0 };

  log.debug('ReplyService: inbound recorded', {
    conversationId,
    merchantId,
    isAutoReply,
    consecutiveAutoReplies,
  });

  // Step 5 — delegate to ReplyEngine
  const replyAction = await engine.handleReply({
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
  });

  // Step 6 — record outbound if action is 'send'
  if (replyAction.action === 'send' && replyAction.body && merchantId) {
    conversationStore.appendTurn(conversationId, {
      from: 'vera',
      body: replyAction.body,
      cta: replyAction.cta,
      turn_number: turnNumber + 1,
    });

    conversationManager.recordOutbound({
      merchantId,
      conversationId,
      body: replyAction.body,
      cta: replyAction.cta || null,
      rationale: replyAction.rationale,
      triggerId: conv.triggerId,
      strategy: replyAction.strategy || null,
      suppression_key: replyAction.suppression_key || null,
      log,
    });
  }

  // Step 7 — update analytics (latency from message receipt to now)
  if (merchantId) {
    const latencyMs = Date.now() - replyReceivedAt;
    analyticsManager.recordReply(merchantId, latencyMs);
  }

  // Step 8 — persist conversation state transitions
  if (replyAction.action === 'end') {
    conversationStore.setState(conversationId, 'ended');
  } else if (replyAction.action === 'wait') {
    const waitSeconds = replyAction.wait_seconds || 1800;
    const waitUntil = new Date(Date.now() + waitSeconds * 1000);
    conversationStore.setState(conversationId, 'waiting', waitUntil);
  }

  log.info('ReplyService: reply processed', {
    conversationId,
    merchantId,
    action: replyAction.action,
    turnNumber,
    isAutoReply,
  });

  return replyAction;
}

module.exports = { processReply };
