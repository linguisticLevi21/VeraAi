'use strict';

const { validateReplyBody } = require('../validators/schemas');
const { processReply } = require('../services/replyService');
const { success } = require('../utils/response');

/**
 * POST /v1/reply
 *
 * Called by the judge with the merchant's (or customer's) reply to a
 * previous bot message. The bot must respond synchronously within 30s.
 *
 * Valid response actions (challenge contract §2.3):
 *
 *   Send:  { action: "send", body, cta, rationale }
 *   Wait:  { action: "wait", wait_seconds, rationale }
 *   End:   { action: "end", rationale }
 */
async function replyHandler(req, res, next) {
  try {
    validateReplyBody(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    const {
      conversation_id,
      merchant_id = null,
      customer_id = null,
      from_role,
      message,
      received_at,
      turn_number,
    } = req.body;

    const replyAction = await processReply({
      conversationId: conversation_id,
      merchantId: merchant_id,
      customerId: customer_id,
      fromRole: from_role,
      message,
      receivedAt: received_at,
      turnNumber: turn_number,
      log: req.log,
    });

    // Enrich observability log
    res.locals.observability.merchantId = merchant_id;
    res.locals.observability.strategy = replyAction.strategy || null;
    res.locals.observability.confidence = replyAction.confidence || null;

    return success(res, replyAction);
  } catch (err) {
    return next(err);
  }
}

module.exports = { replyHandler };
