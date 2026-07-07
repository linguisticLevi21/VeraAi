'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * PerformanceRecoveryStrategy — fires when views are declining or CTR is critically below peers.
 * Optimises for: Decision Quality, Business Impact, Merchant Fit.
 */
class PerformanceRecoveryStrategy extends BaseStrategy {
  get name() { return 'performance_recovery'; }

  score(context) {
    const { merchant, trigger } = context;
    const perf = merchant.performance || {};
    const metrics = merchant.metrics || {};
    const isPerfTrigger = trigger && (trigger.kind === 'perf_drop' || trigger.kind === 'perf_spike');
    const viewsDelta = perf.delta_7d && perf.delta_7d.views_pct;
    const ctr = metrics.currentCtr;
    const peerCtr = metrics.peerMedianCtr;

    if (isPerfTrigger && trigger.kind === 'perf_drop') return 0.92;
    if (viewsDelta !== null && viewsDelta !== undefined && viewsDelta < -0.2) return 0.88;
    if (ctr !== null && ctr !== undefined && peerCtr !== null && peerCtr !== undefined && ctr < peerCtr * 0.5) return 0.82;

    return 0;
  }

  compose(context) {
    const { merchant, trigger, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';
    const perf = merchant.performance || {};
    const metrics = merchant.metrics || {};

    const viewsDelta = perf.delta_7d && perf.delta_7d.views_pct;
    const ctr = metrics.currentCtr;
    const peerCtr = metrics.peerMedianCtr;
    const views = perf.views || metrics.totalViews;

    // Compose the diagnosis line from real data
    let diagnosisLine;
    if (viewsDelta !== null && viewsDelta !== undefined && viewsDelta < 0) {
      const pct = Math.abs(Math.round(viewsDelta * 100));
      diagnosisLine = `your profile views dropped ${pct}% last week`;
    } else if (ctr && peerCtr) {
      const ctrStr = (ctr * 100).toFixed(1);
      const peerStr = (peerCtr * 100).toFixed(1);
      diagnosisLine = `your click-through rate (${ctrStr}%) is currently below the ${scope} average (${peerStr}%)`;
    } else if (trigger && trigger.current_views && trigger.previous_views) {
      const drop = trigger.previous_views - trigger.current_views;
      diagnosisLine = `your profile views fell by ${drop} this week`;
    } else {
      diagnosisLine = 'your profile performance has softened recently';
    }

    const recoveryPlan = this._categoryRecoveryPlan(scope);

    const body = `${name}, ${diagnosisLine}. ${recoveryPlan.diagnosis}. ${recoveryPlan.action}`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `Performance declining — ${diagnosisLine}. Recovery action is time-sensitive.`,
      suppression_key: `recovery:perf:${merchant.merchantId}`,
    };
  }

  _categoryRecoveryPlan(scope) {
    const map = {
      dentists: {
        diagnosis: 'Dental clinics that refresh their service list and add one new patient-education post typically see a 25-40% CTR recovery within a week',
        action: 'Want to quickly add a new service or post to turn this around?',
      },
      restaurants: {
        diagnosis: 'Restaurants that add a weekend special or a photo update consistently see view recovery within 48-72h',
        action: 'Want to add a quick weekend special or a fresh menu photo to boost visibility?',
      },
      salons: {
        diagnosis: 'Salons that add a seasonal highlight or a before/after photo post see the fastest view recovery on Magicpin',
        action: 'Want to add a seasonal highlight to your profile today?',
      },
      gyms: {
        diagnosis: 'Gyms that launch a free-trial or challenge offer during a slow period recover views 2x faster than those that do nothing',
        action: 'Want to launch a quick free-trial offer to break the decline?',
      },
      pharmacies: {
        diagnosis: 'Pharmacies that highlight same-day delivery or a health-essential combo consistently recover view drops within 3-4 days',
        action: 'Want to add a fast-delivery highlight or a combo offer to your profile now?',
      },
    };
    return map[scope] || {
      diagnosis: 'Businesses that act quickly on view drops — by updating their profile or adding an offer — recover 3x faster than those that wait',
      action: 'Want to add a quick offer or profile update to reverse this trend?',
    };
  }
}

module.exports = new PerformanceRecoveryStrategy();
