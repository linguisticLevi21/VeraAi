'use strict';

const CampaignStrategy = require('../strategies/CampaignStrategy');
const RetentionStrategy = require('../strategies/RetentionStrategy');
const OfferStrategy = require('../strategies/OfferStrategy');
const GrowthStrategy = require('../strategies/GrowthStrategy');
const FestivalStrategy = require('../strategies/FestivalStrategy');
const CustomerWinbackStrategy = require('../strategies/CustomerWinbackStrategy');
const ReviewStrategy = require('../strategies/ReviewStrategy');
const EngagementStrategy = require('../strategies/EngagementStrategy');
const PerformanceRecoveryStrategy = require('../strategies/PerformanceRecoveryStrategy');
const FollowUpStrategy = require('../strategies/FollowUpStrategy');

/**
 * StrategySelector — scores all registered strategies and returns ranked candidates.
 *
 * Every strategy receives the full context bundle and returns a numeric score.
 * Strategies with score=0 are excluded. The remainder are returned as ranked
 * CandidateAction objects for the ActionRanker to score and select from.
 *
 * The registry is a plain array — adding a new strategy is one line.
 */
class StrategySelector {
  constructor() {
    /** @type {BaseStrategy[]} */
    this._strategies = [
      FollowUpStrategy,           // Must evaluate first — replies to in-progress conversations
      CampaignStrategy,
      ReviewStrategy,
      CustomerWinbackStrategy,
      PerformanceRecoveryStrategy,
      EngagementStrategy,
      OfferStrategy,
      GrowthStrategy,
      FestivalStrategy,
      RetentionStrategy,          // Evaluated last — only fires if no other strategy scores
    ];
  }

  /**
   * Scores all strategies against the current context and returns candidates.
   *
   * @param {object} context  — { merchant, category, trigger, customer }
   * @param {import('./InferenceEngine').Observation[]} observations
   * @returns {CandidateAction[]}
   */
  selectCandidates(context, observations) {
    const obsSet = new Set(observations.map((o) => o.observation));
    const candidates = [];

    for (const strategy of this._strategies) {
      let rawScore;
      try {
        rawScore = strategy.score(context);
      } catch (err) {
        // Strategy scoring must never crash the pipeline
        rawScore = 0;
      }

      if (rawScore <= 0) continue;

      // Boost score when an observation directly aligns with this strategy
      const boost = this._observationBoost(strategy.name, obsSet);
      const finalScore = Math.min(rawScore + boost, 1.0);

      candidates.push({
        strategy: strategy.name,
        strategyInstance: strategy,
        score: finalScore,
        reason: `Strategy "${strategy.name}" scored ${finalScore.toFixed(2)} from raw=${rawScore.toFixed(2)} + obs_boost=${boost.toFixed(2)}`,
        observations: [...obsSet],
      });
    }

    // Sort by score descending
    return candidates.sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Returns a score boost when inference observations align with a strategy.
   * This lets high-confidence inference conclusions amplify strategy relevance.
   *
   * @param {string}  strategyName
   * @param {Set<string>} obsSet
   * @returns {number}  0 to 0.15
   */
  _observationBoost(strategyName, obsSet) {
    const boostMap = {
      follow_up: ['merchant_ready_to_act', 'merchant_needs_clarification'],
      campaign: ['campaign_needs_rescue', 'campaign_completed'],
      review: ['merchant_reputation_at_risk', 'merchant_has_new_reviews'],
      customer_winback: ['merchant_should_recall_customers', 'some_customers_need_recall', 'recall_due'],
      performance_recovery: ['merchant_declining', 'merchant_needs_visibility'],
      engagement: ['research_digest_available', 'performance_spike'],
      offer: ['offer_about_to_expire', 'offer_expiring_soon', 'offer_needs_refresh'],
      growth: ['merchant_visibility_low', 'no_offers_live'],
      festival: ['festival_approaching', 'festival_season_active', 'weekend_traffic_boost'],
      retention: ['conversation_stalled', 'merchant_silent_24h'],
    };

    const relevant = boostMap[strategyName] || [];
    const matched = relevant.filter((obs) => obsSet.has(obs)).length;
    return matched > 0 ? Math.min(matched * 0.08, 0.15) : 0;
  }
}

// Singleton export
module.exports = new StrategySelector();

/**
 * @typedef {object} CandidateAction
 * @property {string}   strategy
 * @property {object}   strategyInstance
 * @property {number}   score            0-1
 * @property {string}   reason
 * @property {string[]} observations
 */
