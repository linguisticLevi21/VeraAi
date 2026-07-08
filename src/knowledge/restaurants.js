'use strict';

/**
 * Restaurants Category Knowledge
 *
 * Authoritative, reusable data for all restaurant-scope strategy decisions.
 * Strategies pull from this file instead of inlining category-specific strings.
 */

module.exports = {
  slug: 'restaurants',

  voice: {
    tone: 'warm_conversational',
    pronouns: 'you/your',
    hindiEnglishMix: true,
    taboos: ['guaranteed footfall', 'instant results', 'best in city'],
    preferredClosings: ['Want to try this today?', 'Let me know and I'll set it up.', 'Reply YES to proceed.'],
  },

  peerStats: {
    avgRating: 4.1,
    avgReviews: 88,
    avgCtr: 0.022,
    topPerformerCtr: 0.045,
    scope: 'delhi_ncr_restaurants',
  },

  offerCatalog: [
    { title: 'Weekend Family Combo', priceHint: '₹499 for 4', audience: 'families', peak: 'friday_evening' },
    { title: 'Lunch Special @ ₹149', priceHint: '₹149', audience: 'office_crowd', peak: 'weekday_noon' },
    { title: 'Buy 1 Get 1 Free', priceHint: null, audience: 'couples', peak: 'weekend' },
    { title: 'Student Meal Deal', priceHint: '₹99', audience: 'students', peak: 'weekday_evening' },
    { title: 'Free Delivery + 10% Off', priceHint: null, audience: 'online_orders', peak: 'all_day' },
  ],

  seasonalBeats: [
    { monthRange: 'Oct-Nov', note: 'Diwali gifting combos and family dining spike' },
    { monthRange: 'Dec-Jan', note: 'Christmas + New Year party bookings peak' },
    { monthRange: 'Feb', note: 'Valentine\'s Day couple dining — premium menu opportunities' },
    { monthRange: 'Apr-Jun', note: 'Summer drinks, shakes, ice cream combos perform well' },
    { monthRange: 'Jul-Sep', note: 'Monsoon comfort food and hot beverages peak' },
  ],

  triggers: {
    weekend: {
      window: 'Thu-Fri',
      hook: 'Weekend orders on Magicpin spike 2.3x over weekdays for restaurants in your area.',
      cta: 'Want to launch a weekend special today so it\'s live by Friday evening?',
    },
    lunch: {
      window: '10am-12pm',
      hook: 'Lunch-time searches peak between 11am and 1pm — a visible offer at this window gets 40% more clicks.',
      cta: 'Want to set up a quick lunch special that goes live today?',
    },
    delivery: {
      hook: 'Restaurants with a "fast delivery" highlight get 35% more online order CTR than those without.',
      cta: 'Want to add a delivery highlight to your profile now?',
    },
    rating: {
      hook: 'A 0.1-point drop in rating reduces order volume by ~12% for restaurants in your category.',
      cta: 'Want to review and respond to your recent feedback right now?',
    },
    customerWinback: {
      hook: 'Returning diners spend on average 20% more than first-time visitors.',
      individual: 'A "we miss you — here\'s a special for your next visit" message works consistently for restaurants.',
    },
    festival: {
      diwali: 'Food orders spike 3-4x during Diwali weekends — combos and family meals perform best.',
      christmas: 'Christmas Eve dinner bookings are the highest revenue night of the year for most restaurants.',
      eid: 'Eid biryani and family feast packages are the highest-converting offers during the Eid window.',
    },
    growth: {
      action: 'Restaurants that add a weekend combo or a photo update consistently see view recovery within 48-72h.',
      cta: 'Want to add a quick weekend special or a fresh menu photo to boost visibility?',
    },
    performance: {
      recovery: 'Restaurants that act on view drops within 48h recover 3x faster than those that wait.',
      cta: 'Want to add a quick offer or profile update to reverse this trend?',
    },
    research: {
      hook: 'Consumer food-trend reports help restaurants align their menu to what customers are actively searching for.',
    },
    milestone: {
      hook: 'Loyal customers love being part of a restaurant\'s success story.',
    },
  },

  composeHooks: {
    offerExpiry: (offerTitle, daysLeft, discount) =>
      discount
        ? `"${offerTitle}" (${discount}% off) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Food offers shared 48h before the weekend consistently drive the highest weekend footfall.`
        : `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. A well-timed renewal can put you at the top of weekend searches in your area.`,

    ctrGap: (ctrStr, peerStr) =>
      `Your click-through rate is ${ctrStr} vs the restaurant peer average of ${peerStr}. Restaurants that add a weekend combo or offer consistently close this gap within 48-72h.`,

    noOffer: () =>
      'Restaurants with an active offer get 2x more profile clicks than those without. A simple "Lunch Special @ ₹149" takes 2 minutes to set up.',
  },
};
