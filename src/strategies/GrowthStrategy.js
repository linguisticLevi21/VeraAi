'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * GrowthStrategy — fires when merchant CTR or views are below peers with no active campaign.
 * Optimises for: Decision Quality, Category Fit, Business Impact.
 */
class GrowthStrategy extends BaseStrategy {
  get name() { return 'growth'; }

  score(context) {
    const { merchant } = context;
    const metrics = merchant.metrics || {};
    const ctr = metrics.currentCtr;
    const peerCtr = metrics.peerMedianCtr;
    const campaigns = merchant.campaigns || [];
    const hasActiveCampaign = campaigns.some((c) => c.status === 'active');

    if (hasActiveCampaign) return 0; // CampaignStrategy owns this case

    if (ctr !== null && ctr !== undefined && peerCtr !== null && peerCtr !== undefined) {
      const ratio = ctr / peerCtr;
      if (ratio < 0.5) return 0.9;
      if (ratio < 0.8) return 0.7;
    }

    const perf = merchant.performance || {};
    const viewsDelta = perf.delta_7d && perf.delta_7d.views_pct;
    if (viewsDelta !== null && viewsDelta !== undefined && viewsDelta < -0.1) return 0.65;

    return 0;
  }

  compose(context) {
    const { merchant, category } = context;
    const metrics = merchant.metrics || {};
    const ctr = metrics.currentCtr;
    const peerCtr = metrics.peerMedianCtr;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';

    const ctrStr = ctr !== null && ctr !== undefined ? `${(ctr * 100).toFixed(1)}%` : null;
    const peerStr = peerCtr !== null && peerCtr !== undefined ? `${(peerCtr * 100).toFixed(1)}%` : null;

    const gapLine = (ctrStr && peerStr)
      ? `Your current click-through rate is ${ctrStr} vs the ${scope} peer average of ${peerStr}.`
      : 'Your visibility on Magicpin is lower than similar businesses in your area.';

    const action = this._categoryGrowthAction(scope);

    const body = `${name}, ${gapLine} ${action.description}. ${action.cta_text}`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `CTR below peer median (${ctrStr} vs ${peerStr}) — growth action recommended.`,
      suppression_key: `growth:visibility:${merchant.merchantId}`,
    };
  }

  _categoryGrowthAction(scope) {
    const map = {
      dentists: {
        description: 'Clinics that update their service list and add a patient-education highlight see a 30-40% CTR improvement within a week',
        cta_text: 'Want to add a quick post or refresh your service list today?',
      },
      restaurants: {
        description: 'Restaurants that add a weekend combo offer consistently rank in the top 10 in their area within 48 hours',
        cta_text: 'Want to launch a weekend special to close the gap?',
      },
      salons: {
        description: 'Salons with a seasonal highlight and customer photo posts see 2x the profile views of those without',
        cta_text: 'Want to add a seasonal highlight to your profile today?',
      },
      gyms: {
        description: 'Gyms that run a free-trial offer during month-end windows consistently outperform peers on new-member acquisition',
        cta_text: 'Want to launch a free-trial offer to drive enquiries this week?',
      },
      pharmacies: {
        description: 'Pharmacies that highlight same-day availability and combo packs drive significantly higher CTR than listing-only profiles',
        cta_text: 'Want to add a fast-delivery or combo-pack highlight to your profile?',
      },
    };
    return map[scope] || {
      description: 'Businesses that proactively update their profile and add a time-bound offer see the fastest CTR recovery',
      cta_text: 'Want to add a quick offer or profile update to boost visibility?',
    };
  }
}

module.exports = new GrowthStrategy();
