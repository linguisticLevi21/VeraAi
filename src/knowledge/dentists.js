'use strict';

/**
 * Dentists Category Knowledge
 *
 * Clinical-peer voice. Factual, evidence-based, trust-anchored.
 * Legal taboos strictly enforced. Source citations required.
 */

module.exports = {
  slug: 'dentists',

  voice: {
    tone: 'peer_clinical',
    pronouns: 'you/your patients',
    hindiEnglishMix: false, // professional English preferred
    taboos: ['cure', 'guaranteed', 'best dentist', 'no pain', '100% safe', 'instant'],
    preferredClosings: [
      'Want me to share the full abstract?',
      'Reply YES to proceed.',
      'Would you like me to customise this for your clinic?',
    ],
    contractionExpansion: true, // we've → we have, it's → it is
  },

  peerStats: {
    avgRating: 4.4,
    avgReviews: 62,
    avgCtr: 0.030,
    topPerformerCtr: 0.055,
    scope: 'delhi_solo_practices',
    source: 'Magicpin Dentist Benchmark Q1 2026',
  },

  offerCatalog: [
    { title: 'Dental Cleaning @ ₹299', priceHint: '₹299', audience: 'new_patients', urgency: 'medium' },
    { title: 'Free Consultation', priceHint: 'free', audience: 'new_patients', urgency: 'high' },
    { title: 'Teeth Whitening @ ₹1,499', priceHint: '₹1,499', audience: 'cosmetic', urgency: 'low' },
    { title: 'Dental Cleaning + X-Ray @ ₹499', priceHint: '₹499', audience: 'comprehensive', urgency: 'medium' },
    { title: 'Children\'s Dental Check-Up @ ₹199', priceHint: '₹199', audience: 'families', urgency: 'medium' },
  ],

  seasonalBeats: [
    { monthRange: 'Nov-Feb', note: 'Exam-stress bruxism spike — patients present with jaw pain and tooth grinding' },
    { monthRange: 'Oct-Dec', note: 'Wedding whitening peak — pre-wedding dental appointments surge' },
    { monthRange: 'Mar-May', note: 'Pre-summer checkup window — families book annual cleanings' },
    { monthRange: 'Jun-Aug', note: 'School holidays — children\'s dental checkups spike' },
  ],

  digestSources: [
    'JIDA (Journal of the Indian Dental Association)',
    'DCI (Dental Council of India)',
    'Dental Tribune India',
    'IDA Delhi Calendar',
    'Journal of Clinical Dentistry',
  ],

  triggers: {
    appointment: {
      hook: 'Dental clinics that send appointment reminders 24h before see 35% fewer no-shows.',
      cta: 'Want to set up an automated reminder sequence for tomorrow\'s appointments?',
    },
    preventiveCare: {
      hook: 'Preventive care reduces emergency dental visits by 40% (JIDA Oct 2026). Patients who receive proactive education book recall appointments at 2.5x the rate of those who do not.',
      cta: 'Want me to draft a patient-education WhatsApp message your front desk can send today?',
    },
    trust: {
      hook: 'Dental patients rely on peer reviews before booking 78% of the time. A 0.1-point rating drop reduces appointment bookings by ~15%.',
      cta: 'Want to respond to your most recent reviews right now?',
    },
    customerWinback: {
      hook: 'Regular checkup reminders have an 80%+ acceptance rate when sent proactively.',
      individual: 'A simple "it\'s been a while — is it time for your checkup?" message has the highest open rate in the dental category.',
    },
    festival: {
      diwali: 'Patients often book smile-enhancement and teeth-whitening appointments before Diwali — the pre-festival window peaks 2 weeks before.',
      christmas: 'End-of-year dental visits spike as patients use up annual insurance benefits before December 31.',
      eid: 'Pre-Eid smile and teeth-whitening bookings are the highest-converting seasonal offer for dental clinics.',
    },
    growth: {
      action: 'Dental clinics that refresh their service list and add a patient-education post typically see a 25-40% CTR recovery within a week.',
      cta: 'Want to quickly add a new service or post to turn this around?',
    },
    research: {
      hook: 'Sharing clinical research with your patients establishes your clinic as a trusted, evidence-based practice — and drives 3x more appointment enquiries from health-conscious patients.',
      patientEdTemplate: 'Preventive care is the most powerful tool in dental health — book your checkup this week.',
    },
    milestone: {
      hook: 'Your patients are part of this achievement — celebrating it reinforces loyalty and drives referrals.',
    },
  },

  composeHooks: {
    offerExpiry: (offerTitle, daysLeft, discount) =>
      discount
        ? `"${offerTitle}" (${discount}% off) expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Dental promotional offers see 3x higher appointment bookings when highlighted proactively.`
        : `"${offerTitle}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Extending it now keeps your clinic top-of-mind for patients considering their annual checkup.`,

    ctrGap: (ctrStr, peerStr) =>
      `Your current click-through rate is ${ctrStr} vs the dental clinic peer average of ${peerStr}. Clinics that update their service list and add a patient-education highlight see a 30-40% CTR improvement within a week.`,

    noOffer: () =>
      'Dental clinics with an active promotional offer get significantly more profile clicks than those with listings only. A "Free Consultation" offer takes under 2 minutes to set up.',
  },
};
