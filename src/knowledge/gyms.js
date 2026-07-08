'use strict';

/**
 * Gyms Category Knowledge
 *
 * Motivational, results-driven voice. Membership renewals and
 * new-member acquisition are the two highest-value outcomes.
 */

module.exports = {
  slug: 'gyms',

  voice: {
    tone: 'motivational_direct',
    pronouns: 'you/your members',
    hindiEnglishMix: true,
    taboos: ['lose weight fast', 'guaranteed results', 'magic formula', 'instant transformation'],
    preferredClosings: [
      'Reply YES and I\'ll set it up today.',
      'Want to launch this before the weekend?',
      'Let me know — this takes 2 minutes.',
    ],
  },

  peerStats: {
    avgRating: 4.2,
    avgReviews: 56,
    avgCtr: 0.018,
    topPerformerCtr: 0.040,
    scope: 'metro_gyms_india',
    renewalRate: 0.58,
    freeTrial_conv_rate: 0.34,
  },

  offerCatalog: [
    { title: 'Free 7-Day Trial', priceHint: 'free', audience: 'new_members', urgency: 'high' },
    { title: 'Monthly Membership @ ₹999', priceHint: '₹999', audience: 'all', urgency: 'high' },
    { title: 'Quarterly Plan @ ₹2,499', priceHint: '₹2,499', audience: 'committed', urgency: 'medium' },
    { title: 'Annual Membership @ ₹7,999', priceHint: '₹7,999', audience: 'long_term', urgency: 'low' },
    { title: 'Couple Membership @ ₹1,499/mo', priceHint: '₹1,499', audience: 'couples', urgency: 'medium' },
    { title: 'Personal Training Package (10 sessions) @ ₹3,999', priceHint: '₹3,999', audience: 'premium', urgency: 'low' },
  ],

  seasonalBeats: [
    { monthRange: 'Jan', note: 'New Year resolution spike — highest new-member acquisition month of the year' },
    { monthRange: 'Mar-Apr', note: 'Pre-summer body prep — short-term memberships and weight-loss programmes spike' },
    { monthRange: 'Sep-Oct', note: 'Post-monsoon fitness return — members who lapsed over monsoon reconnect' },
    { monthRange: 'Oct-Nov', note: 'Pre-Diwali fitness motivation — short-term goals drive sign-ups' },
    { monthRange: 'Dec', note: 'Year-end gift memberships and corporate wellness packages' },
  ],

  triggers: {
    renewal: {
      window: 'end_of_month',
      hook: 'Gym membership renewals peak in the last 5 days of the month — members who receive a proactive reminder renew at 2.3x the rate of those who do not.',
      cta: 'Want to send a renewal reminder to your expiring members today?',
      urgency: 'Month-end renewal window is open — acting now captures members before they lapse.',
    },
    fitnessPlan: {
      hook: 'Members with a documented fitness plan renew at 1.8x the rate of those without one.',
      cta: 'Want to set up a quick 30-day challenge post to drive engagement this week?',
    },
    motivation: {
      hook: 'Gym members who receive a personal check-in message after a 7-day absence return within 48h 60% of the time.',
      individual: 'A progress-reminder ("you were making great progress — let\'s pick it back up") outperforms discount offers for gym win-backs.',
    },
    customerWinback: {
      hook: 'Gym win-back offers tied to a new class or challenge drive 3x higher re-engagement than generic discount messages.',
      individual: 'A "we noticed you\'ve been away — here\'s a free week to ease back in" message has the highest conversion rate for gym win-backs.',
    },
    festival: {
      diwali: 'Gym sign-ups spike post-Diwali as members pursue their fitness goals with fresh motivation after the festive season.',
      christmas: 'Year-end gym memberships and gift memberships are the highest-converting offers in December.',
      eid: 'Post-Eid fitness motivation is strong — a "start fresh" campaign performs well in the week after.',
    },
    growth: {
      action: 'Gyms that launch a free-trial or challenge offer during a slow period recover views 2x faster than those that do nothing.',
      cta: 'Want to launch a quick free-trial offer to break the decline?',
    },
    research: {
      hook: 'Fitness research helps members see you as a knowledge leader, not just a facility — and drives 2x more engagement on educational posts vs promotional ones.',
    },
    milestone: {
      hook: 'Your members\' journeys are your biggest asset — celebrating a gym milestone with them reinforces loyalty and drives referrals.',
    },
  },

  composeHooks: {
    offerExpiry: (offerTitle, daysLeft, discount) =>
      discount
        ? `"${offerTitle}" (${discount}% off) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Limited-time gym membership offers convert at 2x the rate of indefinite discounts.`
        : `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. The month-end renewal window is open — extending this offer captures members before they lapse.`,

    ctrGap: (ctrStr, peerStr) =>
      `Your click-through rate is ${ctrStr} vs the gym peer average of ${peerStr}. Gyms that run a free-trial offer during month-end windows consistently outperform peers on new-member acquisition.`,

    noOffer: () =>
      'Gyms with a free-trial offer get 3x more enquiries than those with listings only. A "Free 7-Day Trial" takes under 2 minutes to set up and converts new members at a 34% rate.',
  },
};
