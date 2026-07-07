'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * CampaignStrategy — fires when there is an active or recently-completed campaign.
 * Optimises for: Merchant Fit, Business Impact, Engagement.
 */
class CampaignStrategy extends BaseStrategy {
  get name() { return 'campaign'; }

  score(context) {
    const { merchant, trigger } = context;
    const campaigns = merchant.campaigns || [];
    const hasCampaign = campaigns.some((c) => c.status === 'active' || c.status === 'underperforming');
    const isRelevantTrigger = trigger && (trigger.kind === 'campaign_boost' || trigger.kind === 'campaign_update');

    if (!hasCampaign && !isRelevantTrigger) return 0;

    let score = 0.5;
    if (campaigns.some((c) => c.status === 'underperforming')) score += 0.3;
    if (isRelevantTrigger && trigger.urgency >= 2) score += 0.2;
    return Math.min(score, 1.0);
  }

  compose(context) {
    const { merchant, category } = context;
    const campaigns = merchant.campaigns || [];
    const active = campaigns.find((c) => c.status === 'active') || campaigns[0];
    const name = merchant.identity && merchant.identity.name || 'there';
    const catVoice = this._categoryVoice(merchant.scope || (category && category.slug));

    const campaignName = active && active.name ? active.name : 'your current campaign';
    const metric = active && active.clicks ? `${active.clicks} clicks` : null;

    let body;
    if (active && active.status === 'underperforming') {
      body = `${name}, your "${campaignName}" campaign is running but hasn't picked up pace yet.${metric ? ` It's at ${metric} so far.` : ''} ${catVoice.boost} — want to adjust the budget or extend it by 2 days to catch the weekend crowd?`;
    } else {
      body = `${name}, your "${campaignName}" campaign is live. ${catVoice.running} Want to check how it's performing and decide the next move?`;
    }

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: 'Active campaign needs attention or optimisation.',
      suppression_key: `campaign:${active && active.id || 'active'}`,
    };
  }

  _categoryVoice(scope) {
    const voices = {
      dentists: { boost: 'Dental promotions perform best mid-week with professional framing', running: 'Appointment-focused campaigns can see a 2x lift with the right timing.' },
      restaurants: { boost: 'Food campaigns convert best near meal times', running: 'Weekend combos typically drive the highest order volume.' },
      salons: { boost: 'Beauty campaigns see the highest CTR when tied to a seasonal occasion', running: 'Festival-linked offers can double repeat bookings.' },
      gyms: { boost: 'Gym campaigns work best at month-end renewal windows', running: 'Membership campaigns with a free-trial hook out-convert discount campaigns 2:1.' },
      pharmacies: { boost: 'Health campaigns convert best with urgency and availability messaging', running: 'Fast-delivery highlights are the top driver for pharmacy CTR.' },
    };
    return voices[scope] || { boost: 'A small budget boost can recover momentum', running: 'Monitoring conversion helps time the next decision.' };
  }
}

module.exports = new CampaignStrategy();
