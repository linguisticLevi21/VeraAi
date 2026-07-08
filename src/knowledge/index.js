'use strict';

/**
 * Category Knowledge Index
 *
 * Unified accessor for all category knowledge files.
 * Strategies call `getKnowledge(scope)` instead of importing category
 * files directly — this keeps strategies decoupled from the file layout.
 *
 * Usage:
 *   const { getKnowledge } = require('../knowledge');
 *   const k = getKnowledge('restaurants');
 *   const hook = k.triggers.weekend.hook;
 */

const _registry = new Map([
  ['restaurants', () => require('./restaurants')],
  ['dentists',    () => require('./dentists')],
  ['salons',      () => require('./salons')],
  ['gyms',        () => require('./gyms')],
  ['pharmacies',  () => require('./pharmacies')],
]);

// Lazy cache — modules loaded once on first getKnowledge() call per scope
const _cache = new Map();

/**
 * Returns the knowledge object for a given category slug.
 * Returns a safe default object if the scope is unknown.
 *
 * @param {string} scope  — category slug: 'restaurants' | 'dentists' | 'salons' | 'gyms' | 'pharmacies'
 * @returns {object}      — category knowledge object
 */
function getKnowledge(scope) {
  if (!scope) return _defaultKnowledge();

  const normalized = (scope || '').toLowerCase().trim();
  if (_cache.has(normalized)) return _cache.get(normalized);

  const loader = _registry.get(normalized);
  if (!loader) return _defaultKnowledge(normalized);

  const knowledge = loader();
  _cache.set(normalized, knowledge);
  return knowledge;
}

/**
 * Returns all registered category slugs.
 * @returns {string[]}
 */
function allSlugs() {
  return [..._registry.keys()];
}

/**
 * Safe default for unknown categories.
 * Prevents strategies from crashing on novel category slugs.
 */
function _defaultKnowledge(slug = 'unknown') {
  return {
    slug,
    voice: {
      tone: 'warm_conversational',
      hindiEnglishMix: true,
      taboos: [],
      preferredClosings: ['Reply YES to proceed.'],
      contractionExpansion: false,
    },
    peerStats: { avgCtr: 0.020, avgRating: 4.0, avgReviews: 50 },
    offerCatalog: [],
    seasonalBeats: [],
    triggers: {
      festival: { diwali: 'Consumer spending peaks during the Diwali window.' },
      growth: {
        action: 'Businesses that proactively update their profile and run time-bound offers see the fastest CTR recovery.',
        cta: 'Want to add a quick offer or profile update to boost visibility?',
      },
      customerWinback: {
        hook: 'Re-engaging lapsed customers costs 5x less than acquiring new ones.',
        individual: 'A brief personalised check-in from a trusted business drives strong re-engagement.',
      },
      research: { hook: 'Industry research helps you stay ahead of what customers expect.' },
      milestone: { hook: 'Your customers are part of this journey.' },
    },
    composeHooks: {
      offerExpiry: (offerTitle, daysLeft) =>
        `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Timely offers are the single biggest driver of CTR improvement on Magicpin.`,
      ctrGap: (ctrStr, peerStr) =>
        `Your click-through rate is ${ctrStr} vs the peer average of ${peerStr}. Updating your profile and adding a time-bound offer is the fastest way to close this gap.`,
      noOffer: () =>
        'Businesses with an active offer get 2x more profile clicks than those without. A simple offer takes under 2 minutes to set up.',
    },
  };
}

module.exports = { getKnowledge, allSlugs };
