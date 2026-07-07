'use strict';

const memoryStore = require('./MemoryStore');
const { SERVER_START_TIME } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * AnalyticsManager — computes and persists per-merchant analytics.
 *
 * Tracks:
 *   - replyCount         — total Vera messages sent to this merchant
 *   - tickCount          — total ticks in which this merchant was evaluated
 *   - contextUpdates     — total context pushes accepted for this merchant
 *   - ignoredUpdates     — total context pushes rejected (stale/same version)
 *   - uptimeMs           — server uptime at the time of last activity
 *   - avgResponseLatencyMs — rolling average of bot response times
 *   - lastActivity       — ISO-8601 timestamp of last any-event
 *   - firstSeenAt        — ISO-8601 timestamp of merchant creation
 */
class AnalyticsManager {
  // ---------------------------------------------------------------------------
  // Record events
  // ---------------------------------------------------------------------------

  /**
   * Records that a context push was accepted for a merchant.
   *
   * @param {string} merchantId
   */
  recordContextAccepted(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return;
    m.analytics.contextUpdates++;
    m.analytics.lastActivity = new Date().toISOString();
    m.analytics.uptimeMs = Date.now() - SERVER_START_TIME;
  }

  /**
   * Records that a context push was ignored (stale or same version).
   *
   * @param {string} merchantId
   */
  recordContextIgnored(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return;
    m.analytics.ignoredUpdates++;
  }

  /**
   * Records a tick event for a merchant.
   *
   * @param {string} merchantId
   */
  recordTick(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return;
    m.analytics.tickCount++;
    m.analytics.lastActivity = new Date().toISOString();
    m.analytics.uptimeMs = Date.now() - SERVER_START_TIME;
  }

  /**
   * Records a reply event and updates the rolling average response latency.
   *
   * @param {string} merchantId
   * @param {number} latencyMs - Time from message receipt to reply dispatch
   */
  recordReply(merchantId, latencyMs) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m) return;
    m.analytics.replyCount++;
    m.analytics.lastActivity = new Date().toISOString();
    m.analytics.uptimeMs = Date.now() - SERVER_START_TIME;

    // Rolling average using Welford's online algorithm (no need to store all samples)
    const prev = m.analytics.avgResponseLatencyMs;
    const n = m.analytics.replyCount;
    if (prev === null) {
      m.analytics.avgResponseLatencyMs = latencyMs;
    } else {
      m.analytics.avgResponseLatencyMs = prev + (latencyMs - prev) / n;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the analytics object for a merchant, or null.
   *
   * @param {string} merchantId
   * @returns {import('./MemoryStore').AnalyticsEntry | null}
   */
  getAnalytics(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    return m ? { ...m.analytics } : null;
  }

  /**
   * Returns a global analytics summary across all merchants.
   *
   * @returns {object}
   */
  getGlobalSummary() {
    const allIds = memoryStore.allMerchantIds();
    let totalReplies = 0;
    let totalTicks = 0;
    let totalContextUpdates = 0;
    let totalIgnoredUpdates = 0;

    for (const merchantId of allIds) {
      const m = memoryStore.getMerchant(merchantId);
      if (!m) continue;
      totalReplies += m.analytics.replyCount;
      totalTicks += m.analytics.tickCount;
      totalContextUpdates += m.analytics.contextUpdates;
      totalIgnoredUpdates += m.analytics.ignoredUpdates;
    }

    return {
      merchantCount: allIds.length,
      totalReplies,
      totalTicks,
      totalContextUpdates,
      totalIgnoredUpdates,
      serverUptimeMs: Date.now() - SERVER_START_TIME,
    };
  }
}

// Singleton export
module.exports = new AnalyticsManager();
