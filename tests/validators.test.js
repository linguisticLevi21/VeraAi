'use strict';

/**
 * Schema validators unit tests.
 *
 * Run with: node tests/validators.test.js
 */

const assert = require('assert');
const { validateContextBody, validateTickBody, validateReplyBody } = require('../src/validators/schemas');
const { ValidationError } = require('../src/validators/errors');

// ── validateContextBody ───────────────────────────────────────────────────────

{
  // Valid body — should not throw
  try {
    validateContextBody({
      scope: 'merchant',
      context_id: 'm_001_drmeera',
      version: 1,
      payload: { merchant_id: 'm_001_drmeera' },
      delivered_at: '2026-04-26T10:00:00Z',
    });
    console.log('PASS validateContextBody: valid body passes');
  } catch (e) {
    console.error('FAIL validateContextBody: valid body threw', e.message);
    process.exit(1);
  }
}

{
  // Invalid scope — should throw ValidationError
  try {
    validateContextBody({
      scope: 'invalid_scope',
      context_id: 'm_001',
      version: 1,
      payload: {},
      delivered_at: '2026-04-26T10:00:00Z',
    });
    console.error('FAIL validateContextBody: should have thrown on invalid scope');
    process.exit(1);
  } catch (e) {
    assert.ok(e instanceof ValidationError, 'Should throw ValidationError');
    assert.ok(e.details.some((d) => d.field === 'scope'), 'Details should include scope field error');
    console.log('PASS validateContextBody: rejects invalid scope');
  }
}

{
  // Missing required fields — should throw with multiple field errors
  try {
    validateContextBody({ scope: 'merchant' });
    console.error('FAIL validateContextBody: should have thrown on missing fields');
    process.exit(1);
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    assert.ok(e.details.length > 1, 'Should report multiple missing fields');
    console.log('PASS validateContextBody: reports all missing fields at once');
  }
}

// ── validateTickBody ──────────────────────────────────────────────────────────

{
  // Valid body
  try {
    validateTickBody({ now: '2026-04-26T10:30:00Z', available_triggers: ['trg_001'] });
    console.log('PASS validateTickBody: valid body passes');
  } catch (e) {
    console.error('FAIL validateTickBody: valid body threw', e.message);
    process.exit(1);
  }
}

{
  // Missing 'now'
  try {
    validateTickBody({ available_triggers: [] });
    console.error('FAIL validateTickBody: should have thrown on missing now');
    process.exit(1);
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    console.log('PASS validateTickBody: rejects missing now');
  }
}

// ── validateReplyBody ─────────────────────────────────────────────────────────

{
  // Valid body
  try {
    validateReplyBody({
      conversation_id: 'conv_001',
      merchant_id: 'm_001_drmeera',
      customer_id: null,
      from_role: 'merchant',
      message: 'Yes, send me the abstract',
      received_at: '2026-04-26T10:45:00Z',
      turn_number: 2,
    });
    console.log('PASS validateReplyBody: valid body passes');
  } catch (e) {
    console.error('FAIL validateReplyBody: valid body threw', e.message);
    process.exit(1);
  }
}

{
  // Invalid from_role
  try {
    validateReplyBody({
      conversation_id: 'conv_001',
      from_role: 'bot',
      message: 'Hello',
      received_at: '2026-04-26T10:45:00Z',
      turn_number: 1,
    });
    console.error('FAIL validateReplyBody: should have thrown on invalid from_role');
    process.exit(1);
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    console.log('PASS validateReplyBody: rejects invalid from_role');
  }
}

console.log('\nAll validator tests passed.');
