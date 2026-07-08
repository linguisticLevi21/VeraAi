'use strict';

/**
 * Replay Protection Tests
 *
 * Covers:
 *   - Auto-reply detection (threshold)
 *   - Conversation loop detection (same suppression_key × 3)
 *   - Body-level dedup (same message × 2)
 *   - Strategy cooldown (< 6h)
 *   - CTA repeat suppression
 *   - ReplayGuard hard exits (refusal, expired, max turns)
 */

const SuppressionEngine = require('../src/engine/SuppressionEngine');
const ReplayGuard = require('../src/engine/ReplayGuard');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        → ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMerchant(overrides = {}) {
  return {
    merchantId: 'test_merchant',
    suppressionKeys: { lastTrigger: null, used: new Set() },
    replyHistory: [],
    conversationHistory: [],
    ...overrides,
  };
}

function makeComposed(overrides = {}) {
  return {
    strategy: 'offer',
    body: 'Dr. Smith, your "Free Consultation" expires in 2 days.',
    cta: 'binary',
    suppression_key: 'offer:o_001',
    ...overrides,
  };
}

// ── SuppressionEngine Tests ────────────────────────────────────────────────

console.log('\nReplay Protection Tests\n');

test('Rule 1: session key collision suppresses', () => {
  const sessionKeys = new Set(['offer:o_001']);
  const composed = makeComposed({ suppression_key: 'offer:o_001' });
  const merchant = makeMerchant();
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Should be suppressed');
  assert(result.reason.includes('exact_key_session'), `Reason: ${result.reason}`);
});

test('Rule 2: memory key collision suppresses', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ suppression_key: 'offer:o_002' });
  const merchant = makeMerchant({ suppressionKeys: { lastKey: 'offer:o_002', used: new Set() } });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Should be suppressed by memory key');
  assert(result.reason.includes('exact_key_memory'), `Reason: ${result.reason}`);
});

test('Rule 3: strategy cooldown < 6h suppresses', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ strategy: 'growth' });
  const merchant = makeMerchant({
    replyHistory: [{ strategy: 'growth', sentAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Should be suppressed — strategy used 2h ago');
  assert(result.reason.includes('strategy_too_recent'), `Reason: ${result.reason}`);
});

test('Rule 3: strategy > 6h ago does NOT suppress', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ strategy: 'growth' });
  const merchant = makeMerchant({
    replyHistory: [{ strategy: 'growth', sentAt: new Date(Date.now() - 8 * 3_600_000).toISOString() }],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === false, 'Should NOT be suppressed — strategy used 8h ago');
});

test('Rule 4: same binary CTA in last 2 Vera turns suppresses', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ cta: 'binary', suppression_key: 'new_key' });
  const merchant = makeMerchant({
    conversationHistory: [
      { speaker: 'vera', body: 'Msg 1', cta: 'binary' },
      { speaker: 'vera', body: 'Msg 2', cta: 'binary' },
    ],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Should be suppressed — binary CTA repeated twice');
  assert(result.reason.includes('cta_repeated'), `Reason: ${result.reason}`);
});

test('Rule 4: CTA=none is never suppressed by CTA rule', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ cta: 'none', suppression_key: 'new_key_none' });
  const merchant = makeMerchant({
    conversationHistory: [
      { speaker: 'vera', body: 'A', cta: 'none' },
      { speaker: 'vera', body: 'B', cta: 'none' },
    ],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === false, 'CTA=none should never suppress');
});

test('Rule 5: loop detection - same suppression_key fires when CTA is none', () => {
  const sessionKeys = new Set();
  const loopKey = 'offer:loop_key_loop';
  // Use cta:none in history so Rule 4 never fires; Rule 5 fires purely on key match
  const composed = makeComposed({ suppression_key: loopKey, strategy: 'loop_strategy', cta: 'open_ended' });
  const merchant = makeMerchant({
    suppressionKeys: { lastTrigger: null, used: new Set() },
    replyHistory: [],
    conversationHistory: [
      { speaker: 'vera', body: 'Msg A', cta: 'none', suppression_key: loopKey },
      { speaker: 'vera', body: 'Msg B', cta: 'none', suppression_key: loopKey },
    ],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Expected suppressed, got: ' + JSON.stringify(result));
  assert(result.reason.includes('loop_detected'), 'Reason should be loop_detected, got: ' + result.reason);
});

test('Rule 5: loop does NOT trigger if keys differ', () => {
  const sessionKeys = new Set();
  const composed = makeComposed({ suppression_key: 'offer:new_key', strategy: 'offer_new' });
  const merchant = makeMerchant({
    conversationHistory: [
      { speaker: 'vera', body: 'A', suppression_key: 'offer:key_a' },
      { speaker: 'vera', body: 'B', suppression_key: 'offer:key_b' },
      { speaker: 'vera', body: 'C', suppression_key: 'offer:key_c' },
    ],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === false, 'Should not suppress — no loop');
});

test('Rule 6: exact body repeat in last 2 Vera messages suppresses', () => {
  const sessionKeys = new Set();
  const sameBody = 'Dr. Smith, your offer expires tomorrow.';
  const composed = makeComposed({ body: sameBody, suppression_key: 'fresh_key' });
  const merchant = makeMerchant({
    conversationHistory: [
      { speaker: 'vera', body: sameBody },
      { speaker: 'vera', body: sameBody },
    ],
  });
  const result = SuppressionEngine.check(composed, merchant, sessionKeys);
  assert(result.suppressed === true, 'Should suppress — identical body repeated');
  assert(result.reason.includes('body_repeated'), `Reason: ${result.reason}`);
});

test('markUsed adds key to session set', () => {
  const sessionKeys = new Set();
  SuppressionEngine.markUsed('test_key', sessionKeys);
  assert(sessionKeys.has('test_key'), 'Key should be in session set');
});

test('markUsed with null key is safe (no-op)', () => {
  const sessionKeys = new Set();
  SuppressionEngine.markUsed(null, sessionKeys);
  assertEqual(sessionKeys.size, 0, 'No key should be added for null');
});

// ── ReplayGuard Tests ─────────────────────────────────────────────────────

test('[ReplayGuard] merchant_refused → action=end', () => {
  const result = ReplayGuard.evaluate({
    observations: [{ observation: 'merchant_refused', priority: 1 }],
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    turnNumber: 2,
    merchant: makeMerchant(),
  });
  assert(result !== null, 'Guard should fire');
  assertEqual(result.action, 'end', 'Should return end');
});

test('[ReplayGuard] 3+ auto-replies → wait 7200s', () => {
  const result = ReplayGuard.evaluate({
    observations: [],
    isAutoReply: true,
    consecutiveAutoReplies: 3,
    turnNumber: 4,
    merchant: makeMerchant(),
  });
  assert(result !== null, 'Guard should fire');
  assertEqual(result.action, 'wait');
  assert(result.wait_seconds >= 7200, 'Should wait at least 2h');
});

test('[ReplayGuard] single auto-reply → wait ~3600s', () => {
  const result = ReplayGuard.evaluate({
    observations: [],
    isAutoReply: true,
    consecutiveAutoReplies: 1,
    turnNumber: 2,
    merchant: makeMerchant(),
  });
  assert(result !== null, 'Guard should fire');
  assertEqual(result.action, 'wait');
  assert(result.wait_seconds >= 3600, 'Should wait at least 1h');
});

test('[ReplayGuard] trigger_expired → action=end', () => {
  const result = ReplayGuard.evaluate({
    observations: [{ observation: 'trigger_expired', priority: 1 }],
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    turnNumber: 1,
    merchant: makeMerchant(),
  });
  assert(result !== null, 'Guard should fire');
  assertEqual(result.action, 'end');
});

test('[ReplayGuard] max turns exceeded → action=end', () => {
  const result = ReplayGuard.evaluate({
    observations: [],
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    turnNumber: 10,
    merchant: makeMerchant(),
  });
  assert(result !== null, 'Guard should fire for turn 10');
  assertEqual(result.action, 'end');
});

test('[ReplayGuard] normal healthy conversation → null (proceed)', () => {
  const result = ReplayGuard.evaluate({
    observations: [{ observation: 'merchant_ready_to_act', priority: 1 }],
    isAutoReply: false,
    consecutiveAutoReplies: 0,
    turnNumber: 2,
    merchant: makeMerchant(),
  });
  assert(result === null, 'Should not fire for a healthy conversation');
});

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('All replay protection tests passed.\n');
else { console.log('Some tests FAILED.\n'); process.exit(1); }

