'use strict';

const { MERCHANT_STATES, MAX_CONVERSATION_MESSAGES } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * MemoryStore — the canonical in-memory store for per-merchant memory objects.
 *
 * Each merchant gets one isolated MerchantMemory object. The store is keyed
 * by merchantId. All reads and writes go through this class — nothing in the
 * codebase touches the underlying Map directly.
 *
 * MerchantMemory shape (all fields documented below):
 * {
 *   merchantId         string
 *   scope              string           category slug the merchant belongs to
 *   currentVersion     Record<scope, number>
 *   identity           object | null
 *   category           object | null    full CategoryContext payload
 *   performance        object | null
 *   offers             array
 *   campaigns          array
 *   metrics            object
 *   conversationHistory array           capped at MAX_CONVERSATION_MESSAGES
 *   replyHistory       array
 *   customerContexts   Map<customerId, object>
 *   triggerHistory     array
 *   tickHistory        array
 *   analytics          object
 *   lastDecision       object | null
 *   merchantState      string           one of MERCHANT_STATES values
 *   suppressionKeys    object
 *   lastUpdated        string           ISO-8601
 *   timestamps         object
 *   metadata           object
 *   futureReserved     object
 * }
 */
class MemoryStore {
  constructor() {
    /** @type {Map<string, MerchantMemory>} */
    this._merchants = new Map();
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Creates and stores a fresh MerchantMemory entry.
   * Throws if the merchantId already exists (use getMerchant to check first).
   *
   * @param {string} merchantId
   * @param {string} [scope='unknown']
   * @returns {MerchantMemory}
   */
  createMerchant(merchantId, scope = 'unknown') {
    if (this._merchants.has(merchantId)) {
      throw new Error(`Merchant already exists in MemoryStore: ${merchantId}`);
    }

    const now = new Date().toISOString();
    const memory = {
      merchantId,
      scope,
      currentVersion: {},
      identity: null,
      category: null,
      performance: null,
      offers: [],
      campaigns: [],
      metrics: {
        totalViews: 0,
        totalCalls: 0,
        totalDirections: 0,
        currentCtr: null,
        peakCtr: null,
        peerMedianCtr: null,
      },
      conversationHistory: [],
      replyHistory: [],
      customerContexts: new Map(),
      triggerHistory: [],
      tickHistory: [],
      analytics: {
        replyCount: 0,
        tickCount: 0,
        contextUpdates: 0,
        ignoredUpdates: 0,
        uptimeMs: 0,
        avgResponseLatencyMs: null,
        lastActivity: now,
        firstSeenAt: now,
      },
      lastDecision: null,
      merchantState: MERCHANT_STATES.NEW,
      suppressionKeys: {
        lastCta: null,
        lastTrigger: null,
        lastCampaign: null,
        lastHook: null,
        lastStrategy: null,
      },
      lastUpdated: now,
      timestamps: {
        createdAt: now,
        firstContextAt: null,
        firstTickAt: null,
        firstReplyAt: null,
        lastContextAt: null,
        lastTickAt: null,
        lastReplyAt: null,
      },
      metadata: {
        contextPushCount: 0,
        tickCount: 0,
        replyCount: 0,
        versionHistory: [],
      },
      futureReserved: {},
    };

    this._merchants.set(merchantId, memory);
    logger.debug('MemoryStore: merchant created', { merchantId, scope });
    return memory;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Returns the MerchantMemory object, or null.
   *
   * @param {string} merchantId
   * @returns {MerchantMemory | null}
   */
  getMerchant(merchantId) {
    return this._merchants.get(merchantId) || null;
  }

  /**
   * Returns true if a merchant record exists.
   *
   * @param {string} merchantId
   * @returns {boolean}
   */
  merchantExists(merchantId) {
    return this._merchants.has(merchantId);
  }

  /**
   * Removes a merchant record entirely.
   *
   * @param {string} merchantId
   */
  deleteMerchant(merchantId) {
    this._merchants.delete(merchantId);
    logger.debug('MemoryStore: merchant deleted', { merchantId });
  }

  /**
   * Returns or creates the MerchantMemory for the given merchantId.
   * Safe to call unconditionally — creates with scope='unknown' if missing.
   *
   * @param {string} merchantId
   * @param {string} [scope]
   * @returns {MerchantMemory}
   */
  getOrCreate(merchantId, scope) {
    if (!this._merchants.has(merchantId)) {
      return this.createMerchant(merchantId, scope || 'unknown');
    }
    return this._merchants.get(merchantId);
  }

  // ---------------------------------------------------------------------------
  // Context field writers
  // ---------------------------------------------------------------------------

  /**
   * Atomically replaces the full merchant context payload.
   * Called when a new version of scope='merchant' arrives.
   *
   * @param {string} merchantId
   * @param {object} payload   - Full MerchantContext payload from the judge
   * @param {number} version
   */
  replaceContext(merchantId, payload, version) {
    const m = this._requireMerchant(merchantId);
    const now = new Date().toISOString();

    // Record version history before replacing
    m.metadata.versionHistory.push({
      scope: 'merchant',
      version,
      replacedAt: now,
    });

    m.scope = payload.category_slug || m.scope;
    m.identity = payload.identity || m.identity;
    m.performance = payload.performance || m.performance;
    m.offers = payload.offers || m.offers;
    m.currentVersion.merchant = version;
    m.metadata.contextPushCount++;
    m.analytics.contextUpdates++;
    m.analytics.lastActivity = now;
    m.timestamps.lastContextAt = now;
    if (!m.timestamps.firstContextAt) m.timestamps.firstContextAt = now;
    m.lastUpdated = now;

    logger.debug('MemoryStore: context replaced', { merchantId, version });
  }

  /**
   * Updates a subset of merchant context fields without full replacement.
   * Used when only a delta is available (e.g. performance refresh).
   *
   * @param {string} merchantId
   * @param {Partial<MerchantMemory>} delta
   */
  updateContext(merchantId, delta) {
    const m = this._requireMerchant(merchantId);
    const now = new Date().toISOString();

    Object.assign(m, delta);
    m.analytics.contextUpdates++;
    m.analytics.lastActivity = now;
    m.lastUpdated = now;
  }

  /**
   * Stores a customer context payload inside the merchant's memory.
   *
   * @param {string} merchantId
   * @param {string} customerId
   * @param {object} payload
   * @param {number} version
   */
  storeCustomer(merchantId, customerId, payload, version) {
    const m = this._requireMerchant(merchantId);
    const now = new Date().toISOString();

    m.customerContexts.set(customerId, { ...payload, _version: version, _storedAt: now });
    m.currentVersion[`customer:${customerId}`] = version;
    m.analytics.contextUpdates++;
    m.analytics.lastActivity = now;
    m.lastUpdated = now;

    logger.debug('MemoryStore: customer stored', { merchantId, customerId, version });
  }

  /**
   * Replaces the merchant's offers array.
   *
   * @param {string} merchantId
   * @param {object[]} offers
   */
  storeOffers(merchantId, offers) {
    const m = this._requireMerchant(merchantId);
    m.offers = Array.isArray(offers) ? [...offers] : [];
    m.lastUpdated = new Date().toISOString();
  }

  /**
   * Replaces the merchant's performance snapshot.
   *
   * @param {string} merchantId
   * @param {object} performance
   */
  storePerformance(merchantId, performance) {
    const m = this._requireMerchant(merchantId);
    const prev = m.performance;
    m.performance = { ...performance };

    // Compute rolling metric fields
    if (performance.ctr !== undefined) {
      m.metrics.currentCtr = performance.ctr;
      if (m.metrics.peakCtr === null || performance.ctr > m.metrics.peakCtr) {
        m.metrics.peakCtr = performance.ctr;
      }
    }
    if (performance.views !== undefined) m.metrics.totalViews = performance.views;
    if (performance.calls !== undefined) m.metrics.totalCalls = performance.calls;
    if (performance.directions !== undefined) m.metrics.totalDirections = performance.directions;

    m.lastUpdated = new Date().toISOString();
    return { prev, current: m.performance };
  }

  /**
   * Appends a message to the merchant's conversationHistory.
   * Automatically trims to MAX_CONVERSATION_MESSAGES (keeps newest).
   *
   * @param {string} merchantId
   * @param {ConversationMessage} message
   */
  storeConversation(merchantId, message) {
    const m = this._requireMerchant(merchantId);
    const now = new Date().toISOString();

    m.conversationHistory.push({
      ...message,
      storedAt: now,
    });

    // Trim to capacity — remove oldest entries
    if (m.conversationHistory.length > MAX_CONVERSATION_MESSAGES) {
      const excess = m.conversationHistory.length - MAX_CONVERSATION_MESSAGES;
      m.conversationHistory.splice(0, excess);
    }

    m.analytics.lastActivity = now;
    m.lastUpdated = now;
  }

  /**
   * Stores derived performance metrics on the merchant.
   *
   * @param {string} merchantId
   * @param {object} metrics
   */
  storeMetrics(merchantId, metrics) {
    const m = this._requireMerchant(merchantId);
    Object.assign(m.metrics, metrics);
    m.lastUpdated = new Date().toISOString();
  }

  /**
   * Updates the analytics object for a merchant.
   *
   * @param {string} merchantId
   * @param {Partial<AnalyticsEntry>} analytics
   */
  storeAnalytics(merchantId, analytics) {
    const m = this._requireMerchant(merchantId);
    Object.assign(m.analytics, analytics);
    m.lastUpdated = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Aggregate reads
  // ---------------------------------------------------------------------------

  /**
   * Returns the total number of merchant records.
   *
   * @returns {number}
   */
  size() {
    return this._merchants.size;
  }

  /**
   * Returns all merchant IDs currently tracked.
   *
   * @returns {string[]}
   */
  allMerchantIds() {
    return Array.from(this._merchants.keys());
  }

  /**
   * Wipes all merchant memory.
   */
  clear() {
    const count = this._merchants.size;
    this._merchants.clear();
    logger.info('MemoryStore cleared', { merchantsWiped: count });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _requireMerchant(merchantId) {
    const m = this._merchants.get(merchantId);
    if (!m) throw new Error(`MemoryStore: merchant not found: ${merchantId}`);
    return m;
  }
}

// Singleton export
module.exports = new MemoryStore();

/**
 * @typedef {object} MerchantMemory
 * @property {string}   merchantId
 * @property {string}   scope
 * @property {object}   currentVersion
 * @property {object|null} identity
 * @property {object|null} category
 * @property {object|null} performance
 * @property {object[]} offers
 * @property {object[]} campaigns
 * @property {object}   metrics
 * @property {ConversationMessage[]} conversationHistory
 * @property {object[]} replyHistory
 * @property {Map<string,object>} customerContexts
 * @property {object[]} triggerHistory
 * @property {object[]} tickHistory
 * @property {AnalyticsEntry} analytics
 * @property {object|null} lastDecision
 * @property {string}   merchantState
 * @property {object}   suppressionKeys
 * @property {string}   lastUpdated
 * @property {object}   timestamps
 * @property {object}   metadata
 * @property {object}   futureReserved
 *
 * @typedef {object} ConversationMessage
 * @property {string}  conversationId
 * @property {string}  speaker          - 'vera' | 'merchant' | 'customer'
 * @property {string}  body
 * @property {string}  [intent]
 * @property {string}  [replyStatus]    - 'pending' | 'replied' | 'auto_reply' | 'no_reply'
 * @property {string}  timestamp
 * @property {string}  storedAt
 *
 * @typedef {object} AnalyticsEntry
 * @property {number}       replyCount
 * @property {number}       tickCount
 * @property {number}       contextUpdates
 * @property {number}       ignoredUpdates
 * @property {number}       uptimeMs
 * @property {number|null}  avgResponseLatencyMs
 * @property {string}       lastActivity
 * @property {string}       firstSeenAt
 */
