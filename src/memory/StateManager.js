'use strict';

const { MERCHANT_STATES } = require('../config/constants');

/**
 * StateManager — deterministic merchant state machine.
 *
 * Transitions are driven exclusively by observable signals:
 *   - Subscription status
 *   - Performance metrics (CTR relative to peer median, views delta)
 *   - Conversation engagement signals
 *   - Active offers and campaigns
 *   - Customer aggregate data
 *
 * No randomness. No probability. Every output is reproducible given
 * the same inputs.
 *
 * State graph (simplified):
 *
 *   NEW ──────────────────────────────────────────────► OFFLINE
 *    │                                                      ▲
 *    ▼                                                      │
 *   ACTIVE ──► HIGH_PERFORMING                              │
 *    │    ◄─── LOW_PERFORMING ──► DECLINING ──► RECOVERING ─┘
 *    │
 *    ├──► WAITING_REPLY
 *    ├──► CAMPAIGN_RUNNING
 *    ├──► NEEDS_ATTENTION
 *    ├──► CUSTOMER_ENGAGED
 *    └──► CUSTOMER_INACTIVE
 */
class StateManager {
  constructor() {
    /**
     * Map<merchantId, { state: string, previousState: string|null, transitionedAt: string, reason: string }>
     * @type {Map<string, MerchantStateEntry>}
     */
    this._states = new Map();
  }

  // ---------------------------------------------------------------------------
  // Initialise
  // ---------------------------------------------------------------------------

  /**
   * Creates a fresh state entry for a new merchant.
   * Always starts in UNKNOWN; compute() will drive the first real transition.
   *
   * @param {string} merchantId
   * @returns {MerchantStateEntry}
   */
  init(merchantId) {
    const entry = {
      state: MERCHANT_STATES.UNKNOWN,
      previousState: null,
      transitionedAt: new Date().toISOString(),
      reason: 'merchant_created',
    };
    this._states.set(merchantId, entry);
    return { ...entry };
  }

  // ---------------------------------------------------------------------------
  // Compute / Transition
  // ---------------------------------------------------------------------------

  /**
   * Computes the next state deterministically from the merchant's current data.
   *
   * Called whenever new context is pushed (POST /v1/context) or a tick fires.
   * Returns the new state entry (transition is applied internally).
   *
   * @param {string} merchantId
   * @param {MerchantSignals} signals
   * @returns {MerchantStateEntry}
   */
  compute(merchantId, signals) {
    const current = this._states.get(merchantId);
    const currentState = current ? current.state : MERCHANT_STATES.UNKNOWN;

    const { nextState, reason } = this._evaluate(signals, currentState);

    if (nextState === currentState && current) {
      return { ...current };
    }

    const entry = {
      state: nextState,
      previousState: currentState,
      transitionedAt: new Date().toISOString(),
      reason,
    };
    this._states.set(merchantId, entry);
    return { ...entry };
  }

  /**
   * Forcibly sets the state for a merchant (used by ConversationManager
   * when a merchant sends an explicit reply intent).
   *
   * @param {string} merchantId
   * @param {string} state
   * @param {string} reason
   * @returns {MerchantStateEntry}
   */
  forceTransition(merchantId, state, reason) {
    if (!Object.values(MERCHANT_STATES).includes(state)) {
      throw new Error(`Invalid merchant state: ${state}`);
    }
    const current = this._states.get(merchantId);
    const entry = {
      state,
      previousState: current ? current.state : null,
      transitionedAt: new Date().toISOString(),
      reason,
    };
    this._states.set(merchantId, entry);
    return { ...entry };
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Returns the current state entry for a merchant, or null.
   *
   * @param {string} merchantId
   * @returns {MerchantStateEntry | null}
   */
  getState(merchantId) {
    const entry = this._states.get(merchantId);
    return entry ? { ...entry } : null;
  }

  /**
   * Returns the raw state string, or UNKNOWN if not tracked.
   *
   * @param {string} merchantId
   * @returns {string}
   */
  getStateName(merchantId) {
    const entry = this._states.get(merchantId);
    return entry ? entry.state : MERCHANT_STATES.UNKNOWN;
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  deleteMerchant(merchantId) {
    this._states.delete(merchantId);
  }

  clear() {
    this._states.clear();
  }

  // ---------------------------------------------------------------------------
  // Private — deterministic evaluation logic
  // ---------------------------------------------------------------------------

  /**
   * Core deterministic transition function.
   * Evaluates all signals in priority order and returns the single best state.
   *
   * Priority order (highest wins):
   *   1. OFFLINE        — subscription lapsed or inactive
   *   2. CAMPAIGN_RUNNING — has an active campaign
   *   3. WAITING_REPLY  — last outbound from Vera, no inbound yet
   *   4. HIGH_PERFORMING — CTR >= peer median AND views delta > 0
   *   5. LOW_PERFORMING  — CTR < 50% of peer median
   *   6. DECLINING       — views delta < -20% week-over-week
   *   7. RECOVERING      — previously DECLINING, now views delta > 0
   *   8. CUSTOMER_ENGAGED — has active customer conversations
   *   9. CUSTOMER_INACTIVE — has lapsed customers > 50% of total
   *  10. NEEDS_ATTENTION — has stale_posts or ctr_below_peer signals
   *  11. ACTIVE          — subscription active, no special signals
   *  12. NEW             — just created, no performance data yet
   *  13. UNKNOWN         — fallback
   *
   * @param {MerchantSignals} s
   * @param {string} currentState
   * @returns {{ nextState: string, reason: string }}
   */
  _evaluate(s, currentState) {
    // 1. OFFLINE
    if (s.subscriptionStatus === 'lapsed' || s.subscriptionStatus === 'inactive') {
      return { nextState: MERCHANT_STATES.OFFLINE, reason: 'subscription_lapsed' };
    }

    // 2. CAMPAIGN_RUNNING
    if (s.hasActiveCampaign) {
      return { nextState: MERCHANT_STATES.CAMPAIGN_RUNNING, reason: 'campaign_active' };
    }

    // 3. WAITING_REPLY
    if (s.awaitingMerchantReply) {
      return { nextState: MERCHANT_STATES.WAITING_REPLY, reason: 'vera_sent_awaiting_reply' };
    }

    // 4. HIGH_PERFORMING
    if (
      s.ctr !== null &&
      s.peerMedianCtr !== null &&
      s.ctr >= s.peerMedianCtr &&
      s.viewsDelta7d !== null &&
      s.viewsDelta7d > 0
    ) {
      return { nextState: MERCHANT_STATES.HIGH_PERFORMING, reason: 'ctr_above_peer_and_views_up' };
    }

    // 5. LOW_PERFORMING
    if (s.ctr !== null && s.peerMedianCtr !== null && s.ctr < s.peerMedianCtr * 0.5) {
      return { nextState: MERCHANT_STATES.LOW_PERFORMING, reason: 'ctr_critically_below_peer' };
    }

    // 6. DECLINING
    if (s.viewsDelta7d !== null && s.viewsDelta7d < -0.2) {
      return { nextState: MERCHANT_STATES.DECLINING, reason: 'views_declining_over_20pct' };
    }

    // 7. RECOVERING — was declining, now trending positive
    if (
      (currentState === MERCHANT_STATES.DECLINING || currentState === MERCHANT_STATES.LOW_PERFORMING) &&
      s.viewsDelta7d !== null &&
      s.viewsDelta7d > 0
    ) {
      return { nextState: MERCHANT_STATES.RECOVERING, reason: 'recovering_from_decline' };
    }

    // 8. CUSTOMER_ENGAGED
    if (s.activeCustomerConversations !== null && s.activeCustomerConversations > 0) {
      return { nextState: MERCHANT_STATES.CUSTOMER_ENGAGED, reason: 'active_customer_conversation' };
    }

    // 9. CUSTOMER_INACTIVE
    if (
      s.lapsedCustomers !== null &&
      s.totalCustomers !== null &&
      s.totalCustomers > 0 &&
      s.lapsedCustomers / s.totalCustomers > 0.5
    ) {
      return { nextState: MERCHANT_STATES.CUSTOMER_INACTIVE, reason: 'majority_customers_lapsed' };
    }

    // 10. NEEDS_ATTENTION
    if (s.hasStaleSignals) {
      return { nextState: MERCHANT_STATES.NEEDS_ATTENTION, reason: 'stale_profile_signals' };
    }

    // 11. ACTIVE
    if (s.subscriptionStatus === 'active') {
      return { nextState: MERCHANT_STATES.ACTIVE, reason: 'subscription_active' };
    }

    // 12. NEW
    if (s.hasPerformanceData === false) {
      return { nextState: MERCHANT_STATES.NEW, reason: 'no_performance_data_yet' };
    }

    // 13. Fallback
    return { nextState: MERCHANT_STATES.UNKNOWN, reason: 'insufficient_signals' };
  }
}

// Singleton export
module.exports = new StateManager();

/**
 * @typedef {object} MerchantSignals
 * @property {string|null}  subscriptionStatus        - 'active' | 'lapsed' | 'inactive' | null
 * @property {boolean}      hasActiveCampaign
 * @property {boolean}      awaitingMerchantReply
 * @property {number|null}  ctr                        - Merchant's current CTR (0-1)
 * @property {number|null}  peerMedianCtr              - Category peer median CTR (0-1)
 * @property {number|null}  viewsDelta7d               - 7-day views % delta (-1 to +∞)
 * @property {number|null}  activeCustomerConversations
 * @property {number|null}  lapsedCustomers
 * @property {number|null}  totalCustomers
 * @property {boolean}      hasStaleSignals            - true if signals[] contains stale_posts or ctr_below_peer_median
 * @property {boolean}      hasPerformanceData         - false for brand-new merchants with no perf data yet
 *
 * @typedef {object} MerchantStateEntry
 * @property {string}       state
 * @property {string|null}  previousState
 * @property {string}       transitionedAt
 * @property {string}       reason
 */
