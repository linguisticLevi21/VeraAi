'use strict';

/**
 * ActionRanker — scores every candidate action on 10 weighted dimensions
 * and selects the single highest-scoring action.
 *
 * Scoring dimensions and weights (must sum to 1.0):
 *   1. urgency              0.20  — time-sensitivity of the underlying signal
 *   2. merchant_fit         0.15  — how relevant the action is to this specific merchant
 *   3. specificity          0.15  — how concrete and data-grounded the action is
 *   4. conversation_cont    0.12  — whether the action maintains conversation continuity
 *   5. business_impact      0.12  — expected revenue/visibility improvement
 *   6. category_match       0.10  — how well the action suits the merchant's category
 *   7. freshness            0.08  — how recently this strategy was last used
 *   8. replay_safety        0.04  — not a recently-repeated action (suppression)
 *   9. reply_probability    0.03  — likelihood of merchant replying
 *  10. novelty              0.01  — slight preference for strategies not yet tried
 *
 * All dimensions return 0-1. Final score = weighted sum.
 */

// Base weights — static constant, not re-allocated per call
const BASE_WEIGHTS = Object.freeze({
  urgency:           0.20,
  merchant_fit:      0.15,
  specificity:       0.15,
  conversation_cont: 0.12,
  business_impact:   0.12,
  category_match:    0.10,
  freshness:         0.08,
  replay_safety:     0.04,
  reply_probability: 0.03,
  novelty:           0.01,
});

// Per-category weight overrides — only specify dimensions that differ from base
// Normalisation is applied automatically before scoring.
const CATEGORY_WEIGHT_OVERRIDES = Object.freeze({
  dentists:    { reply_probability: 0.06, conversation_cont: 0.09, novelty: 0.01 },
  pharmacies:  { reply_probability: 0.06, conversation_cont: 0.09, novelty: 0.01 },
  restaurants: { conversation_cont: 0.14, urgency: 0.22, novelty: 0.01 },
  gyms:        { conversation_cont: 0.14, merchant_fit: 0.16, novelty: 0.01 },
  salons:      { business_impact: 0.14, freshness: 0.09, novelty: 0.01 },
});
class ActionRanker {
  /**
   * Scores all candidates and returns the best one.
   * Never picks the first candidate — always evaluates all.
   *
   * @param {import('./StrategySelector').CandidateAction[]} candidates
   * @param {import('./InferenceEngine').Observation[]} observations
   * @param {object} merchant     - MerchantMemory
   * @param {object|null} trigger - TriggerContext
   * @param {object} suppressionKeys - merchant.suppressionKeys
   * @returns {{ best: CandidateAction, scored: ScoredCandidate[] } | null}
   */
  rank(candidates, observations, merchant, trigger, suppressionKeys) {
    if (!candidates.length) return null;

    const obsSet = new Set(observations.map((o) => o.observation));
    const topObsPriority = observations.length ? observations[0].priority : 5;
    const now = Date.now();
    const weights = this._resolveWeights(merchant.scope);

    const scored = candidates.map((candidate) => {
      const dims = {
        urgency: this._urgency(candidate, trigger, topObsPriority),
        merchant_fit: this._merchantFit(candidate, merchant),
        specificity: this._specificity(candidate, merchant, trigger),
        conversation_cont: this._conversationContinuity(candidate, merchant),
        business_impact: this._businessImpact(candidate, merchant),
        category_match: this._categoryMatch(candidate, merchant),
        freshness: this._freshness(candidate, merchant, now),
        replay_safety: this._replaySafety(candidate, suppressionKeys),
        reply_probability: this._replyProbability(candidate, obsSet),
        novelty: this._novelty(candidate, merchant),
      };

      const total = Object.entries(weights).reduce((sum, [key, w]) => sum + dims[key] * w, 0);

      return { ...candidate, dims, total };
    });

    // Sort descending by total score
    scored.sort((a, b) => b.total - a.total);

    return { best: scored[0], scored };
  }

  /**
   * Resolves the weight vector for a given merchant scope.
   * Applies category-specific overrides and re-normalises to sum=1.
   *
   * @param {string} scope
   * @returns {object}
   */
  _resolveWeights(scope) {
    const overrides = (scope && CATEGORY_WEIGHT_OVERRIDES[scope]) || {};
    if (Object.keys(overrides).length === 0) return BASE_WEIGHTS;

    // Merge overrides into a mutable copy
    const merged = { ...BASE_WEIGHTS, ...overrides };

    // Re-normalise so weights always sum to exactly 1.0
    const total = Object.values(merged).reduce((s, v) => s + v, 0);
    const factor = 1 / total;
    return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v * factor]));
  }

  // ---------------------------------------------------------------------------
  // Dimension scorers — each returns 0-1
  // ---------------------------------------------------------------------------

  _urgency(candidate, trigger, topObsPriority) {
    // High urgency if top observation is critical (priority 1) or trigger has high urgency
    const triggerUrgency = trigger && trigger.urgency !== undefined ? trigger.urgency : 0;
    const obsFactor = topObsPriority === 1 ? 1.0 : topObsPriority === 2 ? 0.75 : 0.4;
    const trigFactor = triggerUrgency >= 3 ? 1.0 : triggerUrgency === 2 ? 0.7 : 0.3;

    // FollowUp and Retention have inherent urgency from conversation state
    if (candidate.strategy === 'follow_up') return Math.max(obsFactor, 0.85);
    if (candidate.strategy === 'retention') return 0.6;

    return (obsFactor + trigFactor) / 2;
  }

  _merchantFit(candidate, merchant) {
    const scope = merchant.scope || 'unknown';
    const perf = merchant.performance || {};
    const metrics = merchant.metrics || {};

    // Fit is higher when the merchant's data directly supports this strategy
    const fitMap = {
      campaign: (merchant.campaigns || []).some((c) => c.status === 'active') ? 1.0 : 0.5,
      offer: (merchant.offers || []).length > 0 ? 0.9 : 0.5,
      customer_winback: (perf.customer_aggregate && perf.customer_aggregate.lapsed_180d_plus > 0) ? 1.0 : 0.4,
      performance_recovery: metrics.currentCtr !== null && metrics.peerMedianCtr !== null && metrics.currentCtr < metrics.peerMedianCtr ? 1.0 : 0.5,
      review: (perf.signals || []).some((s) => typeof s === 'string' && (s.includes('rating_drop') || s.includes('review_spike'))) ? 1.0 : 0.3,
      engagement: 0.75, // Engagement is broadly applicable
      growth: 0.7,
      festival: 0.65,
      retention: merchant.conversationHistory && merchant.conversationHistory.length > 0 ? 0.8 : 0.1,
      follow_up: merchant.conversationHistory && merchant.conversationHistory.some((m) => m.intent === 'affirmative') ? 1.0 : 0.3,
    };

    return fitMap[candidate.strategy] !== undefined ? fitMap[candidate.strategy] : 0.5;
  }

  _specificity(candidate, merchant, trigger) {
    // Higher if the message can be grounded in real data fields
    const hasIdentity = merchant.identity !== null;
    const hasPerf = merchant.performance !== null;
    const hasOffers = (merchant.offers || []).length > 0;
    const hasTriggerData = trigger && Object.keys(trigger).length > 3;

    let score = 0.4;
    if (hasIdentity) score += 0.15;
    if (hasPerf) score += 0.2;
    if (hasOffers) score += 0.1;
    if (hasTriggerData) score += 0.15;
    return Math.min(score, 1.0);
  }

  _conversationContinuity(candidate, merchant) {
    const history = merchant.conversationHistory || [];
    const lastMsg = history[history.length - 1];

    if (!lastMsg) return candidate.strategy === 'engagement' ? 0.7 : 0.5;

    // If last message was affirmative, follow_up gets maximum continuity score
    if (lastMsg.intent === 'affirmative' || lastMsg.intent === 'intent_join') {
      return candidate.strategy === 'follow_up' ? 1.0 : 0.2;
    }
    if (lastMsg.intent === 'question') {
      return candidate.strategy === 'follow_up' ? 0.95 : 0.25;
    }
    if (lastMsg.intent === 'negative') {
      return candidate.strategy === 'retention' ? 0.1 : 0.3;
    }
    if (lastMsg.speaker === 'vera') {
      return candidate.strategy === 'retention' ? 0.85 : 0.4;
    }
    return 0.5;
  }

  _businessImpact(candidate, merchant) {
    // Estimated business impact based on strategy type and merchant situation
    const impactMap = {
      customer_winback: 0.9,  // Highest ROI — re-engaging known customers
      campaign: 0.85,
      offer: 0.8,
      performance_recovery: 0.8,
      growth: 0.75,
      follow_up: 0.7,         // Depends on what's being delivered
      review: 0.65,
      engagement: 0.6,
      festival: 0.7,
      retention: 0.55,
    };
    return impactMap[candidate.strategy] || 0.5;
  }

  _categoryMatch(candidate, merchant) {
    const scope = merchant.scope || 'unknown';
    const knownScopes = ['dentists', 'restaurants', 'salons', 'gyms', 'pharmacies'];
    // If category is known, all category-specific strategies get full marks
    if (knownScopes.includes(scope)) return 0.9;
    // Unknown category — generic strategies preferred slightly
    return ['engagement', 'growth'].includes(candidate.strategy) ? 0.7 : 0.5;
  }

  _freshness(candidate, merchant, now) {
    const replyHistory = merchant.replyHistory || [];
    const lastUsed = [...replyHistory].reverse().find((r) => r.strategy === candidate.strategy);
    if (!lastUsed) return 1.0; // Never used — maximum freshness

    const hoursSince = (now - new Date(lastUsed.sentAt).getTime()) / 3_600_000;
    if (hoursSince < 6) return 0.1;
    if (hoursSince < 24) return 0.4;
    if (hoursSince < 72) return 0.75;
    return 1.0;
  }

  _replaySafety(candidate, suppressionKeys) {
    if (!suppressionKeys) return 1.0;
    // Penalise if the same strategy was used last
    if (suppressionKeys.lastStrategy === candidate.strategy) return 0.1;
    // Slight penalty if same CTA type
    return 0.9;
  }

  _replyProbability(candidate, obsSet) {
    // Higher reply probability when merchant has been actively engaging
    if (obsSet.has('merchant_ready_to_act') || obsSet.has('merchant_replied_yes')) {
      return candidate.strategy === 'follow_up' ? 1.0 : 0.4;
    }
    if (obsSet.has('merchant_asked_question')) return candidate.strategy === 'follow_up' ? 0.95 : 0.35;
    if (obsSet.has('merchant_silent_24h')) return 0.3;
    if (obsSet.has('conversation_stalled')) return 0.2;

    // Base reply probabilities by strategy type
    const probMap = {
      follow_up: 0.85,
      offer: 0.65,
      customer_winback: 0.6,
      engagement: 0.55,
      campaign: 0.5,
      review: 0.45,
      growth: 0.4,
      performance_recovery: 0.4,
      festival: 0.45,
      retention: 0.3,
    };
    return probMap[candidate.strategy] || 0.4;
  }

  _novelty(candidate, merchant) {
    const replyHistory = merchant.replyHistory || [];
    const usedStrategies = new Set(replyHistory.map((r) => r.strategy));
    return usedStrategies.has(candidate.strategy) ? 0.3 : 1.0;
  }
}

// Singleton export
module.exports = new ActionRanker();

/**
 * @typedef {object} ScoredCandidate
 * @property {string}  strategy
 * @property {number}  total
 * @property {object}  dims
 */
