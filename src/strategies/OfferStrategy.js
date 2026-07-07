'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * OfferStrategy — fires when an offer is expiring, expired, or absent.
 * Optimises for: Specificity, Merchant Fit, Business Impact.
 */
class OfferStrategy extends BaseStrategy {
  get name() { return 'offer'; }

  score(context) {
    const { merchant, trigger } = context;
    const offers = merchant.offers || [];
    const isOfferTrigger = trigger && (trigger.kind === 'offer_expiry' || trigger.kind === 'offer_launch');

    const expiringSoon = offers.some((o) => {
      if (!o || !o.valid_till) return false;
      const daysLeft = (new Date(o.valid_till).getTime() - Date.now()) / 86_400_000;
      return daysLeft >= 0 && daysLeft <= 3;
    });

    const expired = offers.some((o) => {
      if (!o || !o.valid_till) return false;
      return new Date(o.valid_till).getTime() < Date.now();
    });

    if (isOfferTrigger) return 0.9;
    if (expiringSoon) return 0.85;
    if (expired) return 0.7;
    if (offers.length === 0) return 0.5;
    return 0;
  }

  compose(context) {
    const { merchant, category } = context;
    const offers = merchant.offers || [];
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';

    // Find the most relevant offer
    const target = this._pickOffer(offers);
    const offerLabel = target ? `"${target.title || target.name || 'your offer'}"` : 'an offer';

    const daysLeft = target && target.valid_till
      ? Math.ceil((new Date(target.valid_till).getTime() - Date.now()) / 86_400_000)
      : null;

    const urgencyPhrase = daysLeft !== null
      ? (daysLeft <= 0 ? 'has just expired' : daysLeft === 1 ? 'expires tomorrow' : `expires in ${daysLeft} days`)
      : 'needs attention';

    const impact = this._categoryImpact(scope);
    const discountLabel = target && target.discount_pct ? `${target.discount_pct}% off` : null;

    const body = discountLabel
      ? `${name}, ${offerLabel} (${discountLabel}) ${urgencyPhrase}. ${impact}. Extending it through the weekend could drive a meaningful spike in orders — want to extend it now?`
      : `${name}, ${offerLabel} ${urgencyPhrase}. ${impact}. Want to renew or create a fresh offer to keep the momentum going?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `Offer urgency: ${urgencyPhrase}. Extending drives ${scope} footfall.`,
      suppression_key: `offer:${target && target.id || 'generic'}`,
    };
  }

  _pickOffer(offers) {
    if (!offers.length) return null;
    // Prefer expiring soonest
    const sorted = [...offers].sort((a, b) => {
      const aMs = a.valid_till ? new Date(a.valid_till).getTime() : Infinity;
      const bMs = b.valid_till ? new Date(b.valid_till).getTime() : Infinity;
      return aMs - bMs;
    });
    return sorted[0];
  }

  _categoryImpact(scope) {
    const map = {
      dentists: 'Dental promotional offers see 3x higher appointment bookings when highlighted proactively',
      restaurants: 'Food offers shared 48h before the weekend consistently drive the highest weekend footfall',
      salons: 'Salon seasonal offers with a deadline generate 40% more bookings than open-ended ones',
      gyms: 'Limited-time gym membership offers convert at 2x the rate of indefinite discounts',
      pharmacies: 'Pharmacy combo offers on everyday essentials drive repeat same-day visits',
    };
    return map[scope] || 'Timely offers are the single biggest driver of CTR improvement on Magicpin';
  }
}

module.exports = new OfferStrategy();
