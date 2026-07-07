'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Generates a short, URL-safe unique request ID.
 * Format: req_<8-char hex prefix of a UUID v4>
 * This is intentionally compact — it appears in every log line and
 * every response header so brevity matters.
 *
 * @returns {string}  e.g. "req_3f2504e0"
 */
function generateRequestId() {
  return `req_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Generates a unique acknowledgement ID for /v1/context responses.
 *
 * @param {string} contextId
 * @param {number} version
 * @returns {string}  e.g. "ack_m_001_drmeera_v3"
 */
function generateAckId(contextId, version) {
  const safe = contextId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `ack_${safe}_v${version}`;
}

/**
 * Generates a unique conversation ID for new proactive sends.
 *
 * @param {string} merchantId
 * @param {string} triggerId
 * @returns {string}  e.g. "conv_m001_trg001_3f2504e0"
 */
function generateConversationId(merchantId, triggerId) {
  const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
  const m = (merchantId || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const t = (triggerId || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `conv_${m}_${t}_${suffix}`;
}

module.exports = { generateRequestId, generateAckId, generateConversationId };
