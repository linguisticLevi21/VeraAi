'use strict';

/**
 * InferenceEngine — converts extracted signals into human-readable observations.
 *
 * Observations are structured conclusions about the merchant's situation that
 * guide which strategies are relevant. Each observation maps to one or more
 * candidate strategies in StrategySelector.
 *
 * Observation shape:
 * {
 *   observation:   string   — machine-readable key
 *   label:         string   — human-readable statement
 *   confidence:    number   — 0-1 composite confidence
 *   triggerSignals: string[] — signal types that produced this observation
 *   priority:      number   — 1 (act now) → 5 (informational)
 * }
 */
class InferenceEngine {
  /**
   * Derives observations from a set of extracted signals.
   *
   * @param {import('./SignalExtractor').Signal[]} signals
   * @param {object} merchant  - MerchantMemory (for context enrichment)
   * @returns {Observation[]}
   */
  infer(signals, merchant) {
    const byType = this._index(signals);
    const observations = [];

    // Rule table — evaluated in priority order.
    // Each rule: [ condition_fn, observation_key, label, priority, confidence_fn ]
    const rules = [
      // ── Hard exits ──────────────────────────────────────────────────────────
      [
        () => byType.has('merchant_replied_no'),
        'merchant_refused',
        'Merchant has declined — gracefully exit this conversation.',
        1,
        () => 1.0,
      ],
      [
        () => byType.has('trigger_expired'),
        'trigger_expired',
        'The trigger has expired — do not act on it.',
        1,
        () => 1.0,
      ],
      [
        () => byType.has('merchant_auto_reply'),
        'merchant_auto_replying',
        'Merchant appears to have a WhatsApp auto-reply active — back off.',
        1,
        () => 0.95,
      ],

      // ── Affirmative / intent ─────────────────────────────────────────────
      [
        () => byType.has('merchant_replied_yes') || byType.has('merchant_intent_join'),
        'merchant_ready_to_act',
        'Merchant has expressed readiness — deliver the promised value immediately.',
        1,
        () => 0.95,
      ],
      [
        () => byType.has('merchant_asked_question'),
        'merchant_needs_clarification',
        'Merchant asked a question — answer it precisely, then re-state the CTA.',
        1,
        () => 0.9,
      ],

      // ── Conversation continuity ──────────────────────────────────────────
      [
        () => byType.has('conversation_stalled'),
        'conversation_stalled',
        'Merchant has not replied in 48h — send a gentle follow-up or close gracefully.',
        2,
        () => by('conversation_stalled', byType).confidence,
      ],
      [
        () => byType.has('merchant_not_replied_24h'),
        'merchant_silent_24h',
        'Merchant has not replied in 24h — consider a soft nudge.',
        2,
        () => 0.75,
      ],

      // ── Visibility & performance ─────────────────────────────────────────
      [
        () => byType.has('ctr_critically_below_peer'),
        'merchant_needs_visibility',
        'Merchant CTR is critically below peers — needs immediate visibility intervention.',
        1,
        () => by('ctr_critically_below_peer', byType).confidence,
      ],
      [
        () => byType.has('ctr_below_peer'),
        'merchant_visibility_low',
        'Merchant CTR is below peer median — a targeted offer or campaign would help.',
        2,
        () => by('ctr_below_peer', byType).confidence,
      ],
      [
        () => byType.has('views_declining'),
        'merchant_declining',
        'Merchant views declined over 20% last week — performance recovery needed.',
        1,
        () => 0.9,
      ],
      [
        () => byType.has('views_softening'),
        'merchant_softening',
        'Merchant views slightly softened — monitoring; consider a proactive boost.',
        3,
        () => 0.75,
      ],
      [
        () => byType.has('low_visibility'),
        'merchant_needs_visibility',
        'Merchant has very few views — visibility is the top priority.',
        2,
        () => 0.8,
      ],

      // ── Offers ───────────────────────────────────────────────────────────
      [
        () => byType.has('offer_expiring_soon'),
        'offer_about_to_expire',
        'An active offer expires within 24h — extend it or leverage urgency.',
        1,
        () => 0.95,
      ],
      [
        () => byType.has('offer_expiring_in_3d'),
        'offer_expiring_soon',
        'An offer expires within 3 days — now is the time to promote it.',
        2,
        () => 0.85,
      ],
      [
        () => byType.has('offer_expired'),
        'offer_needs_refresh',
        'The current offer has expired — merchant should launch a new one.',
        2,
        () => 0.9,
      ],
      [
        () => byType.has('no_active_offers'),
        'no_offers_live',
        'Merchant has no active offers — a new offer could drive footfall.',
        3,
        () => 0.7,
      ],

      // ── Customers ────────────────────────────────────────────────────────
      [
        () => byType.has('inactive_customers') || byType.has('customer_long_inactive'),
        'merchant_should_recall_customers',
        'Majority of customers are lapsed — recall campaign is the highest-value action.',
        1,
        () => by('inactive_customers', byType, 'customer_long_inactive').confidence,
      ],
      [
        () => byType.has('some_customers_inactive') || byType.has('customer_inactive_30d'),
        'some_customers_need_recall',
        'A portion of customers have gone quiet — a win-back message would be timely.',
        2,
        () => 0.75,
      ],

      // ── Reviews / reputation ─────────────────────────────────────────────
      [
        () => byType.has('rating_dropped'),
        'merchant_reputation_at_risk',
        'Merchant rating has dropped — addressing reviews is urgent.',
        1,
        () => 0.95,
      ],
      [
        () => byType.has('review_spike'),
        'merchant_has_new_reviews',
        'A spike in reviews detected — merchant should acknowledge and respond.',
        2,
        () => 0.8,
      ],

      // ── Campaigns ────────────────────────────────────────────────────────
      [
        () => byType.has('campaign_underperforming'),
        'campaign_needs_rescue',
        'Running campaign is underperforming — a mid-course adjustment may help.',
        2,
        () => 0.8,
      ],
      [
        () => byType.has('campaign_completed'),
        'campaign_completed',
        'Campaign has ended — celebrate or propose a follow-up campaign.',
        3,
        () => 0.85,
      ],

      // ── Triggers ─────────────────────────────────────────────────────────
      [
        () => byType.has('trigger_research_digest'),
        'research_digest_available',
        'A new research digest is available — share the most relevant excerpt.',
        2,
        () => 0.9,
      ],
      [
        () => byType.has('trigger_recall_due'),
        'recall_due',
        'A customer recall trigger is active — reach out now.',
        2,
        () => 0.9,
      ],
      [
        () => byType.has('trigger_perf_spike'),
        'performance_spike',
        'A performance spike trigger is available — celebrate and leverage momentum.',
        3,
        () => 0.85,
      ],
      [
        () => byType.has('trigger_festival_upcoming'),
        'festival_approaching',
        'A festival trigger is active — tailor the message to the occasion.',
        2,
        () => 0.85,
      ],

      // ── Temporal ─────────────────────────────────────────────────────────
      [
        () => byType.has('weekend_approaching'),
        'weekend_traffic_boost',
        'Weekend is approaching — a well-timed offer can drive significant traffic.',
        3,
        () => 0.8,
      ],
      [
        () =>
          byType.has('festival_season_diwali') ||
          byType.has('festival_season_christmas') ||
          byType.has('festival_season_eid'),
        'festival_season_active',
        'Festival season detected — tailor messaging to the occasion for higher conversion.',
        3,
        () => 0.75,
      ],

      // ── Operational ──────────────────────────────────────────────────────
      [
        () => byType.has('stale_posts'),
        'merchant_profile_stale',
        'Merchant profile has stale posts — updating content would improve visibility.',
        3,
        () => 0.8,
      ],
      [
        () => byType.has('high_cancellation'),
        'high_cancellation_rate',
        'High cancellation rate detected — operational improvement advice is needed.',
        2,
        () => 0.85,
      ],

      // ── Default / growth ─────────────────────────────────────────────────
      [
        () => byType.has('ctr_high_performing'),
        'merchant_performing_well',
        'Merchant is performing above peers — celebrate and suggest next-level growth action.',
        4,
        () => 0.85,
      ],
      [
        () => byType.has('trigger_high_urgency'),
        'high_urgency_trigger',
        'A high-urgency trigger is active — act on it before anything else.',
        1,
        () => 1.0,
      ],
    ];

    for (const [condition, key, label, priority, confFn] of rules) {
      if (condition()) {
        const confidence = typeof confFn === 'function' ? confFn() : confFn;
        const triggerSignals = signals.filter((s) => condition.toString().includes(s.type)).map((s) => s.type);
        observations.push({ observation: key, label, confidence, triggerSignals, priority });
      }
    }

    return observations.sort((a, b) => a.priority - b.priority);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Builds a Map<type, Signal> for O(1) lookups. */
  _index(signals) {
    const m = new Map();
    for (const s of signals) {
      if (!m.has(s.type)) m.set(s.type, s);
    }
    return m;
  }
}

// Helper used inside rule closures — returns the signal with fallback
function by(type, byType, fallbackType) {
  return byType.get(type) || byType.get(fallbackType) || { confidence: 0.8 };
}

module.exports = new InferenceEngine();

/**
 * @typedef {object} Observation
 * @property {string}   observation
 * @property {string}   label
 * @property {number}   confidence
 * @property {string[]} triggerSignals
 * @property {number}   priority
 */
