'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * FollowUpStrategy — fires when a merchant replied YES (affirmative) and Vera must deliver the promised value.
 * Also handles clarification questions from the merchant.
 * Optimises for: Replay Robustness, Engagement, Conversation Continuity.
 */
class FollowUpStrategy extends BaseStrategy {
  get name() { return 'follow_up'; }

  score(context) {
    const { merchant } = context;
    const history = merchant.conversationHistory || [];
    const lastMsg = history[history.length - 1];

    if (!lastMsg || lastMsg.speaker !== 'merchant') return 0;
    if (lastMsg.intent === 'affirmative' || lastMsg.intent === 'intent_join') return 0.95;
    if (lastMsg.intent === 'question') return 0.88;
    return 0;
  }

  compose(context) {
    const { merchant, trigger, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';
    const history = merchant.conversationHistory || [];
    const lastMsg = history[history.length - 1];

    // Find what Vera's last outbound message promised
    const lastVeraMsg = [...history].reverse().find((m) => m.speaker === 'vera');

    if (lastMsg && lastMsg.intent === 'question') {
      return this._composeAnswer(name, scope, lastMsg, lastVeraMsg, merchant);
    }

    return this._composeDelivery(name, scope, lastVeraMsg, merchant, trigger);
  }

  _composeDelivery(name, scope, lastVeraMsg, merchant, trigger) {
    const offers = merchant.offers || [];
    const activeOffer = offers.find((o) => o && (o.status === 'active' || !o.status));
    const offerLabel = activeOffer ? `"${activeOffer.title || activeOffer.name}"` : null;

    // Deliver the most relevant asset based on what was promised
    const delivery = this._categoryDelivery(scope, offerLabel, trigger);

    const body = `${name}, great — here's what I've prepared for you. ${delivery.content} ${delivery.nextStep}`;

    return {
      strategy: this.name,
      body,
      cta: 'open_ended',
      reason: 'Merchant affirmed — delivering the promised value immediately.',
      suppression_key: `followup:delivery:${merchant.merchantId}`,
    };
  }

  _composeAnswer(name, scope, questionMsg, lastVeraMsg, merchant) {
    const answer = this._categoryAnswer(scope, questionMsg.body);
    const body = `${name}, ${answer.response} ${answer.redirect}`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: 'Merchant asked a question — answering precisely and re-stating the CTA.',
      suppression_key: `followup:answer:${merchant.merchantId}`,
    };
  }

  _categoryDelivery(scope, offerLabel, trigger) {
    const digestFinding = trigger && trigger.digest && trigger.digest.key_finding;

    const map = {
      dentists: {
        content: digestFinding
          ? `The key finding: "${digestFinding}". I've also drafted a 90-second patient-education WhatsApp message your front desk can send to your active patients.`
          : `Here's a ready-to-send patient-education message for your WhatsApp: "Preventive care is the most powerful tool in dental health — book your checkup this week."`,
        nextStep: 'Would you like me to customise it further with your clinic name and contact?',
      },
      restaurants: {
        content: offerLabel
          ? `Your ${offerLabel} offer is already live — I've drafted a WhatsApp message your team can send to your customer list: "Weekend is here! ${offerLabel} — valid today and tomorrow. Order now!"`
          : `Here's a ready-to-send weekend special message: "Weekend Special: [Your Dish] Combo at [Price]. Book your table or order online now!"`,
        nextStep: 'Want me to personalise it with your restaurant name and timings?',
      },
      salons: {
        content: `Here's a seasonal highlight caption for your profile: "Celebrate the season with a fresh look — book your [Service] this week and get [Benefit]."`,
        nextStep: 'Want me to tailor this with your specific service and offer details?',
      },
      gyms: {
        content: `Here's a ready-to-send member motivation message: "Your progress is real — come back this week and let's build on it. Drop-in sessions available, no questions asked."`,
        nextStep: 'Want me to add your gym name and a specific class time to make it feel personal?',
      },
      pharmacies: {
        content: `Here's a quick availability highlight you can post: "Fast delivery on everyday essentials — order before 6pm and get it delivered the same evening."`,
        nextStep: 'Want me to customise this with your specific products or delivery window?',
      },
    };

    return map[scope] || {
      content: 'Here is a ready-to-use message template based on your profile. You can send it as-is or ask me to tailor it.',
      nextStep: 'Want me to customise it for your specific audience?',
    };
  }

  _categoryAnswer(scope, question) {
    // Generic answer logic — stays mission-focused regardless of question topic
    const lowerQ = (question || '').toLowerCase();
    const isHowQuestion = lowerQ.includes('how') || lowerQ.includes('kaise');
    const isWhatQuestion = lowerQ.includes('what') || lowerQ.includes('kya');
    const isCostQuestion = lowerQ.includes('cost') || lowerQ.includes('price') || lowerQ.includes('kitna');

    if (isCostQuestion) {
      return {
        response: 'the cost depends on the plan you choose — the starter option is free and takes about 2 minutes to set up.',
        redirect: 'Want me to walk you through the quick setup right now?',
      };
    }
    if (isHowQuestion) {
      return {
        response: `it works in 3 steps: (1) you confirm your interest, (2) we set up the action together, (3) you see the result in your Magicpin dashboard within 24h.`,
        redirect: 'Want to start step 1 right now — it takes 60 seconds?',
      };
    }
    if (isWhatQuestion) {
      const scopeWhat = {
        dentists: 'the action is a patient-education post on your Magicpin profile that drives appointment enquiries',
        restaurants: 'the action is a weekend combo offer that puts you at the top of weekend food searches in your area',
        salons: 'the action is a seasonal highlight that drives profile views and direct bookings',
        gyms: 'the action is a free-trial offer that consistently drives new member sign-ups',
        pharmacies: 'the action is a fast-delivery highlight that drives same-day order conversions',
      };
      return {
        response: scopeWhat[scope] || 'the action is a targeted visibility boost on your Magicpin profile that drives direct conversions',
        redirect: 'Want to proceed with setting it up now?',
      };
    }

    return {
      response: `great question — the short answer is that this works specifically for ${scope} businesses by connecting the right message to the right customer at the right moment.`,
      redirect: 'Want to see it in action for your business? Reply YES to proceed.',
    };
  }
}

module.exports = new FollowUpStrategy();
