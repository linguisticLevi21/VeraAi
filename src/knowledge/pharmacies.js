'use strict';

/**
 * Pharmacies Category Knowledge
 *
 * Professional, trust-anchored, utility-first voice.
 * Fast delivery and prescription availability are the top conversion drivers.
 */

module.exports = {
  slug: 'pharmacies',

  voice: {
    tone: 'professional_utility',
    pronouns: 'you/your customers',
    hindiEnglishMix: false,
    taboos: ['cure', 'guaranteed healing', 'miracle', 'instant relief', 'no side effects'],
    preferredClosings: [
      'Want to add this to your profile now?',
      'Reply YES to proceed.',
      'Let me know and I will set it up.',
    ],
    contractionExpansion: true, // we've → we have
  },

  peerStats: {
    avgRating: 4.3,
    avgReviews: 41,
    avgCtr: 0.019,
    topPerformerCtr: 0.038,
    scope: 'metro_pharmacies_india',
    repeatPurchaseRate: 0.67,
  },

  offerCatalog: [
    { title: 'Fast Delivery on All Orders (Same Day)', priceHint: null, audience: 'all', urgency: 'high' },
    { title: '10% Off on OTC Medicines', priceHint: '10%', audience: 'regular_customers', urgency: 'medium' },
    { title: 'Free Blood Pressure Check', priceHint: 'free', audience: 'seniors', urgency: 'medium' },
    { title: 'Diabetes Care Combo @ ₹299', priceHint: '₹299', audience: 'diabetics', urgency: 'high' },
    { title: 'Monthly Prescription Refill Service', priceHint: null, audience: 'chronic_patients', urgency: 'high' },
    { title: 'Baby Care Essentials Bundle @ ₹499', priceHint: '₹499', audience: 'parents', urgency: 'medium' },
  ],

  seasonalBeats: [
    { monthRange: 'Jan-Feb', note: 'Winter — cold, flu, and respiratory medicines spike; vitamin D supplements peak' },
    { monthRange: 'Mar-May', note: 'Summer — ORS, electrolytes, sunscreen, and antacids peak' },
    { monthRange: 'Jun-Sep', note: 'Monsoon — anti-allergy, anti-fungal, and mosquito-repellent products spike' },
    { monthRange: 'Oct-Nov', note: 'Festive season — gifting health kits and preventive health packages' },
    { monthRange: 'Nov-Dec', note: 'Chronic disease management season — year-end refills and health check-ups' },
  ],

  triggers: {
    availability: {
      hook: 'Pharmacy customers say "medicine availability" is their #1 decision factor — 72% switch pharmacies after a single out-of-stock experience.',
      cta: 'Want to add a "all common medicines in stock" highlight to your profile today?',
    },
    prescriptions: {
      hook: 'Pharmacies with a prescription refill service retain chronic patients at 2.4x the rate of walk-in-only pharmacies.',
      cta: 'Want to add a monthly refill service highlight to your profile?',
    },
    fastDelivery: {
      hook: 'Pharmacies that highlight same-day delivery drive significantly higher CTR — fast-delivery highlight is the single biggest conversion driver for pharmacy profiles on Magicpin.',
      cta: 'Want to add a fast-delivery or same-day availability highlight right now?',
    },
    customerWinback: {
      hook: 'Pharmacies with a refill-reminder message recover lapsed customers at 2x the rate of general promotions.',
      individual: 'A simple refill or health-check reminder is the highest-converting re-engagement message for pharmacies.',
    },
    festival: {
      diwali: 'Pharmacy visits rise sharply before Diwali for health essentials and gifting health kits — positioning a "health gift combo" can drive significant sales.',
      christmas: 'Year-end health check packages and vitamin supplement bundles are the highest-converting pharmacy offers in December.',
      eid: 'Pre-Eid visits for health essentials and gifting combos present a strong cross-sell opportunity.',
    },
    growth: {
      action: 'Pharmacies that highlight same-day delivery or a health-essential combo consistently recover view drops within 3-4 days.',
      cta: 'Want to add a fast-delivery highlight or a combo offer to your profile now?',
    },
    research: {
      hook: 'Clinical health updates reinforce trust and drive consultations for preventive health products — pharmacies that share health content see 3x more enquiries from repeat customers.',
    },
    milestone: {
      hook: 'Your community trusts you with their health — celebrating a milestone reinforces that bond and drives referrals from satisfied customers.',
    },
  },

  composeHooks: {
    offerExpiry: (offerTitle, daysLeft, discount) =>
      discount
        ? `"${offerTitle}" (${discount}% off) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Pharmacy combo offers on everyday essentials drive repeat same-day visits.`
        : `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renewing it now keeps your pharmacy top-of-mind for customers managing regular health needs.`,

    ctrGap: (ctrStr, peerStr) =>
      `Your click-through rate is ${ctrStr} vs the pharmacy peer average of ${peerStr}. Pharmacies that highlight same-day availability and combo packs drive significantly higher CTR than listing-only profiles.`,

    noOffer: () =>
      'Pharmacies with a visible offer or delivery highlight get 2x more profile clicks than those without. A "Same-Day Delivery" highlight takes under 2 minutes to add.',
  },
};
