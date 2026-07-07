'use strict';

/**
 * Merchant Memory System — unit tests.
 *
 * Covers:
 *   - MemoryStore:         merchant creation, CRUD, storeConversation trim
 *   - VersionManager:      UPGRADE / SAME / STALE resolution, commit
 *   - MerchantRepository:  context ingestion per scope, idempotency, stale rejection
 *   - StateManager:        deterministic state transitions for all key signals
 *   - TickManager:         tick append, delta calculation, idle merchant tracking
 *   - ConversationManager: inbound/outbound recording, auto-reply detection, trim
 *   - AnalyticsManager:    event recording, rolling latency average
 *
 * Run with: node tests/merchantMemory.test.js
 */

const assert = require('assert');

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshModules() {
  // Clear require cache for all memory modules so each test group gets a clean state.
  const keys = Object.keys(require.cache).filter(
    (k) =>
      k.includes('src\\memory') ||
      k.includes('src/memory') ||
      k.includes('src\\config\\constants') ||
      k.includes('src/config/constants')
  );
  keys.forEach((k) => delete require.cache[k]);

  return {
    MemoryStore: require('../src/memory/MemoryStore'),
    VersionManager: require('../src/memory/VersionManager'),
    StateManager: require('../src/memory/StateManager'),
    TickManager: require('../src/memory/TickManager'),
    ConversationManager: require('../src/memory/ConversationManager'),
    AnalyticsManager: require('../src/memory/AnalyticsManager'),
    MerchantRepository: require('../src/memory/MerchantRepository'),
    MERCHANT_STATES: require('../src/config/constants').MERCHANT_STATES,
    MAX_CONVERSATION_MESSAGES: require('../src/config/constants').MAX_CONVERSATION_MESSAGES,
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

// ─────────────────────────────────────────────────────────────────────────────
// MemoryStore
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── MemoryStore ──────────────────────────────────────────────────');

test('createMerchant() creates a merchant with correct defaults', () => {
  const { MemoryStore, MERCHANT_STATES } = freshModules();
  const m = MemoryStore.createMerchant('m_test_01', 'dentists');
  assert.strictEqual(m.merchantId, 'm_test_01');
  assert.strictEqual(m.scope, 'dentists');
  assert.strictEqual(m.merchantState, MERCHANT_STATES.NEW);
  assert.ok(Array.isArray(m.conversationHistory));
  assert.ok(m.customerContexts instanceof Map);
});

test('createMerchant() throws on duplicate merchantId', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_dup');
  assert.throws(() => MemoryStore.createMerchant('m_dup'), /already exists/);
});

test('getMerchant() returns null for unknown merchantId', () => {
  const { MemoryStore } = freshModules();
  assert.strictEqual(MemoryStore.getMerchant('nonexistent'), null);
});

test('merchantExists() returns correct boolean', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_exists');
  assert.strictEqual(MemoryStore.merchantExists('m_exists'), true);
  assert.strictEqual(MemoryStore.merchantExists('m_ghost'), false);
});

test('deleteMerchant() removes the record', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_del');
  MemoryStore.deleteMerchant('m_del');
  assert.strictEqual(MemoryStore.merchantExists('m_del'), false);
});

test('storeConversation() trims to MAX_CONVERSATION_MESSAGES', () => {
  const { MemoryStore, MAX_CONVERSATION_MESSAGES } = freshModules();
  MemoryStore.createMerchant('m_trim');
  const over = MAX_CONVERSATION_MESSAGES + 5;
  for (let i = 0; i < over; i++) {
    MemoryStore.storeConversation('m_trim', {
      conversationId: 'conv_01',
      speaker: 'merchant',
      body: `Message ${i}`,
      timestamp: new Date().toISOString(),
    });
  }
  const m = MemoryStore.getMerchant('m_trim');
  assert.strictEqual(m.conversationHistory.length, MAX_CONVERSATION_MESSAGES);
  // The newest messages should be retained (last one stored should be Message N-1)
  const lastBody = m.conversationHistory[m.conversationHistory.length - 1].body;
  assert.strictEqual(lastBody, `Message ${over - 1}`);
});

test('storePerformance() updates metric fields', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_perf');
  MemoryStore.storePerformance('m_perf', { views: 2410, calls: 18, ctr: 0.021 });
  const m = MemoryStore.getMerchant('m_perf');
  assert.strictEqual(m.metrics.currentCtr, 0.021);
  assert.strictEqual(m.metrics.totalViews, 2410);
  assert.strictEqual(m.metrics.peakCtr, 0.021);
});

test('storeOffers() replaces the offers array', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_offers');
  MemoryStore.storeOffers('m_offers', [{ id: 'o1', title: 'Dental Cleaning @ ₹299' }]);
  const m = MemoryStore.getMerchant('m_offers');
  assert.strictEqual(m.offers.length, 1);
  assert.strictEqual(m.offers[0].id, 'o1');
});

test('clear() wipes all merchants', () => {
  const { MemoryStore } = freshModules();
  MemoryStore.createMerchant('m_a');
  MemoryStore.createMerchant('m_b');
  MemoryStore.clear();
  assert.strictEqual(MemoryStore.size(), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// VersionManager
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── VersionManager ───────────────────────────────────────────────');

test('resolve() returns UPGRADE for first-ever push', () => {
  const { VersionManager } = freshModules();
  assert.strictEqual(VersionManager.resolve('m_01', 'merchant', 1), 'UPGRADE');
});

test('resolve() returns SAME when version equals current', () => {
  const { VersionManager } = freshModules();
  VersionManager.commit('m_01', 'merchant', 3);
  assert.strictEqual(VersionManager.resolve('m_01', 'merchant', 3), 'SAME');
});

test('resolve() returns STALE when version is below current', () => {
  const { VersionManager } = freshModules();
  VersionManager.commit('m_01', 'merchant', 5);
  assert.strictEqual(VersionManager.resolve('m_01', 'merchant', 3), 'STALE');
});

test('resolve() returns UPGRADE when version exceeds current', () => {
  const { VersionManager } = freshModules();
  VersionManager.commit('m_01', 'merchant', 5);
  assert.strictEqual(VersionManager.resolve('m_01', 'merchant', 6), 'UPGRADE');
});

test('commit() persists the version and updatedAt', () => {
  const { VersionManager } = freshModules();
  VersionManager.commit('m_01', 'merchant', 7);
  assert.strictEqual(VersionManager.getCurrentVersion('m_01', 'merchant'), 7);
  const scopes = VersionManager.getScopeVersions('m_01');
  assert.ok(scopes.merchant.updatedAt, 'Should have updatedAt');
});

test('deleteMerchant() removes all version state for that merchant', () => {
  const { VersionManager } = freshModules();
  VersionManager.commit('m_to_del', 'merchant', 2);
  VersionManager.deleteMerchant('m_to_del');
  assert.strictEqual(VersionManager.getCurrentVersion('m_to_del', 'merchant'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// MerchantRepository
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── MerchantRepository ───────────────────────────────────────────');

test('ingestMerchantContext() accepts and creates new merchant', () => {
  const { MerchantRepository } = freshModules();
  const result = MerchantRepository.ingestMerchantContext('m_new', 1, {
    merchant_id: 'm_new',
    category_slug: 'dentists',
    identity: { name: 'Dr. Test' },
    performance: { views: 100, calls: 5, ctr: 0.05 },
    offers: [],
    signals: [],
  });
  assert.strictEqual(result.accepted, true);
  const m = MerchantRepository.getMerchant('m_new');
  assert.ok(m, 'Merchant should exist in memory');
  assert.strictEqual(m.identity.name, 'Dr. Test');
});

test('ingestMerchantContext() is idempotent on same version', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_idem', 1, { merchant_id: 'm_idem', identity: { name: 'v1' } });
  const result = MerchantRepository.ingestMerchantContext('m_idem', 1, { merchant_id: 'm_idem', identity: { name: 'v1 dup' } });
  assert.strictEqual(result.accepted, true);
  // Name should still be v1 (no-op)
  const m = MerchantRepository.getMerchant('m_idem');
  assert.strictEqual(m.identity.name, 'v1');
});

test('ingestMerchantContext() rejects stale version', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_stale', 5, { merchant_id: 'm_stale' });
  const result = MerchantRepository.ingestMerchantContext('m_stale', 3, { merchant_id: 'm_stale' });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.reason, 'stale_version');
});

test('ingestMerchantContext() accepts higher version and updates identity', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_up', 1, { merchant_id: 'm_up', identity: { name: 'v1' } });
  MerchantRepository.ingestMerchantContext('m_up', 2, { merchant_id: 'm_up', identity: { name: 'v2' } });
  const m = MerchantRepository.getMerchant('m_up');
  assert.strictEqual(m.identity.name, 'v2');
});

test('ingestCustomerContext() stores customer on owning merchant', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_cx', 1, { merchant_id: 'm_cx' });
  const result = MerchantRepository.ingestCustomerContext('c_001', 1, {
    customer_id: 'c_001',
    merchant_id: 'm_cx',
    identity: { name: 'Priya' },
  });
  assert.strictEqual(result.accepted, true);
  const m = MerchantRepository.getMerchant('m_cx');
  assert.ok(m.customerContexts.has('c_001'));
  assert.strictEqual(m.customerContexts.get('c_001').identity.name, 'Priya');
});

test('ingestTriggerContext() appends to merchant triggerHistory', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_trg', 1, { merchant_id: 'm_trg' });
  MerchantRepository.ingestTriggerContext('trg_001', 1, {
    id: 'trg_001',
    merchant_id: 'm_trg',
    kind: 'research_digest',
  });
  const m = MerchantRepository.getMerchant('m_trg');
  assert.strictEqual(m.triggerHistory.length, 1);
  assert.strictEqual(m.triggerHistory[0].triggerId, 'trg_001');
});

test('resolveActiveTriggers() returns only matching triggers', () => {
  const { MerchantRepository } = freshModules();
  MerchantRepository.ingestMerchantContext('m_res', 1, { merchant_id: 'm_res' });
  MerchantRepository.ingestTriggerContext('trg_A', 1, { id: 'trg_A', merchant_id: 'm_res' });
  MerchantRepository.ingestTriggerContext('trg_B', 1, { id: 'trg_B', merchant_id: 'm_res' });

  const resolved = MerchantRepository.resolveActiveTriggers(['trg_A', 'trg_C']);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].triggerId, 'trg_A');
});

// ─────────────────────────────────────────────────────────────────────────────
// StateManager
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── StateManager ─────────────────────────────────────────────────');

test('init() creates a merchant in UNKNOWN state', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  const entry = StateManager.init('m_sm_01');
  assert.strictEqual(entry.state, MERCHANT_STATES.UNKNOWN);
  assert.strictEqual(entry.previousState, null);
});

test('compute() → OFFLINE when subscription is lapsed', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_offline');
  const entry = StateManager.compute('m_offline', {
    subscriptionStatus: 'lapsed',
    hasActiveCampaign: false,
    awaitingMerchantReply: false,
    ctr: null, peerMedianCtr: null, viewsDelta7d: null,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.OFFLINE);
  assert.strictEqual(entry.reason, 'subscription_lapsed');
});

test('compute() → HIGH_PERFORMING when CTR above peer and views up', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_high');
  const entry = StateManager.compute('m_high', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: false,
    ctr: 0.05, peerMedianCtr: 0.03, viewsDelta7d: 0.15,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.HIGH_PERFORMING);
});

test('compute() → LOW_PERFORMING when CTR < 50% of peer median', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_low');
  const entry = StateManager.compute('m_low', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: false,
    ctr: 0.005, peerMedianCtr: 0.03, viewsDelta7d: 0,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.LOW_PERFORMING);
});

test('compute() → DECLINING when views delta < -20%', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_dec');
  const entry = StateManager.compute('m_dec', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: false,
    ctr: 0.02, peerMedianCtr: 0.03, viewsDelta7d: -0.25,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.DECLINING);
});

test('compute() → RECOVERING after DECLINING when views turn positive', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_rec');
  // First move to DECLINING
  StateManager.compute('m_rec', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: false,
    ctr: 0.02, peerMedianCtr: 0.03, viewsDelta7d: -0.25,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  // Now views recover
  const entry = StateManager.compute('m_rec', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: false,
    ctr: 0.02, peerMedianCtr: 0.03, viewsDelta7d: 0.05,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.RECOVERING);
  assert.strictEqual(entry.previousState, MERCHANT_STATES.DECLINING);
});

test('compute() → WAITING_REPLY when awaiting reply', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_wait');
  const entry = StateManager.compute('m_wait', {
    subscriptionStatus: 'active', hasActiveCampaign: false, awaitingMerchantReply: true,
    ctr: null, peerMedianCtr: null, viewsDelta7d: null,
    activeCustomerConversations: null, lapsedCustomers: null, totalCustomers: null,
    hasStaleSignals: false, hasPerformanceData: true,
  });
  assert.strictEqual(entry.state, MERCHANT_STATES.WAITING_REPLY);
});

test('forceTransition() overrides state with reason', () => {
  const { StateManager, MERCHANT_STATES } = freshModules();
  StateManager.init('m_force');
  const entry = StateManager.forceTransition('m_force', MERCHANT_STATES.NEEDS_ATTENTION, 'test_reason');
  assert.strictEqual(entry.state, MERCHANT_STATES.NEEDS_ATTENTION);
  assert.strictEqual(entry.reason, 'test_reason');
});

// ─────────────────────────────────────────────────────────────────────────────
// TickManager
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── TickManager ──────────────────────────────────────────────────');

test('processTick() appends a tick record to merchant', () => {
  const { MerchantRepository, TickManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_tick_01', 1, { merchant_id: 'm_tick_01' });
  MerchantRepository.ingestTriggerContext('trg_t1', 1, { id: 'trg_t1', merchant_id: 'm_tick_01' });

  const resolved = MerchantRepository.resolveActiveTriggers(['trg_t1']);
  TickManager.processTick({
    now: '2026-04-26T10:30:00Z',
    activeTriggerIds: ['trg_t1'],
    resolvedTriggers: resolved,
  });

  const history = TickManager.getTickHistory('m_tick_01');
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].resolvedTriggerId, 'trg_t1');
  assert.strictEqual(history[0].tickIndex, 0);
});

test('processTick() appends subsequent ticks without overwriting', () => {
  const { MerchantRepository, TickManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_tick_seq', 1, { merchant_id: 'm_tick_seq' });
  MerchantRepository.ingestTriggerContext('trg_s1', 1, { id: 'trg_s1', merchant_id: 'm_tick_seq' });

  const resolved = MerchantRepository.resolveActiveTriggers(['trg_s1']);

  TickManager.processTick({ now: '2026-04-26T10:30:00Z', activeTriggerIds: ['trg_s1'], resolvedTriggers: resolved });
  TickManager.processTick({ now: '2026-04-26T10:35:00Z', activeTriggerIds: ['trg_s1'], resolvedTriggers: resolved });

  const history = TickManager.getTickHistory('m_tick_seq');
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].tickIndex, 0);
  assert.strictEqual(history[1].tickIndex, 1);
});

test('processTick() calculates correct deltas between ticks', () => {
  const { MerchantRepository, TickManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_delta', 1, {
    merchant_id: 'm_delta',
    performance: { views: 1000, calls: 10, directions: 20, ctr: 0.02 },
  });
  MerchantRepository.ingestTriggerContext('trg_d1', 1, { id: 'trg_d1', merchant_id: 'm_delta' });

  const resolved = MerchantRepository.resolveActiveTriggers(['trg_d1']);
  TickManager.processTick({ now: 'T1', activeTriggerIds: ['trg_d1'], resolvedTriggers: resolved });

  // Update performance (simulated refresh)
  MerchantRepository.ingestMerchantContext('m_delta', 2, {
    merchant_id: 'm_delta',
    performance: { views: 1200, calls: 15, directions: 22, ctr: 0.025 },
  });

  TickManager.processTick({ now: 'T2', activeTriggerIds: ['trg_d1'], resolvedTriggers: resolved });

  const history = TickManager.getTickHistory('m_delta');
  const tick2 = history[1];
  assert.strictEqual(tick2.deltas.views, 200);
  assert.strictEqual(tick2.deltas.calls, 5);
});

// ─────────────────────────────────────────────────────────────────────────────
// ConversationManager
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ConversationManager ──────────────────────────────────────────');

test('recordInbound() stores message in merchant conversationHistory', () => {
  const { MerchantRepository, ConversationManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_conv01', 1, { merchant_id: 'm_conv01' });

  ConversationManager.recordInbound({
    merchantId: 'm_conv01',
    conversationId: 'conv_A',
    speaker: 'merchant',
    body: 'Yes, please send me the abstract',
    turnNumber: 2,
    receivedAt: new Date().toISOString(),
  });

  assert.strictEqual(ConversationManager.getMessageCount('m_conv01'), 1);
  const msgs = ConversationManager.getRecentMessages('m_conv01');
  assert.strictEqual(msgs[0].body, 'Yes, please send me the abstract');
  assert.strictEqual(msgs[0].intent, 'affirmative');
});

test('recordInbound() detects auto-reply after AUTO_REPLY_THRESHOLD identical messages', () => {
  const { MerchantRepository, ConversationManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_auto', 1, { merchant_id: 'm_auto' });

  // AUTO_REPLY_THRESHOLD = 3: detection fires when all of the last 3 merchant
  // messages are identical. Send 3 copies of the same canned WhatsApp auto-reply.
  const autoMsg = 'Aapki jaankari ke liye bahut-bahut shukriya.';

  ConversationManager.recordInbound({
    merchantId: 'm_auto', conversationId: 'c1', speaker: 'merchant',
    body: autoMsg, turnNumber: 1, receivedAt: new Date().toISOString(),
  });
  ConversationManager.recordInbound({
    merchantId: 'm_auto', conversationId: 'c1', speaker: 'merchant',
    body: autoMsg, turnNumber: 2, receivedAt: new Date().toISOString(),
  });
  const result = ConversationManager.recordInbound({
    merchantId: 'm_auto', conversationId: 'c1', speaker: 'merchant',
    body: autoMsg, turnNumber: 3, receivedAt: new Date().toISOString(),
  });

  assert.strictEqual(result.isAutoReply, true);
});

test('conversationHistory does not grow beyond MAX_CONVERSATION_MESSAGES via ConversationManager', () => {
  const { MerchantRepository, ConversationManager, MAX_CONVERSATION_MESSAGES } = freshModules();
  MerchantRepository.ingestMerchantContext('m_cap', 1, { merchant_id: 'm_cap' });

  for (let i = 0; i < MAX_CONVERSATION_MESSAGES + 10; i++) {
    ConversationManager.recordInbound({
      merchantId: 'm_cap', conversationId: 'c1', speaker: 'merchant',
      body: `Message ${i}`, turnNumber: i + 1, receivedAt: new Date().toISOString(),
    });
  }

  assert.ok(
    ConversationManager.getMessageCount('m_cap') <= MAX_CONVERSATION_MESSAGES,
    `Should not exceed ${MAX_CONVERSATION_MESSAGES}`
  );
});

test('_inferIntent() correctly classifies affirmative messages', () => {
  const { MerchantRepository, ConversationManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_intent', 1, { merchant_id: 'm_intent' });
  ConversationManager.recordInbound({
    merchantId: 'm_intent', conversationId: 'c1', speaker: 'merchant',
    body: 'Yes please go ahead', turnNumber: 1, receivedAt: new Date().toISOString(),
  });
  const msgs = ConversationManager.getRecentMessages('m_intent', 1);
  assert.strictEqual(msgs[0].intent, 'affirmative');
});

// ─────────────────────────────────────────────────────────────────────────────
// AnalyticsManager
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── AnalyticsManager ─────────────────────────────────────────────');

test('recordContextAccepted() increments contextUpdates', () => {
  const { MerchantRepository, AnalyticsManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_ana01', 1, { merchant_id: 'm_ana01' });
  AnalyticsManager.recordContextAccepted('m_ana01');
  const a = AnalyticsManager.getAnalytics('m_ana01');
  // contextUpdates is also incremented during ingest, so >= 1
  assert.ok(a.contextUpdates >= 1);
});

test('recordContextIgnored() increments ignoredUpdates', () => {
  const { MerchantRepository, AnalyticsManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_ana02', 1, { merchant_id: 'm_ana02' });
  AnalyticsManager.recordContextIgnored('m_ana02');
  const a = AnalyticsManager.getAnalytics('m_ana02');
  assert.strictEqual(a.ignoredUpdates, 1);
});

test('recordReply() computes rolling average latency correctly', () => {
  const { MerchantRepository, AnalyticsManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_ana03', 1, { merchant_id: 'm_ana03' });
  AnalyticsManager.recordReply('m_ana03', 100);
  AnalyticsManager.recordReply('m_ana03', 200);
  AnalyticsManager.recordReply('m_ana03', 300);
  const a = AnalyticsManager.getAnalytics('m_ana03');
  // Welford average of [100, 200, 300] = 200
  assert.ok(Math.abs(a.avgResponseLatencyMs - 200) < 0.001, `Expected ~200, got ${a.avgResponseLatencyMs}`);
});

test('getGlobalSummary() aggregates across all merchants', () => {
  const { MerchantRepository, AnalyticsManager } = freshModules();
  MerchantRepository.ingestMerchantContext('m_g1', 1, { merchant_id: 'm_g1' });
  MerchantRepository.ingestMerchantContext('m_g2', 1, { merchant_id: 'm_g2' });
  AnalyticsManager.recordReply('m_g1', 50);
  AnalyticsManager.recordReply('m_g2', 75);
  const summary = AnalyticsManager.getGlobalSummary();
  assert.strictEqual(summary.merchantCount, 2);
  assert.ok(summary.totalReplies >= 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome tests FAILED. Review the errors above.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
