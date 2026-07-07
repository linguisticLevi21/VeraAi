'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * FestivalStrategy — fires on festival/seasonal triggers or temporal festival signals.
 * Optimises for: Category Fit, Merchant Fit, Engagement, Specificity.
 */
class FestivalStrategy extends BaseStrategy {
  get name() { return 'festival'; }

  score(context) {
    const { merchant, trigger } = context;
    const isFestivalTrigger = trigger && (
      trigger.kind === 'festival_upcoming' ||
      trigger.kind === 'seasonal_boost' ||
      trigger.kind === 'holiday_promo'
    );

    if (isFestivalTrigger) return 0.88;

    // Temporal scoring — month-based heuristic
    const month = new Date().getMonth() + 1; // 1-based
    const festivalMonths = [4, 5, 10, 11, 12]; // Eid, Diwali, Christmas
    if (festivalMonths.includes(month)) return 0.55;

    return 0;
  }

  compose(context) {
    const { merchant, trigger, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';

    const festival = this._detectFestival(trigger);
    const offers = merchant.offers || [];
    const hasOffer = offers.some((o) => o && (o.status === 'active' || !o.status));
    const offerLabel = hasOffer && offers[0] ? `"${offers[0].title || offers[0].name}"` : null;

    const categoryAngle = this._categoryFestivalAngle(scope, festival.name);

    const body = offerLabel
      ? `${name}, ${festival.name} is approaching and ${categoryAngle}. Your ${offerLabel} offer is well-positioned to capitalise on this — want to highlight it with a ${festival.name} tag to drive visibility this week?`
      : `${name}, ${festival.name} is coming up — ${categoryAngle}. Businesses that add a seasonal offer during this window see a significant spike in footfall. Want to launch a quick ${festival.name} offer today?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `${festival.name} season detected — festival angle drives higher engagement for ${scope}.`,
      suppression_key: `festival:${festival.key}:${merchant.merchantId}`,
    };
  }

  _detectFestival(trigger) {
    if (trigger) {
      const kind = trigger.kind || '';
      if (kind.includes('diwali') || (trigger.festival && trigger.festival.toLowerCase().includes('diwali'))) {
        return { name: 'Diwali', key: 'diwali' };
      }
      if (kind.includes('eid') || (trigger.festival && trigger.festival.toLowerCase().includes('eid'))) {
        return { name: 'Eid', key: 'eid' };
      }
      if (kind.includes('christmas') || kind.includes('xmas')) {
        return { name: 'Christmas', key: 'christmas' };
      }
    }

    // Temporal fallback
    const month = new Date().getMonth() + 1;
    if (month === 10 || month === 11) return { name: 'Diwali', key: 'diwali' };
    if (month === 12) return { name: 'Christmas', key: 'christmas' };
    if (month === 4 || month === 5) return { name: 'Eid', key: 'eid' };
    return { name: 'the upcoming festive season', key: 'festive' };
  }

  _categoryFestivalAngle(scope, festival) {
    const map = {
      dentists: `patients often book smile-enhancement and teeth-whitening appointments before ${festival}`,
      restaurants: `food orders spike 3-4x during ${festival} weekends — combos and family meals perform best`,
      salons: `salon bookings for grooming and beauty services double in the week before ${festival}`,
      gyms: `gym sign-ups spike post-${festival} as people pursue their new-year or post-celebration fitness goals`,
      pharmacies: `pharmacy visits rise sharply before ${festival} for health essentials and gifting combos`,
    };
    return map[scope] || `consumer spending peaks during the ${festival} window`;
  }
}

module.exports = new FestivalStrategy();
