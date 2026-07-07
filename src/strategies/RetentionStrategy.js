'use strict';

const BaseStrategy = require('./BaseStrategy');

/**
 * RetentionStrategy — fires when conversation has stalled or merchant hasn't replied.
 * Optimises for: Replay Robustness, Engagement, Conversation Continuity.
 */
class RetentionStrategy extends BaseStrategy {
  get name() { return 'retention'; }

  score(context) {
    const { merchant } = context;
    const history = merchant.conversationHistory || [];
    if (history.length === 0) return 0;

    const lastMsg = history[history.length - 1];
    if (lastMsg.speaker !== 'vera') return 0;

    const sentMs = new Date(lastMsg.storedAt || lastMsg.timestamp || Date.now()).getTime();
    const hoursElapsed = (Date.now() - sentMs) / 3_600_000;

    if (hoursElapsed > 48) return 0.85;
    if (hoursElapsed > 24) return 0.6;
    return 0;
  }

  compose(context) {
    const { merchant, category } = context;
    const history = merchant.conversationHistory || [];
    const lastOut = [...history].reverse().find((m) => m.speaker === 'vera');
    const name = merchant.identity && merchant.identity.name || 'there';

    const prevCta = lastOut && lastOut.cta ? lastOut.cta : null;
    const prevBody = lastOut && lastOut.body ? lastOut.body.slice(0, 60) + '…' : null;

    const categoryNudge = this._categoryNudge(merchant.scope || (category && category.slug));

    const body = prevBody
      ? `${name}, following up on our earlier conversation — ${prevBody} ${categoryNudge}. A quick reply helps us personalise the next step for you. Reply YES to proceed or NO to skip.`
      : `${name}, we had reached out with a recommendation that could help. ${categoryNudge}. Would you like to pick it up now?`;

    return {
      strategy: this.name,
      body,
      cta: 'binary',
      reason: 'Merchant has not replied in >24h — follow-up to recover the conversation.',
      suppression_key: `retention:followup:${merchant.merchantId}`,
    };
  }

  _categoryNudge(scope) {
    const map = {
      dentists: 'The window for the patient-ed content we discussed is still open',
      restaurants: 'Weekend orders are picking up and your offer is still live',
      salons: 'The seasonal promotion window closes this weekend',
      gyms: 'Month-end renewal window is approaching — a nudge to members now can help',
      pharmacies: 'The fast-delivery highlight we discussed is still relevant',
    };
    return map[scope] || 'The opportunity we discussed is still available';
  }
}

module.exports = new RetentionStrategy();
