'use strict';

/**
 * Salons Category Knowledge
 *
 * Warm, trend-aware, aspirational voice. Festival-anchored seasonality.
 * Repeat-visit loyalty is the primary growth lever for salons.
 */

module.exports = {
  slug: 'salons',

  voice: {
    tone: 'warm_aspirational',
    pronouns: 'you/your clients',
    hindiEnglishMix: true,
    taboos: ['cheapest', 'discount', 'cheap services', 'bargain'],
    preferredClosings: [
      'Want to add this to your profile today?',
      'Reply YES and I\'ll set it up.',
      'Let me know and I\'ll draft the caption.',
    ],
  },

  peerStats: {
    avgRating: 4.3,
    avgReviews: 74,
    avgCtr: 0.025,
    topPerformerCtr: 0.050,
    scope: 'metro_salons_india',
    repeatVisitRate: 0.42,
  },

  offerCatalog: [
    { title: 'Haircut + Wash @ ₹299', priceHint: '₹299', audience: 'walk_ins', urgency: 'high' },
    { title: 'Bridal Makeover Package', priceHint: '₹2,499', audience: 'brides', urgency: 'seasonal' },
    { title: 'Keratin Treatment @ ₹999', priceHint: '₹999', audience: 'regular_clients', urgency: 'medium' },
    { title: 'Facial + Head Massage Combo @ ₹499', priceHint: '₹499', audience: 'relaxation', urgency: 'medium' },
    { title: 'Manicure + Pedicure @ ₹399', priceHint: '₹399', audience: 'all', urgency: 'low' },
    { title: 'Student Haircut @ ₹149', priceHint: '₹149', audience: 'students', urgency: 'medium' },
  ],

  seasonalBeats: [
    { monthRange: 'Oct-Nov', note: 'Diwali — grooming, hair colouring, and beauty bookings double in the 2 weeks before' },
    { monthRange: 'Nov-Feb', note: 'Wedding season — bridal packages are the highest-revenue service in this window' },
    { monthRange: 'Feb', note: 'Valentine\'s Day — couples packages and nail art bookings spike' },
    { monthRange: 'Mar-Apr', note: 'Holi + summer preparation — hair treatments and de-tan services perform well' },
    { monthRange: 'Sep-Oct', note: 'Navratri — ethnic look styling and saree draping requests increase' },
  ],

  triggers: {
    festival: {
      diwali: 'Salon bookings for grooming and beauty services double in the week before Diwali — the pre-festival window is your highest-revenue opportunity of the year.',
      christmas: 'Party-season styling and nail art bookings spike through December — festive nail art designs are the most-requested service.',
      eid: 'Pre-Eid grooming and bridal henna appointments are the highest-converting offers for salons during the Eid window.',
    },
    repeatVisits: {
      hook: 'Salons that send seasonal re-engagement messages recover 35% of lapsed clients within a month.',
      individual: 'A personalised "your next treatment is due" message has the highest open rate in the salon category.',
      loyaltyNote: 'Loyal clients who return within 60 days spend 2.5x more per visit than first-time clients.',
    },
    beauty: {
      hook: 'Salons with a seasonal highlight and customer photo posts see 2x the profile views of those without.',
      photoNote: 'Before/after photos are the single highest-converting content type for salons on Magicpin.',
    },
    customerWinback: {
      hook: 'Salons that send seasonal re-engagement messages recover 35% of lapsed clients within a month.',
      individual: 'A "we miss you — here\'s a special for your next visit" message works consistently for salons.',
    },
    growth: {
      action: 'Salons that add a seasonal highlight or a before/after photo post see the fastest view recovery on Magicpin.',
      cta: 'Want to add a seasonal highlight to your profile today?',
    },
    research: {
      hook: 'Beauty and wellness trend reports can directly inform your seasonal service menu — and drive clients to ask for trending services by name.',
    },
    milestone: {
      hook: 'Your regular clients are your biggest growth driver — celebrating a milestone with them deepens loyalty and drives referrals.',
    },
  },

  composeHooks: {
    offerExpiry: (offerTitle, daysLeft, discount) =>
      discount
        ? `"${offerTitle}" (${discount}% off) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Salon seasonal offers with a deadline generate 40% more bookings than open-ended ones.`
        : `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Extending it through the weekend could drive a meaningful booking spike.`,

    ctrGap: (ctrStr, peerStr) =>
      `Your current click-through rate is ${ctrStr} vs the salon peer average of ${peerStr}. Salons with a seasonal highlight and customer photos see 2x the profile views of those without.`,

    noOffer: () =>
      'Salons with an active offer get 60% more profile clicks than those without. A "Haircut + Wash @ ₹299" takes under 2 minutes to set up and is consistently the highest-converting salon offer.',
  },
};
