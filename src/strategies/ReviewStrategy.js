'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * ReviewStrategy — fires when a rating drop or review spike is detected.
 * Optimises for: Decision Quality, Category Fit, Merchant Fit.
 */
class ReviewStrategy extends BaseStrategy {
  get name() { return 'review'; }

  score(context) {
    const { merchant, trigger } = context;
    const perf = merchant.performance || {};
    const rawSignals = perf.signals || [];
    const isReviewTrigger = trigger && (trigger.kind === 'review_alert' || trigger.kind === 'rating_drop');

    if (isReviewTrigger) return 0.9;

    const hasRatingDrop = rawSignals.some((s) => typeof s === 'string' && s.includes('rating_drop'));
    const hasReviewSpike = rawSignals.some((s) => typeof s === 'string' && s.includes('review_spike'));

    if (hasRatingDrop) return 0.88;
    if (hasReviewSpike) return 0.72;
    return 0;
  }

  compose(context) {
    const { merchant, trigger, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';
    const perf = merchant.performance || {};
    const rawSignals = perf.signals || [];

    const isRatingDrop = rawSignals.some((s) => typeof s === 'string' && s.includes('rating_drop'))
      || (trigger && trigger.kind === 'rating_drop');

    const rating = perf.avg_rating || (trigger && trigger.current_rating) || null;
    const prevRating = (trigger && trigger.previous_rating) || null;
    const reviewCount = perf.review_count || (trigger && trigger.new_reviews) || null;

    const categoryAdvice = this._categoryReviewAdvice(scope);

    let body;
    if (isRatingDrop && rating && prevRating) {
      body = `${name}, your Magicpin rating has dropped from ${prevRating} to ${rating}. ${categoryAdvice.drop}. Responding to the most recent reviews within 24h can recover your rating quickly — want help drafting a response?`;
    } else if (isRatingDrop && rating) {
      body = `${name}, your Magicpin rating is at ${rating}. ${categoryAdvice.drop}. Responding promptly to recent reviews is the fastest way to recover trust — want to view and respond to them now?`;
    } else if (reviewCount) {
      body = `${name}, you've received ${reviewCount} new reviews recently. ${categoryAdvice.spike}. Acknowledging them shows responsiveness and can improve your rating — want to reply to them now?`;
    } else {
      body = `${name}, there has been recent review activity on your profile. ${categoryAdvice.spike}. Responding quickly shows customers you care — want to check and reply now?`;
    }

    return {
      strategy: this.name,
      body,
      cta: 'open_ended',
      reason: `Rating/review signal detected — review response improves ranking and trust for ${scope}.`,
      suppression_key: `review:response:${merchant.merchantId}`,
    };
  }

  _categoryReviewAdvice(scope) {
    const map = {
      dentists: {
        drop: 'For dental clinics, a drop in rating directly impacts appointment booking rates — patients rely heavily on peer reviews before booking',
        spike: 'Dental patients value professional, empathetic responses — acknowledging feedback publicly builds long-term trust',
      },
      restaurants: {
        drop: 'For restaurants, ratings below 4.0 reduce order volume by up to 30% — a quick response to negative reviews often reverses the trend',
        spike: 'Restaurant reviews with owner responses see higher revisit intent from customers',
      },
      salons: {
        drop: 'Salon ratings are highly visible in search results — responding to negative feedback shows professionalism and care',
        spike: 'Customer reviews with photos and responses generate 2x more profile views for salons',
      },
      gyms: {
        drop: 'Gym ratings directly affect new-member sign-up decisions — a proactive response can recover 20-30% of lost enquiries',
        spike: 'Members who see owner responses on reviews feel more valued and are more likely to renew',
      },
      pharmacies: {
        drop: 'Pharmacy ratings are a primary trust signal — responding within 24h demonstrates commitment to customer health',
        spike: 'Pharmacy customers who see prompt responses to reviews are significantly more likely to make repeat purchases',
      },
    };
    return map[scope] || {
      drop: 'Ratings directly affect discoverability on Magicpin — responding quickly prevents further ranking drops',
      spike: 'Businesses that respond to reviews within 24h see significantly better long-term ratings',
    };
  }
}

module.exports = new ReviewStrategy();
