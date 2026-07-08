'use strict';

/**
 * SignalExtractor — extracts semantically meaningful signals from raw merchant memory.
 *
 * Each signal is:
 * {
 *   type:       string   — machine-readable signal identifier
 *   priority:   number   — 1 (critical) → 5 (low)
 *   confidence: number   — 0–1, how certain we are this signal is real
 *   timestamp:  string   — ISO-8601 when this signal was first detected
 *   source:     string   — which memory field produced this signal
 *   value:      any      — the raw underlying value for downstream use
 * }
 *
 * Signals drive InferenceEngine observations, which in turn drive strategy selection.
 * No randomness. Every signal is derived from deterministic data in memory.
 */
class SignalExtractor {
  /**
   * Extracts all meaningful signals from a merchant memory object.
   *
   * @param {object} merchant      - Full MerchantMemory from MemoryStore
   * @param {object|null} category - CategoryContext payload
   * @param {object|null} trigger  - TriggerContext payload
   * @param {object|null} customer - CustomerContext payload (if relevant)
   * @param {string} now           - Simulated current time (ISO-8601)
   * @returns {Signal[]}
   */
  extract(merchant, category, trigger, customer, now) {
    const signals = [];
    const nowMs = new Date(now || Date.now()).getTime();
    // Use simulated now for all signal timestamps — critical for deterministic replay
    const nowIso = new Date(nowMs).toISOString();

    this._extractPerformanceSignals(merchant, category, signals, nowMs, nowIso);
    this._extractOfferSignals(merchant, signals, nowMs, nowIso);
    this._extractCampaignSignals(merchant, signals, nowMs, nowIso);
    this._extractConversationSignals(merchant, signals, nowMs, nowIso);
    this._extractCustomerSignals(merchant, customer, signals, nowMs, nowIso);
    this._extractTriggerSignals(trigger, signals, nowMs, nowIso);
    this._extractTemporalSignals(signals, nowMs, nowIso);

    // Sort by priority ascending (1 = most critical first)
    return signals.sort((a, b) => a.priority - b.priority);
  }

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------

  _extractPerformanceSignals(merchant, category, signals, nowMs, nowIso) {
    const perf = merchant.performance || {};
    const metrics = merchant.metrics || {};

    // CTR vs peer median
    const ctr = metrics.currentCtr || perf.ctr;
    const peerCtr = metrics.peerMedianCtr || (category && category.peer_stats && category.peer_stats.avg_ctr);

    if (ctr !== null && ctr !== undefined && peerCtr !== null && peerCtr !== undefined) {
      const ratio = ctr / peerCtr;
      if (ratio < 0.5) {
        signals.push(this._signal('ctr_critically_below_peer', 1, 0.95, 'performance.ctr', { ctr, peerCtr, ratio }, nowIso));
      } else if (ratio < 0.8) {
        signals.push(this._signal('ctr_below_peer', 2, 0.9, 'performance.ctr', { ctr, peerCtr, ratio }, nowIso));
      } else if (ratio >= 1.5) {
        signals.push(this._signal('ctr_high_performing', 3, 0.9, 'performance.ctr', { ctr, peerCtr, ratio }, nowIso));
      }
    }

    // Views trend
    const viewsDelta = perf.delta_7d && perf.delta_7d.views_pct;
    if (viewsDelta !== undefined && viewsDelta !== null) {
      if (viewsDelta < -0.2) {
        signals.push(this._signal('views_declining', 1, 0.9, 'performance.delta_7d', { viewsDelta }, nowIso));
      } else if (viewsDelta < -0.05) {
        signals.push(this._signal('views_softening', 3, 0.8, 'performance.delta_7d', { viewsDelta }, nowIso));
      } else if (viewsDelta > 0.15) {
        signals.push(this._signal('views_growing', 4, 0.85, 'performance.delta_7d', { viewsDelta }, nowIso));
      }
    }

    // Raw signals array from the judge dataset
    const rawSignals = perf.signals || merchant.identity && merchant.identity.signals || [];
    for (const s of rawSignals) {
      if (typeof s !== 'string') continue;
      if (s.includes('stale_posts')) signals.push(this._signal('stale_posts', 2, 0.85, 'performance.signals', { raw: s }, nowIso));
      if (s.includes('high_cancellation')) signals.push(this._signal('high_cancellation', 2, 0.9, 'performance.signals', { raw: s }, nowIso));
      if (s.includes('review_spike')) signals.push(this._signal('review_spike', 2, 0.8, 'performance.signals', { raw: s }, nowIso));
      if (s.includes('rating_drop')) signals.push(this._signal('rating_dropped', 1, 0.95, 'performance.signals', { raw: s }, nowIso));
    }

    // Views absolute
    const views = perf.views || metrics.totalViews;
    if (views !== undefined && views !== null && views < 100) {
      signals.push(this._signal('low_visibility', 2, 0.8, 'performance.views', { views }, nowIso));
    }
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------

  _extractOfferSignals(merchant, signals, nowMs, nowIso) {
    const offers = merchant.offers || [];

    for (const offer of offers) {
      if (!offer) continue;

      const expiry = offer.valid_till || offer.expiry || offer.end_date;
      if (expiry) {
        const expiryMs = new Date(expiry).getTime();
        const daysLeft = (expiryMs - nowMs) / 86_400_000;
        if (daysLeft < 0) {
          signals.push(this._signal('offer_expired', 2, 1.0, 'offers', { offerId: offer.id, title: offer.title }, nowIso));
        } else if (daysLeft <= 1) {
          signals.push(this._signal('offer_expiring_soon', 1, 0.95, 'offers', { offerId: offer.id, title: offer.title, daysLeft: Math.round(daysLeft * 24) + 'h' }, nowIso));
        } else if (daysLeft <= 3) {
          signals.push(this._signal('offer_expiring_in_3d', 2, 0.9, 'offers', { offerId: offer.id, title: offer.title, daysLeft: Math.ceil(daysLeft) }, nowIso));
        }
      }

      if (offer.status === 'inactive' || offer.status === 'draft') {
        signals.push(this._signal('offer_not_live', 3, 0.9, 'offers', { offerId: offer.id, title: offer.title }, nowIso));
      }
    }

    if (offers.length === 0) {
      signals.push(this._signal('no_active_offers', 3, 0.85, 'offers', {}, nowIso));
    }
  }

  // ---------------------------------------------------------------------------
  // Campaigns
  // ---------------------------------------------------------------------------

  _extractCampaignSignals(merchant, signals, nowMs, nowIso) {
    const campaigns = merchant.campaigns || [];

    for (const campaign of campaigns) {
      if (!campaign) continue;
      if (campaign.status === 'active') {
        signals.push(this._signal('campaign_running', 3, 1.0, 'campaigns', { campaignId: campaign.id, name: campaign.name }, nowIso));
      }
      if (campaign.status === 'completed') {
        signals.push(this._signal('campaign_completed', 4, 0.9, 'campaigns', { campaignId: campaign.id, name: campaign.name }, nowIso));
      }
      if (campaign.status === 'underperforming') {
        signals.push(this._signal('campaign_underperforming', 2, 0.85, 'campaigns', { campaignId: campaign.id }, nowIso));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------------

  _extractConversationSignals(merchant, signals, nowMs, nowIso) {
    const history = merchant.conversationHistory || [];
    if (history.length === 0) return;

    const lastMsg = history[history.length - 1];

    if (lastMsg.speaker === 'vera') {
      const sentMs = new Date(lastMsg.storedAt || lastMsg.timestamp).getTime();
      const hoursElapsed = (nowMs - sentMs) / 3_600_000;

      if (hoursElapsed > 48) {
        signals.push(this._signal('conversation_stalled', 2, 0.9, 'conversationHistory', { hoursElapsed: Math.round(hoursElapsed) }, nowIso));
      } else if (hoursElapsed > 24) {
        signals.push(this._signal('merchant_not_replied_24h', 3, 0.8, 'conversationHistory', { hoursElapsed: Math.round(hoursElapsed) }, nowIso));
      }
    }

    if (lastMsg.speaker === 'merchant' && lastMsg.isAutoReply) {
      signals.push(this._signal('merchant_auto_reply', 2, 0.95, 'conversationHistory', {}, nowIso));
    }

    if (lastMsg.intent === 'affirmative') {
      signals.push(this._signal('merchant_replied_yes', 1, 0.95, 'conversationHistory', { body: lastMsg.body }, nowIso));
    }
    if (lastMsg.intent === 'negative') {
      signals.push(this._signal('merchant_replied_no', 1, 1.0, 'conversationHistory', { body: lastMsg.body }, nowIso));
    }
    if (lastMsg.intent === 'question') {
      signals.push(this._signal('merchant_asked_question', 1, 0.9, 'conversationHistory', { body: lastMsg.body }, nowIso));
    }
    if (lastMsg.intent === 'intent_join') {
      signals.push(this._signal('merchant_intent_join', 1, 0.95, 'conversationHistory', { body: lastMsg.body }, nowIso));
    }
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  _extractCustomerSignals(merchant, customer, signals, nowMs, nowIso) {
    const perf = merchant.performance || {};
    const agg = perf.customer_aggregate || {};

    if (agg.lapsed_180d_plus && agg.total_unique_ytd) {
      const lapsedRatio = agg.lapsed_180d_plus / agg.total_unique_ytd;
      if (lapsedRatio > 0.5) {
        signals.push(this._signal('inactive_customers', 1, 0.9, 'performance.customer_aggregate', { lapsedRatio: lapsedRatio.toFixed(2), count: agg.lapsed_180d_plus }, nowIso));
      } else if (lapsedRatio > 0.3) {
        signals.push(this._signal('some_customers_inactive', 3, 0.8, 'performance.customer_aggregate', { lapsedRatio: lapsedRatio.toFixed(2) }, nowIso));
      }
    }

    if (customer) {
      const lastVisit = customer.last_visit_date || customer.last_visit;
      if (lastVisit) {
        const daysSince = (nowMs - new Date(lastVisit).getTime()) / 86_400_000;
        if (daysSince > 90) {
          signals.push(this._signal('customer_long_inactive', 1, 0.95, 'customer.last_visit', { customerId: customer.customer_id, daysSince: Math.round(daysSince) }, nowIso));
        } else if (daysSince > 30) {
          signals.push(this._signal('customer_inactive_30d', 2, 0.85, 'customer.last_visit', { customerId: customer.customer_id, daysSince: Math.round(daysSince) }, nowIso));
        }
      }

      if (customer.objection) {
        signals.push(this._signal('customer_objection', 1, 1.0, 'customer.objection', { objection: customer.objection }, nowIso));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------------------

  _extractTriggerSignals(trigger, signals, nowMs, nowIso) {
    if (!trigger) return;

    const kind = trigger.kind || trigger.type;
    if (kind) {
      signals.push(this._signal(`trigger_${kind}`, 2, 1.0, 'trigger.kind', { triggerId: trigger.id, kind }, nowIso));
    }

    const urgency = trigger.urgency;
    if (urgency !== undefined) {
      if (urgency >= 3) signals.push(this._signal('trigger_high_urgency', 1, 1.0, 'trigger.urgency', { urgency }, nowIso));
      else if (urgency === 2) signals.push(this._signal('trigger_medium_urgency', 2, 1.0, 'trigger.urgency', { urgency }, nowIso));
    }

    const expiresAt = trigger.expires_at || trigger.valid_till;
    if (expiresAt) {
      const hoursLeft = (new Date(expiresAt).getTime() - nowMs) / 3_600_000;
      if (hoursLeft < 0) {
        signals.push(this._signal('trigger_expired', 1, 1.0, 'trigger.expires_at', { expiresAt }, nowIso));
      } else if (hoursLeft < 24) {
        signals.push(this._signal('trigger_expiring_soon', 1, 0.95, 'trigger.expires_at', { hoursLeft: Math.round(hoursLeft) }, nowIso));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Temporal
  // ---------------------------------------------------------------------------

  _extractTemporalSignals(signals, nowMs, nowIso) {
    const d = new Date(nowMs);
    const dayOfWeek = d.getDay(); // 0=Sun 6=Sat

    if (dayOfWeek === 4 || dayOfWeek === 5) { // Thu/Fri
      signals.push(this._signal('weekend_approaching', 4, 1.0, 'temporal', { dayOfWeek }, nowIso));
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      signals.push(this._signal('weekend_active', 3, 1.0, 'temporal', { dayOfWeek }, nowIso));
    }

    // Festival window heuristic — Diwali (Oct/Nov), Eid (Apr/May), Christmas (Dec)
    const month = d.getMonth() + 1; // 1-based
    if (month === 10 || month === 11) {
      signals.push(this._signal('festival_season_diwali', 2, 0.75, 'temporal', { month }, nowIso));
    }
    if (month === 12) {
      signals.push(this._signal('festival_season_christmas', 3, 0.8, 'temporal', { month }, nowIso));
    }
    if (month === 4 || month === 5) {
      signals.push(this._signal('festival_season_eid', 3, 0.7, 'temporal', { month }, nowIso));
    }
  }

  // ---------------------------------------------------------------------------
  // Factory helper
  // ---------------------------------------------------------------------------

  /**
   * @param {string} nowIso - Simulated current time (ISO-8601). Always pass this — never use new Date().
   */
  _signal(type, priority, confidence, source, value, nowIso) {
    return {
      type,
      priority,
      confidence,
      timestamp: nowIso || new Date().toISOString(), // fallback only if called outside extract()
      source,
      value: value || {},
    };
  }
}

module.exports = new SignalExtractor();

/**
 * @typedef {object} Signal
 * @property {string} type
 * @property {number} priority       1=critical 5=low
 * @property {number} confidence     0-1
 * @property {string} timestamp
 * @property {string} source
 * @property {any}    value
 */
