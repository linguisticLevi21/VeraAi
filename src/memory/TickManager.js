'use strict';

const memoryStore = require('./MemoryStore');
const stateManager = require('./StateManager');
const logger = require('../utils/logger');

/**
 * TickManager — manages tick history, metric deltas, and merchant state refresh.
 *
 * Each call to POST /v1/tick runs through this manager. It:
 *   1. Appends a tick record to every affected merchant's tickHistory
 *   2. Calculates deltas between the current tick and the previous tick
 *   3. Updates merchant analytics (tick count, last activity)
 *   4. Re-evaluates merchant state via StateManager
 *   5. Stores any active triggers associated with this tick on each merchant
 *
 * Tick records are append-only — previous ticks are never overwritten.
 */
class TickManager {
  // ---------------------------------------------------------------------------
  // Process a tick
  // ---------------------------------------------------------------------------

  /**
   * Records a tick event for all merchants referenced by the active triggers.
   *
   * @param {object}   params
   * @param {string}   params.now                - Simulated current time (ISO-8601)
   * @param {string[]} params.activeTriggerIds   - Trigger IDs the judge considers active
   * @param {Array<{merchantId: string, triggerId: string, payload: object}>} params.resolvedTriggers
   *   - Triggers already resolved to (merchantId, triggerId, payload) by MerchantRepository
   * @param {object}   [params.log]
   */
  processTick({ now, activeTriggerIds, resolvedTriggers, log = logger }) {
    const realNow = new Date().toISOString();

    for (const { merchantId, triggerId, payload } of resolvedTriggers) {
      const m = memoryStore.getMerchant(merchantId);
      if (!m) continue;

      const previousTick = m.tickHistory[m.tickHistory.length - 1] || null;

      // Calculate performance deltas from last tick to now
      const deltas = this._calculateDeltas(m.performance, previousTick);

      // Append the new tick record (never overwrites previous)
      const tickRecord = {
        tickIndex: m.tickHistory.length,
        simulatedAt: now,
        recordedAt: realNow,
        activeTriggerIds: [...activeTriggerIds],
        resolvedTriggerId: triggerId,
        triggerPayload: { ...payload },
        deltas,
        merchantState: m.merchantState,
        performanceSnapshot: m.performance ? { ...m.performance } : null,
      };

      m.tickHistory.push(tickRecord);

      // Update analytics
      m.analytics.tickCount++;
      m.analytics.lastActivity = realNow;
      m.metadata.tickCount++;
      m.timestamps.lastTickAt = realNow;
      if (!m.timestamps.firstTickAt) m.timestamps.firstTickAt = realNow;
      m.lastUpdated = realNow;

      log.debug('TickManager: tick recorded', {
        merchantId,
        triggerId,
        tickIndex: tickRecord.tickIndex,
        newState: m.merchantState,
      });
    }

    // Also tick merchants with no triggers (to update their state + analytics)
    this._tickIdleMerchants(now, realNow, activeTriggerIds, resolvedTriggers, log);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the last tick record for a given merchant, or null.
   *
   * @param {string} merchantId
   * @returns {object | null}
   */
  getLastTick(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    if (!m || m.tickHistory.length === 0) return null;
    return { ...m.tickHistory[m.tickHistory.length - 1] };
  }

  /**
   * Returns the full tick history for a merchant.
   *
   * @param {string} merchantId
   * @returns {object[]}
   */
  getTickHistory(merchantId) {
    const m = memoryStore.getMerchant(merchantId);
    return m ? [...m.tickHistory] : [];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Calculates numeric deltas between the current performance snapshot
   * and the performance at the previous tick.
   *
   * @param {object|null} currentPerf
   * @param {object|null} previousTick
   * @returns {object}
   */
  _calculateDeltas(currentPerf, previousTick) {
    if (!currentPerf || !previousTick || !previousTick.performanceSnapshot) {
      return { views: null, calls: null, directions: null, ctr: null };
    }

    const prev = previousTick.performanceSnapshot;
    return {
      views: this._delta(currentPerf.views, prev.views),
      calls: this._delta(currentPerf.calls, prev.calls),
      directions: this._delta(currentPerf.directions, prev.directions),
      ctr: this._delta(currentPerf.ctr, prev.ctr),
    };
  }

  /**
   * Computes an absolute delta, returns null if either value is missing.
   *
   * @param {number|undefined} current
   * @param {number|undefined} previous
   * @returns {number | null}
   */
  _delta(current, previous) {
    if (current === undefined || current === null) return null;
    if (previous === undefined || previous === null) return null;
    return current - previous;
  }

  /**
   * Records a minimal tick record for merchants that had no triggers this cycle.
   * This keeps all merchant analytics current even in idle ticks.
   *
   * @param {string}   simulatedAt
   * @param {string}   realNow
   * @param {string[]} activeTriggerIds
   * @param {Array}    resolvedTriggers
   * @param {object}   log
   */
  _tickIdleMerchants(simulatedAt, realNow, activeTriggerIds, resolvedTriggers, log) {
    const activeMerchantIds = new Set(resolvedTriggers.map((t) => t.merchantId));

    for (const merchantId of memoryStore.allMerchantIds()) {
      if (activeMerchantIds.has(merchantId)) continue;

      const m = memoryStore.getMerchant(merchantId);
      if (!m) continue;

      m.analytics.tickCount++;
      m.analytics.lastActivity = realNow;
      m.metadata.tickCount++;
      m.timestamps.lastTickAt = realNow;
      if (!m.timestamps.firstTickAt) m.timestamps.firstTickAt = realNow;
      m.lastUpdated = realNow;
    }
  }
}

// Singleton export
module.exports = new TickManager();
