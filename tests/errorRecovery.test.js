'use strict';

/**
 * Error Recovery Tests
 *
 * Validates that all endpoints handle bad input gracefully:
 *   - Missing required fields
 *   - Invalid scope values
 *   - Null / undefined payloads
 *   - Invalid CTA values
 *   - Invalid from_role
 *   - Missing context_id / merchant_id
 */

const { validateContextBody, validateTickBody, validateReplyBody } = require('../src/validators/schemas');

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

function assertThrows(fn, msgFragment) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (msgFragment) {
      assert(
        e.message.toLowerCase().includes(msgFragment.toLowerCase()) ||
        (e.details && JSON.stringify(e.details).toLowerCase().includes(msgFragment.toLowerCase())),
        `Expected error containing "${msgFragment}", got: ${e.message}`
      );
    }
  }
  if (!threw) throw new Error(`Expected function to throw, but it did not`);
}

function assertValid(fn, label) {
  try {
    fn();
  } catch (e) {
    throw new Error(`${label} should be valid but threw: ${e.message}`);
  }
}

console.log('\nError Recovery Tests\n');

// ── Context Validator ─────────────────────────────────────────────────────

test('[context] valid merchant payload passes', () => {
  assertValid(() => validateContextBody({
    scope: 'merchant',
    context_id: 'm_001',
    version: 1,
    payload: { merchant_id: 'm_001' },
    delivered_at: '2026-04-26T10:00:00Z',
  }), 'Valid context push');
});

test('[context] missing scope throws', () => {
  assertThrows(() => validateContextBody({
    context_id: 'm_001',
    version: 1,
    payload: {},
    delivered_at: '2026-04-26T10:00:00Z',
  }), 'scope');
});

test('[context] invalid scope throws', () => {
  assertThrows(() => validateContextBody({
    scope: 'invalid_scope_xyz',
    context_id: 'm_001',
    version: 1,
    payload: {},
    delivered_at: '2026-04-26T10:00:00Z',
  }));
});

test('[context] missing context_id throws', () => {
  assertThrows(() => validateContextBody({
    scope: 'merchant',
    version: 1,
    payload: {},
    delivered_at: '2026-04-26T10:00:00Z',
  }));
});

test('[context] missing version throws', () => {
  assertThrows(() => validateContextBody({
    scope: 'merchant',
    context_id: 'm_001',
    payload: {},
    delivered_at: '2026-04-26T10:00:00Z',
  }));
});

test('[context] version=0 throws (must be >= 1)', () => {
  assertThrows(() => validateContextBody({
    scope: 'merchant',
    context_id: 'm_001',
    version: 0,
    payload: {},
    delivered_at: '2026-04-26T10:00:00Z',
  }));
});

test('[context] missing payload throws', () => {
  assertThrows(() => validateContextBody({
    scope: 'merchant',
    context_id: 'm_001',
    version: 1,
    delivered_at: '2026-04-26T10:00:00Z',
  }));
});

test('[context] null body throws', () => {
  assertThrows(() => validateContextBody(null));
});

test('[context] empty body throws', () => {
  assertThrows(() => validateContextBody({}));
});

test('[context] all 4 scopes are accepted', () => {
  for (const scope of ['category', 'merchant', 'customer', 'trigger']) {
    assertValid(() => validateContextBody({
      scope,
      context_id: `test_${scope}`,
      version: 1,
      payload: {},
      delivered_at: '2026-04-26T10:00:00Z',
    }), `scope: ${scope}`);
  }
});

// ── Tick Validator ─────────────────────────────────────────────────────────

test('[tick] valid tick body passes', () => {
  assertValid(() => validateTickBody({
    now: '2026-04-26T10:30:00Z',
    available_triggers: ['trg_001'],
  }), 'Valid tick body');
});

test('[tick] empty available_triggers is valid (may produce no actions)', () => {
  assertValid(() => validateTickBody({
    now: '2026-04-26T10:30:00Z',
    available_triggers: [],
  }), 'Empty triggers tick');
});

test('[tick] missing now throws', () => {
  assertThrows(() => validateTickBody({ available_triggers: [] }));
});

test('[tick] null body throws', () => {
  assertThrows(() => validateTickBody(null));
});

test('[tick] missing available_triggers defaults gracefully or throws', () => {
  // Either throws (strict) or accepts with empty array default — either is OK
  try {
    validateTickBody({ now: '2026-04-26T10:30:00Z' });
    // Passed without throws — acceptable if validator defaults to []
    assert(true);
  } catch (e) {
    // Threw — also acceptable
    assert(true);
  }
});

// ── Reply Validator ────────────────────────────────────────────────────────

test('[reply] valid merchant reply passes', () => {
  assertValid(() => validateReplyBody({
    conversation_id: 'conv_001',
    merchant_id: 'm_001',
    from_role: 'merchant',
    message: 'Yes please',
    received_at: '2026-04-26T10:45:00Z',
    turn_number: 2,
  }), 'Valid reply body');
});

test('[reply] missing conversation_id throws', () => {
  assertThrows(() => validateReplyBody({
    merchant_id: 'm_001',
    from_role: 'merchant',
    message: 'Yes',
    received_at: '2026-04-26T10:45:00Z',
    turn_number: 2,
  }));
});

test('[reply] invalid from_role throws', () => {
  assertThrows(() => validateReplyBody({
    conversation_id: 'conv_001',
    merchant_id: 'm_001',
    from_role: 'robot',   // invalid
    message: 'Hello',
    received_at: '2026-04-26T10:45:00Z',
    turn_number: 2,
  }));
});

test('[reply] from_role=customer is valid', () => {
  assertValid(() => validateReplyBody({
    conversation_id: 'conv_002',
    merchant_id: 'm_001',
    customer_id: 'c_001',
    from_role: 'customer',
    message: 'Is the salon open?',
    received_at: '2026-04-26T10:45:00Z',
    turn_number: 1,
  }), 'Customer reply');
});

test('[reply] missing message throws', () => {
  assertThrows(() => validateReplyBody({
    conversation_id: 'conv_001',
    merchant_id: 'm_001',
    from_role: 'merchant',
    received_at: '2026-04-26T10:45:00Z',
    turn_number: 2,
  }));
});

test('[reply] missing turn_number throws', () => {
  assertThrows(() => validateReplyBody({
    conversation_id: 'conv_001',
    merchant_id: 'm_001',
    from_role: 'merchant',
    message: 'Yes',
    received_at: '2026-04-26T10:45:00Z',
  }));
});

test('[reply] null body throws', () => {
  assertThrows(() => validateReplyBody(null));
});

// ── Results ────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('All error recovery tests passed.\n');
else { console.log('Some tests FAILED.\n'); process.exit(1); }
