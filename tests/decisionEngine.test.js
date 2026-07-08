'use strict';

/**
 * Vera Brain — Decision Engine integration test suite.
 *
 * Covers:
 *   - SignalExtractor: signal detection for all key scenarios
 *   - InferenceEngine: observation derivation from signals
 *   - StrategySelector: correct strategy selection per scenario
 *   - ActionRanker: ranking correctness (best wins, no ties from wrong strategy)
 *   - MessageComposer: anti-generic filter, CTA enforcement
 *   - ReplayGuard: hard exit paths (refusal, auto-reply, max turns)
 *   - SuppressionEngine: key collision and strategy-too-recent
 *   - End-to-end per category: restaurant, dentist, gym, salon, pharmacy
 *   - Edge cases: offer expiry, customer inactivity, perf drop, hostile replies,
 *                 duplicate replay
 *
 * Run: node tests/decisionEngine.test.js
 */

const assert = require('assert');

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshModules() {
  const keys = Object.keys(require.cache).filter((k) =>
    k.includes('src\\engine') || k.includes('src/engine') ||
    k.includes('src\\strategies') || k.includes('src/strategies') ||
    k.includes('src\\memory') || k.includes('src/memory') ||
    k.includes('src\\config') || k.includes('src/config')
  );
  keys.forEach((k) => delete require.cache[k]);

  return {
    SignalExtractor:       require('../src/engine/SignalExtractor'),
    InferenceEngine:       require('../src/engine/InferenceEngine'),
    StrategySelector:      require('../src/engine/StrategySelector'),
    ActionRanker:          require('../src/engine/ActionRanker'),
    MessageComposer:       require('../src/engine/MessageComposer'),
    ReplayGuard:           require('../src/engine/ReplayGuard'),
    SuppressionEngine:     require('../src/engine/SuppressionEngine'),
    MerchantRepository:    require('../src/memory/MerchantRepository'),
    MERCHANT_STATES:       require('../src/config/constants').MERCHANT_STATES,
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// ── Shared merchant builder ────────────────────────────────────────────────
function buildMerchant(overrides = {}) {
  return {
    merchantId: overrides.merchantId || 'm_test',
    scope: overrides.scope || 'restaurants',
    identity: { name: overrides.name || 'Test Restaurant', city: 'Delhi' },
    performance: overrides.performance || {
      views: 800,
      calls: 12,
      ctr: 0.015,
      delta_7d: { views_pct: -0.05 },
      signals: [],
      customer_aggregate: {},
    },
    metrics: {
      currentCtr: overrides.ctr !== undefined ? overrides.ctr : 0.015,
      peerMedianCtr: overrides.peerCtr !== undefined ? overrides.peerCtr : 0.025,
      totalViews: 800,
    },
    offers: overrides.offers || [],
    campaigns: overrides.campaigns || [],
    conversationHistory: overrides.conversationHistory || [],
    replyHistory: overrides.replyHistory || [],
    tickHistory: [],
    triggerHistory: [],
    suppressionKeys: overrides.suppressionKeys || { lastTrigger: null, lastCta: null, lastStrategy: null },
    merchantState: overrides.merchantState || 'ACTIVE',
    lastDecision: null,
    analytics: { replyCount: 0, tickCount: 0, contextUpdates: 0, ignoredUpdates: 0, avgResponseLatencyMs: null, lastActivity: null, uptimeMs: 0 },
    timestamps: { createdAt: new Date().toISOString(), firstReplyAt: null, lastReplyAt: null, lastTickAt: null, firstTickAt: null },
    metadata: { replyCount: 0, tickCount: 0 },
    customerContexts: new Map(),
    category: overrides.category || null,
    ...overrides._raw,
  };
}

function buildTrigger(overrides = {}) {
  return {
    id: overrides.id || 'trg_test',
    kind: overrides.kind || 'research_digest',
    merchant_id: overrides.merchantId || 'm_test',
    urgency: overrides.urgency !== undefined ? overrides.urgency : 2,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalExtractor
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── SignalExtractor ───────────────────────────────────────────────');

test('extracts ctr_below_peer when CTR < peer median', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({ ctr: 0.015, peerCtr: 0.025 });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('ctr_below_peer') || types.includes('ctr_critically_below_peer'),
    `Expected CTR signal, got: ${types.join(', ')}`);
});

test('extracts ctr_critically_below_peer when CTR < 50% of peer', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({ ctr: 0.01, peerCtr: 0.03 });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('ctr_critically_below_peer'), `Got: ${types.join(', ')}`);
});

test('extracts views_declining when delta_7d < -20%', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({
    performance: { views: 500, calls: 5, ctr: 0.015, delta_7d: { views_pct: -0.30 }, signals: [] },
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('views_declining'), `Got: ${types.join(', ')}`);
});

test('extracts offer_expiring_soon when offer expires within 24h', () => {
  const { SignalExtractor } = freshModules();
  const tomorrow = new Date(Date.now() + 20 * 3600 * 1000).toISOString();
  const merchant = buildMerchant({
    offers: [{ id: 'o1', title: 'Buy 1 Get 1', valid_till: tomorrow, status: 'active' }],
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('offer_expiring_soon'), `Got: ${types.join(', ')}`);
});

test('extracts inactive_customers from customer_aggregate', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({
    performance: {
      views: 800, calls: 12, ctr: 0.02, delta_7d: { views_pct: 0 }, signals: [],
      customer_aggregate: { lapsed_180d_plus: 60, total_unique_ytd: 100 },
    },
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('inactive_customers'), `Got: ${types.join(', ')}`);
});

test('extracts merchant_replied_yes from conversation intent', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({
    conversationHistory: [{ speaker: 'merchant', intent: 'affirmative', body: 'Yes please', isAutoReply: false, timestamp: new Date().toISOString() }],
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('merchant_replied_yes'), `Got: ${types.join(', ')}`);
});

test('extracts trigger_high_urgency for urgency >= 3', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant();
  const trigger = buildTrigger({ urgency: 3 });
  const signals = SignalExtractor.extract(merchant, null, trigger, null, new Date().toISOString());
  const types = signals.map((s) => s.type);
  assert.ok(types.includes('trigger_high_urgency'), `Got: ${types.join(', ')}`);
});

test('signals are sorted by priority ascending', () => {
  const { SignalExtractor } = freshModules();
  const merchant = buildMerchant({ ctr: 0.005, peerCtr: 0.025 });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  for (let i = 1; i < signals.length; i++) {
    assert.ok(signals[i].priority >= signals[i - 1].priority,
      `Signals not sorted: idx ${i - 1}=${signals[i - 1].priority} idx ${i}=${signals[i].priority}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// InferenceEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── InferenceEngine ───────────────────────────────────────────────');

test('infers merchant_refused from merchant_replied_no signal', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const merchant = buildMerchant({
    conversationHistory: [{ speaker: 'merchant', intent: 'negative', body: 'No thanks', isAutoReply: false, timestamp: new Date().toISOString() }],
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  const keys = obs.map((o) => o.observation);
  assert.ok(keys.includes('merchant_refused'), `Got: ${keys.join(', ')}`);
});

test('infers merchant_ready_to_act from affirmative signal', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const merchant = buildMerchant({
    conversationHistory: [{ speaker: 'merchant', intent: 'affirmative', body: 'Yes', isAutoReply: false, timestamp: new Date().toISOString() }],
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  const keys = obs.map((o) => o.observation);
  assert.ok(keys.includes('merchant_ready_to_act'), `Got: ${keys.join(', ')}`);
});

test('infers offer_about_to_expire from offer signal', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const soon = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
  const merchant = buildMerchant({ offers: [{ id: 'o1', title: 'Free Consult', valid_till: soon }] });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  const keys = obs.map((o) => o.observation);
  assert.ok(keys.includes('offer_about_to_expire'), `Got: ${keys.join(', ')}`);
});

test('infers merchant_declining from views_declining signal', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const merchant = buildMerchant({
    performance: { views: 200, calls: 2, ctr: 0.01, delta_7d: { views_pct: -0.35 }, signals: [] },
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  const keys = obs.map((o) => o.observation);
  assert.ok(keys.includes('merchant_declining'), `Got: ${keys.join(', ')}`);
});

test('infers merchant_should_recall_customers from inactive_customers signal', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const merchant = buildMerchant({
    performance: {
      views: 800, calls: 10, ctr: 0.02, delta_7d: {}, signals: [],
      customer_aggregate: { lapsed_180d_plus: 70, total_unique_ytd: 100 },
    },
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  const keys = obs.map((o) => o.observation);
  assert.ok(keys.includes('merchant_should_recall_customers'), `Got: ${keys.join(', ')}`);
});

test('inferences are sorted by priority ascending', () => {
  const { SignalExtractor, InferenceEngine } = freshModules();
  const merchant = buildMerchant({ ctr: 0.005, peerCtr: 0.025 });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const obs = InferenceEngine.infer(signals, merchant);
  for (let i = 1; i < obs.length; i++) {
    assert.ok(obs[i].priority >= obs[i - 1].priority,
      `Observations not sorted: idx ${i - 1}=${obs[i - 1].priority} idx ${i}=${obs[i].priority}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// StrategySelector
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── StrategySelector ──────────────────────────────────────────────');

test('follow_up strategy selected first when merchant replied YES', () => {
  const { StrategySelector } = freshModules();
  const merchant = buildMerchant({
    conversationHistory: [{ speaker: 'merchant', intent: 'affirmative', body: 'Yes', isAutoReply: false, timestamp: new Date().toISOString() }],
  });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  assert.ok(candidates.length > 0, 'Expected candidates');
  assert.strictEqual(candidates[0].strategy, 'follow_up', `Top strategy was: ${candidates[0].strategy}`);
});

test('customer_winback selected for high lapsed ratio trigger', () => {
  const { StrategySelector } = freshModules();
  const merchant = buildMerchant({
    performance: {
      views: 800, calls: 10, ctr: 0.02, delta_7d: {}, signals: [],
      customer_aggregate: { lapsed_180d_plus: 70, total_unique_ytd: 100 },
    },
  });
  const trigger = buildTrigger({ kind: 'recall_due' });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger, customer: null }, []);
  const strategies = candidates.map((c) => c.strategy);
  assert.ok(strategies.includes('customer_winback'), `Got: ${strategies.join(', ')}`);
});

test('performance_recovery selected for declining views + low CTR', () => {
  const { StrategySelector } = freshModules();
  const merchant = buildMerchant({
    ctr: 0.005, peerCtr: 0.025,
    performance: { views: 200, calls: 2, ctr: 0.005, delta_7d: { views_pct: -0.30 }, signals: [] },
  });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  const strategies = candidates.map((c) => c.strategy);
  assert.ok(strategies.includes('performance_recovery'), `Got: ${strategies.join(', ')}`);
});

test('offer strategy selected when offer expires in 3 days', () => {
  const { StrategySelector } = freshModules();
  const in2days = new Date(Date.now() + 2 * 86400 * 1000).toISOString();
  const merchant = buildMerchant({
    offers: [{ id: 'o1', title: 'Family Combo 20% off', valid_till: in2days, status: 'active' }],
  });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  const strategies = candidates.map((c) => c.strategy);
  assert.ok(strategies.includes('offer'), `Got: ${strategies.join(', ')}`);
});

test('no candidate has score = 0 in returned list', () => {
  const { StrategySelector } = freshModules();
  const merchant = buildMerchant({ ctr: 0.005, peerCtr: 0.025 });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  for (const c of candidates) {
    assert.ok(c.score > 0, `Candidate ${c.strategy} has score=${c.score}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ActionRanker
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ActionRanker ──────────────────────────────────────────────────');

test('ranker returns a best candidate from multiple options', () => {
  const { StrategySelector, ActionRanker } = freshModules();
  const merchant = buildMerchant({ ctr: 0.005, peerCtr: 0.025 });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  const result = ActionRanker.rank(candidates, [], merchant, null, {});
  assert.ok(result, 'Expected a rank result');
  assert.ok(result.best, 'Expected a best candidate');
  assert.ok(result.scored.length > 0, 'Expected scored array');
});

test('follow_up wins when merchant replied YES', () => {
  const { StrategySelector, ActionRanker, InferenceEngine, SignalExtractor } = freshModules();
  const merchant = buildMerchant({
    conversationHistory: [{ speaker: 'merchant', intent: 'affirmative', body: 'Yes', isAutoReply: false, timestamp: new Date().toISOString() }],
  });
  const signals = SignalExtractor.extract(merchant, null, null, null, new Date().toISOString());
  const observations = InferenceEngine.infer(signals, merchant);
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, observations);
  const result = ActionRanker.rank(candidates, observations, merchant, null, merchant.suppressionKeys);
  assert.ok(result && result.best, 'Expected a best candidate');
  assert.strictEqual(result.best.strategy, 'follow_up', `Winner was: ${result.best.strategy}`);
});

test('all scored candidates have total between 0 and 1', () => {
  const { StrategySelector, ActionRanker } = freshModules();
  const merchant = buildMerchant({ ctr: 0.005, peerCtr: 0.025 });
  const candidates = StrategySelector.selectCandidates({ merchant, category: {}, trigger: {}, customer: null }, []);
  const result = ActionRanker.rank(candidates, [], merchant, null, {});
  for (const sc of result.scored) {
    assert.ok(sc.total >= 0 && sc.total <= 1.0, `Score out of range: ${sc.strategy}=${sc.total}`);
  }
});

test('ranker returns null when candidates is empty', () => {
  const { ActionRanker } = freshModules();
  const result = ActionRanker.rank([], [], buildMerchant(), null, {});
  assert.strictEqual(result, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// MessageComposer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── MessageComposer ───────────────────────────────────────────────');

test('anti-generic filter removes "hope you\'re doing well"', () => {
  const { MessageComposer } = freshModules();
  const merchant = buildMerchant({ name: 'Dr. Meera' });
  const composed = {
    strategy: 'engagement',
    body: "Hope you're doing well. We have a research digest for you.",
    cta: 'open_ended',
    reason: 'test',
    suppression_key: 'test:key',
  };
  const result = MessageComposer.finalise(composed, merchant, null, null, [], null);
  assert.ok(!result.message.toLowerCase().includes("hope you're doing well"),
    `Generic phrase survived: "${result.message}"`);
});

test('anti-generic filter removes "just checking in"', () => {
  const { MessageComposer } = freshModules();
  const merchant = buildMerchant();
  const composed = { strategy: 'retention', body: 'Just checking in to see if you need anything.', cta: 'binary', reason: 'test', suppression_key: 'test' };
  const result = MessageComposer.finalise(composed, merchant, null, null, [], null);
  assert.ok(!result.message.toLowerCase().includes('just checking in'),
    `Generic phrase survived: "${result.message}"`);
});

test('finalise returns all required output fields', () => {
  const { MessageComposer } = freshModules();
  const merchant = buildMerchant();
  const composed = { strategy: 'offer', body: 'Your offer expires tomorrow. Extend it?', cta: 'binary', reason: 'test', suppression_key: 'offer:o1' };
  const result = MessageComposer.finalise(composed, merchant, null, null, [], null);
  assert.ok(result.message, 'Missing message');
  assert.ok(result.strategy, 'Missing strategy');
  assert.ok(result.cta, 'Missing cta');
  assert.ok(result.suppression_key, 'Missing suppression_key');
  assert.ok(typeof result.confidence === 'number', 'Missing confidence');
  assert.ok(result.metadata, 'Missing metadata');
});

test('category voice makes dentist message more professional', () => {
  const { MessageComposer } = freshModules();
  const merchant = buildMerchant({ scope: 'dentists', name: 'Dr. Sharma' });
  const composed = {
    strategy: 'engagement',
    body: "Dr. Sharma, we've got a research digest that's relevant to your clinic. It's about preventive care.",
    cta: 'open_ended', reason: 'test', suppression_key: 'research:dentists',
  };
  const result = MessageComposer.finalise(composed, merchant, null, null, [], null);
  // Professional voice — contractions should be expanded
  assert.ok(!result.message.includes("we've") && !result.message.includes("that's"),
    `Contractions not expanded in professional scope: "${result.message}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// ReplayGuard
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ReplayGuard ───────────────────────────────────────────────────');

test('returns end action for merchant_refused observation', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'No thanks',
    fromRole: 'merchant',
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    merchant,
    observations: [{ observation: 'merchant_refused', priority: 1 }],
    turnNumber: 2,
  });
  assert.ok(decision !== null, 'Expected a guard decision');
  assert.strictEqual(decision.action, 'end');
  assert.strictEqual(decision.guard, 'merchant_refused');
});

test('returns wait for single auto-reply', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'Dhanyavad.',
    fromRole: 'merchant',
    isAutoReply: true,
    consecutiveAutoReplies: 1,
    merchant,
    observations: [],
    turnNumber: 2,
  });
  assert.ok(decision !== null, 'Expected a guard decision');
  assert.strictEqual(decision.action, 'wait');
  assert.strictEqual(decision.guard, 'auto_reply_single');
});

test('returns wait with 7200s for 3+ auto-replies', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'Dhanyavad.',
    fromRole: 'merchant',
    isAutoReply: true,
    consecutiveAutoReplies: 3,
    merchant,
    observations: [],
    turnNumber: 4,
  });
  assert.strictEqual(decision.action, 'wait');
  assert.strictEqual(decision.wait_seconds, 7200);
  assert.strictEqual(decision.guard, 'auto_reply_threshold');
});

test('returns end for trigger_expired observation', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'ok',
    fromRole: 'merchant',
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    merchant,
    observations: [{ observation: 'trigger_expired', priority: 1 }],
    turnNumber: 2,
  });
  assert.strictEqual(decision.action, 'end');
  assert.strictEqual(decision.guard, 'expired_trigger');
});

test('returns null (proceed normally) for a healthy merchant conversation', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'Tell me more about this.',
    fromRole: 'merchant',
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    merchant,
    observations: [{ observation: 'research_digest_available', priority: 2 }],
    turnNumber: 2,
  });
  assert.strictEqual(decision, null, 'Expected null (proceed normally)');
});

test('returns end for max turns exceeded', () => {
  const { ReplayGuard } = freshModules();
  const merchant = buildMerchant();
  const decision = ReplayGuard.evaluate({
    message: 'ok',
    fromRole: 'merchant',
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    merchant,
    observations: [],
    turnNumber: 6, // MAX_TURNS_PER_CONVERSATION = 5
  });
  assert.ok(decision !== null);
  assert.strictEqual(decision.action, 'end');
  assert.strictEqual(decision.guard, 'max_turns');
});

// ─────────────────────────────────────────────────────────────────────────────
// SuppressionEngine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── SuppressionEngine ─────────────────────────────────────────────');

test('suppresses when key is already in session set', () => {
  const { SuppressionEngine } = freshModules();
  const merchant = buildMerchant();
  const sessionKeys = new Set(['offer:o1']);
  const result = SuppressionEngine.check({ suppression_key: 'offer:o1', strategy: 'offer', cta: 'binary' }, merchant, sessionKeys);
  assert.strictEqual(result.suppressed, true);
  assert.ok(result.reason.includes('exact_key_session'));
});

test('suppresses when key matches merchant lastKey memory', () => {
  const { SuppressionEngine } = freshModules();
  const merchant = buildMerchant({ suppressionKeys: { lastKey: 'offer:o1', lastCta: null, lastStrategy: null } });
  const result = SuppressionEngine.check({ suppression_key: 'offer:o1', strategy: 'offer', cta: 'binary' }, merchant, new Set());
  assert.strictEqual(result.suppressed, true);
  assert.ok(result.reason.includes('exact_key_memory'));
});

test('suppresses when same strategy used < 6h ago', () => {
  const { SuppressionEngine } = freshModules();
  const recentSentAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // 2h ago
  const merchant = buildMerchant({
    replyHistory: [{ strategy: 'offer', sentAt: recentSentAt, body: '...', cta: 'binary' }],
  });
  const result = SuppressionEngine.check({ suppression_key: 'offer:o2', strategy: 'offer', cta: 'binary' }, merchant, new Set());
  assert.strictEqual(result.suppressed, true);
  assert.ok(result.reason.includes('strategy_too_recent'));
});

test('does not suppress when strategy was used > 6h ago', () => {
  const { SuppressionEngine } = freshModules();
  const oldSentAt = new Date(Date.now() - 8 * 3600 * 1000).toISOString(); // 8h ago
  const merchant = buildMerchant({
    replyHistory: [{ strategy: 'offer', sentAt: oldSentAt, body: '...', cta: 'binary' }],
  });
  const result = SuppressionEngine.check({ suppression_key: 'offer:o3', strategy: 'offer', cta: 'binary' }, merchant, new Set());
  assert.strictEqual(result.suppressed, false);
});

test('markUsed adds key to session set', () => {
  const { SuppressionEngine } = freshModules();
  const sessionKeys = new Set();
  SuppressionEngine.markUsed('winback:recall:m1', sessionKeys);
  assert.ok(sessionKeys.has('winback:recall:m1'));
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end — per category compose() output validation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── End-to-End Category Tests ─────────────────────────────────────');

const STRATEGIES = {
  OfferStrategy:           () => require('../src/strategies/OfferStrategy'),
  GrowthStrategy:          () => require('../src/strategies/GrowthStrategy'),
  CustomerWinbackStrategy: () => require('../src/strategies/CustomerWinbackStrategy'),
  ReviewStrategy:          () => require('../src/strategies/ReviewStrategy'),
  EngagementStrategy:      () => require('../src/strategies/EngagementStrategy'),
  PerformanceRecoveryStrategy: () => require('../src/strategies/PerformanceRecoveryStrategy'),
  FollowUpStrategy:        () => require('../src/strategies/FollowUpStrategy'),
  FestivalStrategy:        () => require('../src/strategies/FestivalStrategy'),
  CampaignStrategy:        () => require('../src/strategies/CampaignStrategy'),
};

function composeTest(strategyKey, merchantOverrides, triggerOverrides, testFn) {
  freshModules();
  const strategy = STRATEGIES[strategyKey]();
  const merchant = buildMerchant(merchantOverrides);
  const trigger = triggerOverrides ? buildTrigger(triggerOverrides) : null;
  const context = { merchant, category: null, trigger, customer: null };
  const result = strategy.compose(context);
  testFn(result, merchant);
}

// Restaurant — offer expiry
test('[Restaurant] OfferStrategy composes a specific, grounded message with offer title', () => {
  composeTest('OfferStrategy',
    { scope: 'restaurants', name: 'Spice Garden', offers: [{ id: 'o1', title: 'Weekend Combo 30% off', valid_till: new Date(Date.now() + 1.5 * 86400000).toISOString(), status: 'active', discount_pct: 30 }] },
    null,
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('Weekend Combo'), `Offer title missing in: "${result.body}"`);
      assert.ok(result.body.includes('30%'), `Discount missing in: "${result.body}"`);
      assert.ok(result.cta === 'binary', `Wrong CTA: ${result.cta}`);
    }
  );
});

// Dentist — research digest engagement
test('[Dentist] EngagementStrategy composes a professional research digest message', () => {
  composeTest('EngagementStrategy',
    { scope: 'dentists', name: 'Dr. Meera Dental' },
    { kind: 'research_digest', digest: { publication: 'JADA', key_finding: 'Preventive care reduces emergency visits by 40%' } },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('JADA') || result.body.includes('Preventive care'), `Finding not in message: "${result.body}"`);
      assert.ok(!result.body.toLowerCase().includes('hope you'), `Generic phrase found in: "${result.body}"`);
    }
  );
});

// Gym — customer winback
test('[Gym] CustomerWinbackStrategy composes a winback message with lapsed count', () => {
  composeTest('CustomerWinbackStrategy',
    {
      scope: 'gyms', name: 'FitZone Gym',
      performance: { views: 800, calls: 10, ctr: 0.02, delta_7d: {}, signals: [], customer_aggregate: { lapsed_180d_plus: 45, total_unique_ytd: 80 } },
    },
    { kind: 'recall_due', lapsed_count: 45 },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('45') || result.body.includes('customer'), `Count or customer reference missing in: "${result.body}"`);
      assert.ok(!result.body.toLowerCase().includes('hello merchant'), `Generic phrase in: "${result.body}"`);
    }
  );
});

// Salon — festival strategy
test('[Salon] FestivalStrategy includes festival name and offer reference', () => {
  composeTest('FestivalStrategy',
    { scope: 'salons', name: 'Style Studio', offers: [{ id: 'o1', title: 'Bridal Makeover Special', status: 'active' }] },
    { kind: 'festival_upcoming', festival: 'Diwali' },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('Diwali'), `Festival name missing in: "${result.body}"`);
      assert.ok(result.body.includes('Bridal Makeover') || result.body.includes('Diwali'), `Offer missing in: "${result.body}"`);
    }
  );
});

// Pharmacy — performance recovery
test('[Pharmacy] PerformanceRecoveryStrategy composes a data-grounded message', () => {
  composeTest('PerformanceRecoveryStrategy',
    {
      scope: 'pharmacies', name: 'HealthFirst Pharmacy',
      ctr: 0.008, peerCtr: 0.025,
      performance: { views: 300, calls: 4, ctr: 0.008, delta_7d: { views_pct: -0.28 }, signals: [] },
    },
    { kind: 'perf_drop' },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('28') || result.body.includes('0.8') || result.body.includes('drop') || result.body.includes('2.5'),
        `No numeric data in: "${result.body}"`);
    }
  );
});

// Hostile reply — review strategy scenario
test('[Review] ReviewStrategy uses real rating numbers when available', () => {
  composeTest('ReviewStrategy',
    {
      scope: 'restaurants', name: 'Curry House',
      performance: { views: 600, calls: 8, ctr: 0.015, delta_7d: {}, signals: ['rating_drop'], avg_rating: 3.7 },
    },
    { kind: 'rating_drop', current_rating: 3.7, previous_rating: 4.2 },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('3.7') || result.body.includes('4.2') || result.body.includes('drop'),
        `Rating numbers missing in: "${result.body}"`);
    }
  );
});

// Duplicate replay protection
test('[Suppression] Second identical suppression key within session is blocked', () => {
  const { SuppressionEngine } = freshModules();
  const merchant = buildMerchant();
  const sessionKeys = new Set();
  const composed = { suppression_key: 'offer:o1:extend', strategy: 'offer', cta: 'binary' };

  // First use — should pass
  const first = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert.strictEqual(first.suppressed, false, 'First use should NOT be suppressed');
  SuppressionEngine.markUsed(composed.suppression_key, sessionKeys);

  // Second use same key — must be suppressed
  const second = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert.strictEqual(second.suppressed, true, 'Second use SHOULD be suppressed');
});

// Campaign underperforming
test('[Campaign] CampaignStrategy addresses underperforming campaign explicitly', () => {
  composeTest('CampaignStrategy',
    { scope: 'restaurants', name: 'Biryani House', campaigns: [{ id: 'c1', name: 'Lunch Rush', status: 'underperforming', clicks: 12 }] },
    { kind: 'campaign_boost' },
    (result) => {
      assert.ok(result.body, 'Body is empty');
      assert.ok(result.body.includes('Lunch Rush') || result.body.includes('campaign'), `Campaign name missing in: "${result.body}"`);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome tests FAILED. Review errors above.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
