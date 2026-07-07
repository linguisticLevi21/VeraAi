'use strict';

/**
 * MessageComposer — finalises and validates the message before it leaves the engine.
 *
 * Responsibilities:
 *   1. Receive the raw output from a strategy's compose() call
 *   2. Apply the Anti-Generic System — reject or rewrite messages that contain
 *      generic/placeholder language
 *   3. Enforce the single-CTA rule
 *   4. Apply category voice (tone, formality)
 *   5. Assemble the final structured output shape expected by the API
 *
 * Rules:
 *   - NEVER invent metrics, names, offers, or facts
 *   - NEVER include generic greetings ("Hope you're doing well")
 *   - Every message must contain: WHY NOW → BUSINESS VALUE → SINGLE CTA
 */
class MessageComposer {
  /**
   * Finalises a composed message from a strategy.
   *
   * @param {object} composed         - Raw output from strategy.compose()
   * @param {object} merchant         - MerchantMemory
   * @param {object|null} trigger     - TriggerContext
   * @param {object|null} category    - CategoryContext
   * @param {import('./InferenceEngine').Observation[]} observations
   * @param {object} rankerResult     - { best: ScoredCandidate, scored: [] }
   * @returns {FinalAction}
   */
  finalise(composed, merchant, trigger, category, observations, rankerResult) {
    const { body, cta, reason, suppression_key, strategy } = composed;

    // Anti-generic check
    const cleanBody = this._antiGeneric(body, merchant, category);

    // CTA enforcement
    const resolvedCta = this._resolveCta(cta);

    // Category voice adjustment
    const voicedBody = this._applyVoice(cleanBody, merchant.scope || (category && category.slug));

    // Build final structured output
    const action = {
      message: voicedBody,
      strategy,
      chosen_trigger: trigger && trigger.id || null,
      reason,
      confidence: rankerResult && rankerResult.best ? parseFloat(rankerResult.best.total.toFixed(3)) : 0.5,
      merchant_state: merchant.merchantState || 'UNKNOWN',
      cta: resolvedCta,
      suppression_key: suppression_key || `${strategy}:${merchant.merchantId}`,
      metadata: {
        strategy,
        dims: rankerResult && rankerResult.best ? rankerResult.best.dims : {},
        observations: observations.slice(0, 3).map((o) => o.observation),
        merchantScope: merchant.scope,
        triggerKind: trigger && trigger.kind || null,
        composedAt: new Date().toISOString(),
      },
    };

    return action;
  }

  // ---------------------------------------------------------------------------
  // Anti-generic system
  // ---------------------------------------------------------------------------

  /**
   * Detects generic language and replaces or rejects it.
   * If the body is too generic, appends a grounding note.
   *
   * @param {string} body
   * @param {object} merchant
   * @param {object|null} category
   * @returns {string}
   */
  _antiGeneric(body, merchant, category) {
    const BLOCKED_PHRASES = [
      'hope you\'re doing well',
      'hope you are doing well',
      'just checking in',
      'how are you',
      'greetings',
      'dear merchant',
      'hello merchant',
      'hi merchant',
      'you should improve sales',
      'improve your business',
      'generic marketing',
      'hope this message finds you',
      'touching base',
      'reaching out to you',
    ];

    const lower = (body || '').toLowerCase();
    const hasGeneric = BLOCKED_PHRASES.some((phrase) => lower.includes(phrase));

    if (hasGeneric) {
      // Strip the offending phrase and prepend with merchant name + context anchor
      let cleaned = body;
      for (const phrase of BLOCKED_PHRASES) {
        const regex = new RegExp(phrase, 'gi');
        cleaned = cleaned.replace(regex, '');
      }
      cleaned = cleaned.trim().replace(/^[,.\s]+/, '').trim();

      const name = merchant.identity && merchant.identity.name || '';
      const anchor = name ? `${name}, ` : '';
      return `${anchor}${cleaned}`;
    }

    return body;
  }

  // ---------------------------------------------------------------------------
  // CTA enforcement — exactly one
  // ---------------------------------------------------------------------------

  _resolveCta(cta) {
    const valid = ['open_ended', 'binary', 'none'];
    return valid.includes(cta) ? cta : 'open_ended';
  }

  // ---------------------------------------------------------------------------
  // Category voice
  // ---------------------------------------------------------------------------

  /**
   * Adjusts tone to match the category's communication style.
   * Dentists/Pharmacies: professional and trust-based.
   * Restaurants/Salons/Gyms: warm, motivating, conversational.
   *
   * @param {string} body
   * @param {string} scope
   * @returns {string}
   */
  _applyVoice(body, scope) {
    if (!body) return body;

    // Professional scopes — avoid contractions, keep formal
    const professionalScopes = ['dentists', 'pharmacies'];
    if (professionalScopes.includes(scope)) {
      // Handle both straight (') and curly (\u2019) apostrophes
      return body
        .replace(/we[\u2019']ve/gi, 'we have')
        .replace(/we[\u2019']re/gi, 'we are')
        .replace(/it[\u2019']s/gi, 'it is')
        .replace(/that[\u2019']s/gi, 'that is')
        .replace(/can[\u2019']t/gi, 'cannot')
        .replace(/don[\u2019']t/gi, 'do not')
        .replace(/won[\u2019']t/gi, 'will not')
        .replace(/I[\u2019']ve/g, 'I have')
        .replace(/I[\u2019']m/g, 'I am');
    }

    // Conversational scopes — no change needed
    return body;
  }
}

// Singleton export
module.exports = new MessageComposer();

/**
 * @typedef {object} FinalAction
 * @property {string}   message
 * @property {string}   strategy
 * @property {string|null} chosen_trigger
 * @property {string}   reason
 * @property {number}   confidence
 * @property {string}   merchant_state
 * @property {string}   cta
 * @property {string}   suppression_key
 * @property {object}   metadata
 */
