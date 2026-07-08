'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * EngagementStrategy — fires when a research digest or educational trigger is available.
 * The "Vera as a trusted advisor" play: share relevant industry content to open a conversation.
 * Optimises for: Specificity, Category Fit, Expected Reply Probability.
 */
class EngagementStrategy extends BaseStrategy {
  get name() { return 'engagement'; }

  score(context) {
    const { trigger } = context;
    if (!trigger) return 0;
    const kind = trigger.kind || trigger.type || '';
    if (kind === 'research_digest' || kind === 'industry_update' || kind === 'peer_benchmark') return 0.85;
    if (kind === 'milestone' || kind === 'celebration') return 0.7;
    if (kind === 'perf_spike') return 0.75; // celebrate a performance spike
    return 0;
  }

  compose(context) {
    const { merchant, trigger, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';
    const kind = trigger && (trigger.kind || trigger.type);

    if (kind === 'research_digest') {
      return this._composeResearchDigest(name, scope, merchant, trigger);
    }
    if (kind === 'peer_benchmark') {
      return this._composePeerBenchmark(name, scope, merchant, trigger);
    }
    if (kind === 'milestone' || kind === 'celebration') {
      return this._composeMilestone(name, scope, merchant, trigger);
    }

    // Default: research digest fallback
    return this._composeResearchDigest(name, scope, merchant, trigger);
  }

  _composeResearchDigest(name, scope, merchant, trigger) {
    const digest = trigger && trigger.digest || {};
    const publication = digest.publication || (trigger && trigger.source) || `the latest ${scope} research`;
    const finding = digest.key_finding || (trigger && trigger.headline) || null;
    const categoryHook = this._categoryResearchHook(scope);

    const body = finding
      ? `${name}, ${publication} just published a finding directly relevant to your practice: "${finding}". ${categoryHook}. Want me to send you the full abstract or a quick patient-facing summary?`
      : `${name}, ${publication} has a new piece directly relevant to ${scope} businesses like yours. ${categoryHook}. Want me to share the key takeaway and a ready-to-use patient/customer message?`;

    return {
      strategy: this.name,
      body,
      cta: 'open_ended',
      reason: `Research digest on ${scope} topic — educational content drives highest quality engagement.`,
      suppression_key: `research:${scope}:${trigger && trigger.id || 'digest'}`,
    };
  }

  _composePeerBenchmark(name, scope, merchant, trigger) {
    const metrics = merchant.metrics || {};
    const ctr = metrics.currentCtr;
    const peerCtr = metrics.peerMedianCtr;
    const ctrLine = (ctr && peerCtr)
      ? `Your CTR is ${(ctr * 100).toFixed(1)}% vs a ${scope} peer median of ${(peerCtr * 100).toFixed(1)}%.`
      : `Here is how similar ${scope} businesses are performing on Magicpin right now.`;

    const body = `${name}, ${ctrLine} ${this._peerBenchmarkHook(scope)}. Want to see the full benchmark breakdown and the top 3 actions that are moving the needle for peers?`;

    return {
      strategy: this.name,
      body,
      cta: 'open_ended',
      reason: 'Peer benchmark trigger — data-driven positioning drives high merchant interest.',
      suppression_key: `benchmark:${scope}:${merchant.merchantId}`,
    };
  }

  _composeMilestone(name, scope, merchant, trigger) {
    const milestone = trigger && trigger.milestone || 'a new milestone';
    const body = `${name}, congratulations — you've just hit ${milestone}! ${this._milestoneHook(scope)}. Want to celebrate this with a quick post or a special offer for your loyal customers?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: 'Milestone celebration — positive engagement with high reply probability.',
      suppression_key: `milestone:${trigger && trigger.id || 'generic'}:${merchant.merchantId}`,
    };
  }

  _categoryResearchHook(scope) {
    const map = {
      dentists: 'Sharing clinical research with your patients establishes your clinic as a trusted, evidence-based practice',
      restaurants: 'Consumer food-trend reports help restaurants align their menu to what customers are actively searching for',
      salons: 'Beauty and wellness trend reports can directly inform your seasonal service menu',
      gyms: 'Fitness research helps members see you as a knowledge leader, not just a facility',
      pharmacies: 'Clinical health updates reinforce trust and drive consultations for preventive health products',
    };
    return map[scope] || 'Industry research helps you stay ahead of what customers expect from businesses like yours';
  }

  _peerBenchmarkHook(scope) {
    const map = {
      dentists: 'Top-performing dental clinics are driving 3x more appointments by combining professional content with a proactive follow-up sequence',
      restaurants: 'The highest-ranking restaurants in your area are leveraging weekend combo offers and photo updates to stay top-of-mind',
      salons: 'Leading salons are using seasonal highlights and customer photo tags to dominate search results',
      gyms: 'Top gyms are combining free-trial offers with member success stories to drive both acquisition and renewals',
      pharmacies: 'High-performing pharmacies are distinguishing themselves with fast-delivery highlights and preventive health content',
    };
    return map[scope] || 'Top performers are consistently updating their profiles and running time-bound offers';
  }

  _milestoneHook(scope) {
    const map = {
      dentists: 'Your patients are part of this achievement — celebrating it reinforces loyalty',
      restaurants: 'Loyal customers love being part of a restaurant\'s success story',
      salons: 'Your regular clients are your biggest growth driver — celebrating with them deepens loyalty',
      gyms: 'Your members\' journeys are your biggest asset — celebrate their role in this',
      pharmacies: 'Your community trusts you — sharing this milestone reinforces that bond',
    };
    return map[scope] || 'Your customers are part of this journey';
  }
}

module.exports = new EngagementStrategy();
