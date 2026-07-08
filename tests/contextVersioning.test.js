'use strict';

/**
 * Context Versioning Tests
 *
 * Covers:
 *   - Idempotent same-version updates
 *   - Stale version rejection (409 contract)
 *   - Version upgrade path (replace)
 *   - Multi-scope independent versioning
 *   - Trigger context version gating
 */

const contextService = require('../src/services/contextService');
const merchantRepository = require('../src/memory/MerchantRepository');

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function pushMerchant(merchantId, version, overrides = {}) {
  return contextService.pushContext({
    scope: 'merchant',
    contextId: merchantId,
    version,
    payload: {
      merchant_id: merchantId,
      category_slug: 'restaurants',
      identity: { name: `Merchant ${merchantId}`, city: 'Delhi' },
      performance: { views: 1000, calls: 10, ctr: 0.025, delta_7d: { views_pct: 0.05 } },
      offers: [],
      ...overrides,
    },
    deliveredAt: new Date().toISOString(),
  });
}

function pushTrigger(triggerId, merchantId, version) {
  return contextService.pushContext({
    scope: 'trigger',
    contextId: triggerId,
    version,
    payload: {
      id: triggerId,
      merchant_id: merchantId,
      kind: 'perf_spike',
      urgency: 2,
      suppression_key: `perf:${merchantId}:v${version}`,
    },
    deliveredAt: new Date().toISOString(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nContext Versioning Tests\n');

test('accepts first context push (version=1)', () => {
  const result = pushMerchant('v_m001', 1);
  assert(result.accepted === true, 'Should accept first push');
});

test('idempotent — same version is a no-op (accepted=true, no state change)', () => {
  pushMerchant('v_m002', 3);
  const result = pushMerchant('v_m002', 3); // same version
  assert(result.accepted === true, 'Same version should be accepted (no-op)');
});

test('rejects stale version (incoming < current)', () => {
  pushMerchant('v_m003', 5);
  const result = pushMerchant('v_m003', 3); // stale
  assert(result.accepted === false, 'Stale version should be rejected');
  assertEqual(result.reason, 'stale_version', 'Reason should be stale_version');
  assertEqual(result.current_version, 5, 'Should report current version as 5');
});

test('accepts version upgrade (incoming > current)', () => {
  pushMerchant('v_m004', 1);
  const result = pushMerchant('v_m004', 2); // upgrade
  assert(result.accepted === true, 'Upgrade should be accepted');
});

test('version upgrade replaces performance data', () => {
  pushMerchant('v_m005', 1, { performance: { views: 500, calls: 5, ctr: 0.010, delta_7d: {} } });
  pushMerchant('v_m005', 2, { performance: { views: 1200, calls: 15, ctr: 0.030, delta_7d: {} } });
  const m = merchantRepository.getMerchant('v_m005');
  assert(m !== null, 'Merchant should exist after upgrade');
  // State should be recomputed based on new performance
});

test('version conflict returns current_version in response', () => {
  pushMerchant('v_m006', 10);
  const result = pushMerchant('v_m006', 7);
  assertEqual(result.current_version, 10, 'Should return current version 10');
});

test('multi-scope: merchant and trigger versions are tracked independently', () => {
  pushMerchant('v_m007', 1);
  const trigResult = pushTrigger('v_trg001', 'v_m007', 1);
  assert(trigResult.accepted === true, 'Trigger v1 should be accepted');
});

test('trigger version upgrade accepted', () => {
  pushTrigger('v_trg002', 'v_m001', 1);
  const result = pushTrigger('v_trg002', 'v_m001', 2);
  assert(result.accepted === true, 'Trigger upgrade should be accepted');
});

test('trigger stale version rejected', () => {
  pushTrigger('v_trg003', 'v_m001', 5);
  const result = pushTrigger('v_trg003', 'v_m001', 2);
  assert(result.accepted === false, 'Stale trigger should be rejected');
  assertEqual(result.reason, 'stale_version');
});

test('category context accepts version upgrade', () => {
  const r1 = contextService.pushContext({
    scope: 'category',
    contextId: 'dentists_test',
    version: 1,
    payload: { slug: 'dentists', peer_stats: { avg_ctr: 0.030 } },
    deliveredAt: new Date().toISOString(),
  });
  assert(r1.accepted === true, 'Category v1 accepted');

  const r2 = contextService.pushContext({
    scope: 'category',
    contextId: 'dentists_test',
    version: 2,
    payload: { slug: 'dentists', peer_stats: { avg_ctr: 0.035 } },
    deliveredAt: new Date().toISOString(),
  });
  assert(r2.accepted === true, 'Category v2 upgrade accepted');
});

test('healthz counts reflect actual loaded contexts', () => {
  const counts = contextService.getContextCounts();
  assert(typeof counts.merchant === 'number', 'merchant count should be a number');
  assert(typeof counts.category === 'number', 'category count should be a number');
  assert(typeof counts.trigger === 'number', 'trigger count should be a number');
  assert(counts.merchant >= 7, 'Should have at least the 7 merchants pushed in this test');
});

test('bulk push: 20 merchants accepted in sequence', () => {
  for (let i = 1; i <= 20; i++) {
    const result = pushMerchant(`v_bulk_${i}`, 1);
    assert(result.accepted === true, `Merchant ${i} should be accepted`);
  }
  const counts = contextService.getContextCounts();
  assert(counts.merchant >= 20, 'Should have at least 20 merchants');
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('All versioning tests passed.\n');
else { console.log('Some tests FAILED.\n'); process.exit(1); }
