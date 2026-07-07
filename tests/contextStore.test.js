'use strict';

/**
 * ContextStore unit tests.
 *
 * Run with: node tests/contextStore.test.js
 *
 * Uses Node's built-in assert module — no test runner required for the
 * foundation phase. Tests will be migrated to a proper runner (Jest/Vitest)
 * when the AI reasoning layer is added.
 */

const assert = require('assert');

// We need a fresh store instance for each test, so we re-require with a cleared cache.
function freshStore() {
  delete require.cache[require.resolve('../src/memory/contextStore')];
  return require('../src/memory/contextStore');
}

// ── Test 1: Accept new context ────────────────────────────────────────────────
{
  const store = freshStore();
  const result = store.upsert('merchant', 'm_001', 1, { name: 'Dr. Meera' });
  assert.strictEqual(result.accepted, true, 'Should accept new context');
  assert.ok(result.stored_at, 'Should return stored_at timestamp');
  console.log('PASS ContextStore: accepts new context');
}

// ── Test 2: Idempotent on same version ────────────────────────────────────────
{
  const store = freshStore();
  store.upsert('merchant', 'm_001', 1, { name: 'Dr. Meera' });
  const result = store.upsert('merchant', 'm_001', 1, { name: 'Dr. Meera' });
  assert.strictEqual(result.accepted, true, 'Same version should be idempotent (accepted: true)');
  console.log('PASS ContextStore: idempotent on same version');
}

// ── Test 3: Reject stale version ──────────────────────────────────────────────
{
  const store = freshStore();
  store.upsert('merchant', 'm_001', 5, { name: 'Dr. Meera v5' });
  const result = store.upsert('merchant', 'm_001', 3, { name: 'Dr. Meera v3' });
  assert.strictEqual(result.accepted, false, 'Should reject stale version');
  assert.strictEqual(result.reason, 'stale_version');
  assert.strictEqual(result.current_version, 5);
  console.log('PASS ContextStore: rejects stale version with 409 shape');
}

// ── Test 4: Accept higher version ────────────────────────────────────────────
{
  const store = freshStore();
  store.upsert('merchant', 'm_001', 1, { name: 'v1' });
  const result = store.upsert('merchant', 'm_001', 2, { name: 'v2' });
  assert.strictEqual(result.accepted, true, 'Should accept higher version');
  const entry = store.getPayload('merchant', 'm_001');
  assert.strictEqual(entry.name, 'v2', 'Payload should be updated to new version');
  console.log('PASS ContextStore: accepts higher version and updates payload');
}

// ── Test 5: counts() returns correct breakdown ────────────────────────────────
{
  const store = freshStore();
  store.upsert('category', 'dentists', 1, {});
  store.upsert('merchant', 'm_001', 1, {});
  store.upsert('merchant', 'm_002', 1, {});
  store.upsert('customer', 'c_001', 1, {});
  store.upsert('trigger', 'trg_001', 1, {});
  const counts = store.counts();
  assert.strictEqual(counts.category, 1);
  assert.strictEqual(counts.merchant, 2);
  assert.strictEqual(counts.customer, 1);
  assert.strictEqual(counts.trigger, 1);
  console.log('PASS ContextStore: counts() returns correct scope breakdown');
}

// ── Test 6: getAllByScope returns correct entries ──────────────────────────────
{
  const store = freshStore();
  store.upsert('merchant', 'm_001', 1, { name: 'M1' });
  store.upsert('merchant', 'm_002', 1, { name: 'M2' });
  store.upsert('category', 'salons', 1, {});
  const merchants = store.getAllByScope('merchant');
  assert.strictEqual(merchants.length, 2, 'Should return only merchant entries');
  console.log('PASS ContextStore: getAllByScope filters correctly');
}

// ── Test 7: clear() wipes all entries ────────────────────────────────────────
{
  const store = freshStore();
  store.upsert('merchant', 'm_001', 1, {});
  store.upsert('category', 'dentists', 1, {});
  store.clear();
  const counts = store.counts();
  assert.strictEqual(counts.merchant, 0);
  assert.strictEqual(counts.category, 0);
  console.log('PASS ContextStore: clear() wipes all entries');
}

console.log('\nAll ContextStore tests passed.');
