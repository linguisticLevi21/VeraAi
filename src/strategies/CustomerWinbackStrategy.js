'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * CustomerWinbackStrategy — fires when inactive customers exceed 30% of the base.
 * Optimises for: Decision Quality, Merchant Fit, Expected Reply Probability.
 */
class CustomerWinbackStrategy extends BaseStrategy {
  get name() { return 'customer_winback'; }

  score(context) {
    const { merchant, trigger, customer } = context;
    const isWinbackTrigger = trigger && (trigger.kind === 'recall_due' || trigger.kind === 'winback');

    if (isWinbackTrigger) return 0.92;

    // Score from performance aggregate
    const perf = merchant.performance || {};
    const agg = perf.customer_aggregate || {};
    if (agg.lapsed_180d_plus && agg.total_unique_ytd) {
      const ratio = agg.lapsed_180d_plus / agg.total_unique_ytd;
      if (ratio > 0.5) return 0.88;
      if (ratio > 0.3) return 0.65;
    }

    // Single lapsed customer in context
    if (customer) {
      const lastVisit = customer.last_visit_date || customer.last_visit;
      if (lastVisit) {
        const daysSince = (Date.now() - new Date(lastVisit).getTime()) / 86_400_000;
        if (daysSince > 90) return 0.85;
        if (daysSince > 30) return 0.6;
      }
    }

    return 0;
  }

  compose(context) {
    const { merchant, trigger, customer, category } = context;
    const name = merchant.identity && merchant.identity.name || 'there';
    const scope = merchant.scope || (category && category.slug) || 'unknown';
    const perf = merchant.performance || {};
    const agg = perf.customer_aggregate || {};

    // Prefer single-customer recall if customer context is present
    if (customer && (customer.last_visit_date || customer.last_visit)) {
      return this._singleCustomerCompose(name, customer, merchant, scope);
    }

    // Aggregate recall
    const lapsedCount = agg.lapsed_180d_plus || (trigger && trigger.lapsed_count) || null;
    const topCustomer = agg.top_lapsed_customer || (trigger && trigger.sample_customer) || null;

    const countPhrase = lapsedCount ? `${lapsedCount} of your regular customers haven't visited in 6+ months` : 'A significant portion of your regular customers have gone quiet';
    const example = topCustomer ? ` — including long-time visitors like ${topCustomer}` : '';
    const winback = this._categoryWinback(scope);

    const body = `${name}, ${countPhrase}${example}. ${winback.context} A personalised re-engagement message through Magicpin can bring them back. Want to send a quick recall message to your lapsed customers today?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `${lapsedCount || 'Many'} lapsed customers — winback campaign has the highest ROI for ${scope}.`,
      suppression_key: `winback:recall:${merchant.merchantId}`,
    };
  }

  _singleCustomerCompose(merchantName, customer, merchant, scope) {
    const custName = customer.name || customer.customer_name || 'a loyal customer';
    const lastVisit = customer.last_visit_date || customer.last_visit;
    const daysSince = lastVisit ? Math.round((Date.now() - new Date(lastVisit).getTime()) / 86_400_000) : null;
    const dayPhrase = daysSince ? `hasn't visited in ${daysSince} days` : 'has been inactive recently';
    const winback = this._categoryWinback(scope);

    const body = `${merchantName}, ${custName} ${dayPhrase}. ${winback.individual} A personalised reminder from you through Magicpin can bring them back — want to send a quick recall message?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: `Individual customer lapsed ${daysSince || '30+'} days — high-probability winback opportunity.`,
      suppression_key: `winback:individual:${customer.customer_id || 'cust'}`,
    };
  }

  _categoryWinback(scope) {
    const map = {
      dentists: {
        context: 'Regular checkup reminders have an 80%+ acceptance rate when sent proactively.',
        individual: 'Dental patients respond well to a simple "it\'s been a while — is it time for your checkup?" message.',
      },
      restaurants: {
        context: 'Returning diners spend on average 20% more than first-time visitors.',
        individual: 'A "we miss you — here\'s a special for your next visit" message works consistently well for restaurants.',
      },
      salons: {
        context: 'Salons that send seasonal re-engagement messages recover 35% of lapsed clients within a month.',
        individual: 'A personalised "your next treatment is due" message has the highest open rate in the salon category.',
      },
      gyms: {
        context: 'Gym win-back offers tied to a new class or challenge drive 3x higher re-engagement than generic discount messages.',
        individual: 'A progress-reminder ("you were making great progress — let\'s pick it back up") outperforms discount offers for gym win-backs.',
      },
      pharmacies: {
        context: 'Pharmacies with a refill-reminder message recover lapsed customers at 2x the rate of general promotions.',
        individual: 'A simple refill or health-check reminder is the highest-converting re-engagement message for pharmacies.',
      },
    };
    return map[scope] || {
      context: 'Re-engaging lapsed customers costs 5x less than acquiring new ones.',
      individual: 'A brief personalised check-in from a trusted business drives strong re-engagement.',
    };
  }
}

module.exports = new CustomerWinbackStrategy();
