'use strict';

const { ValidationError } = require('./errors');
const { VALID_SCOPES } = require('../config/constants');

/**
 * Validates the body of POST /v1/context.
 *
 * Rules (per challenge contract §2.1):
 * - scope        : required, one of VALID_SCOPES
 * - context_id   : required, non-empty string
 * - version      : required, positive integer
 * - payload      : required, non-null object
 * - delivered_at : required, parseable ISO-8601 string
 *
 * Throws ValidationError on failure so the controller catches it cleanly.
 *
 * @param {object} body - req.body
 */
function validateContextBody(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object.', null);
  }

  const { scope, context_id, version, payload, delivered_at } = body;

  if (!scope) {
    errors.push({ field: 'scope', message: 'scope is required.' });
  } else if (!VALID_SCOPES.includes(scope)) {
    errors.push({
      field: 'scope',
      message: `scope must be one of: ${VALID_SCOPES.join(', ')}. Got: "${scope}".`,
    });
  }

  if (!context_id || typeof context_id !== 'string' || context_id.trim() === '') {
    errors.push({ field: 'context_id', message: 'context_id must be a non-empty string.' });
  }

  if (version === undefined || version === null) {
    errors.push({ field: 'version', message: 'version is required.' });
  } else if (!Number.isInteger(version) || version < 1) {
    errors.push({ field: 'version', message: 'version must be a positive integer.' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push({ field: 'payload', message: 'payload must be a non-null JSON object.' });
  }

  if (!delivered_at || typeof delivered_at !== 'string') {
    errors.push({ field: 'delivered_at', message: 'delivered_at must be an ISO-8601 string.' });
  } else if (Number.isNaN(Date.parse(delivered_at))) {
    errors.push({ field: 'delivered_at', message: `delivered_at is not a valid date: "${delivered_at}".` });
  }

  if (errors.length > 0) {
    throw new ValidationError('Context body validation failed.', errors);
  }
}

/**
 * Validates the body of POST /v1/tick.
 *
 * Rules (per challenge contract §2.2):
 * - now                : required, parseable ISO-8601 string
 * - available_triggers : optional, must be an array of strings if present
 *
 * @param {object} body - req.body
 */
function validateTickBody(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object.', null);
  }

  const { now, available_triggers } = body;

  if (!now || typeof now !== 'string') {
    errors.push({ field: 'now', message: 'now is required and must be an ISO-8601 string.' });
  } else if (Number.isNaN(Date.parse(now))) {
    errors.push({ field: 'now', message: `now is not a valid date: "${now}".` });
  }

  if (available_triggers !== undefined) {
    if (!Array.isArray(available_triggers)) {
      errors.push({ field: 'available_triggers', message: 'available_triggers must be an array.' });
    } else if (available_triggers.some((t) => typeof t !== 'string')) {
      errors.push({ field: 'available_triggers', message: 'Every element of available_triggers must be a string.' });
    }
  }

  if (errors.length > 0) {
    throw new ValidationError('Tick body validation failed.', errors);
  }
}

/**
 * Validates the body of POST /v1/reply.
 *
 * Rules (per challenge contract §2.3):
 * - conversation_id : required, non-empty string
 * - merchant_id     : optional, string or null
 * - customer_id     : optional, string or null
 * - from_role       : required, "merchant" | "customer"
 * - message         : required, non-empty string
 * - received_at     : required, parseable ISO-8601 string
 * - turn_number     : required, positive integer
 *
 * @param {object} body - req.body
 */
function validateReplyBody(body) {
  const errors = [];
  const VALID_FROM_ROLES = ['merchant', 'customer'];

  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object.', null);
  }

  const { conversation_id, merchant_id, customer_id, from_role, message, received_at, turn_number } = body;

  if (!conversation_id || typeof conversation_id !== 'string' || conversation_id.trim() === '') {
    errors.push({ field: 'conversation_id', message: 'conversation_id must be a non-empty string.' });
  }

  if (merchant_id !== undefined && merchant_id !== null && typeof merchant_id !== 'string') {
    errors.push({ field: 'merchant_id', message: 'merchant_id must be a string or null.' });
  }

  if (customer_id !== undefined && customer_id !== null && typeof customer_id !== 'string') {
    errors.push({ field: 'customer_id', message: 'customer_id must be a string or null.' });
  }

  if (!from_role) {
    errors.push({ field: 'from_role', message: 'from_role is required.' });
  } else if (!VALID_FROM_ROLES.includes(from_role)) {
    errors.push({
      field: 'from_role',
      message: `from_role must be one of: ${VALID_FROM_ROLES.join(', ')}. Got: "${from_role}".`,
    });
  }

  if (!message || typeof message !== 'string' || message.trim() === '') {
    errors.push({ field: 'message', message: 'message must be a non-empty string.' });
  }

  if (!received_at || typeof received_at !== 'string') {
    errors.push({ field: 'received_at', message: 'received_at must be an ISO-8601 string.' });
  } else if (Number.isNaN(Date.parse(received_at))) {
    errors.push({ field: 'received_at', message: `received_at is not a valid date: "${received_at}".` });
  }

  if (turn_number === undefined || turn_number === null) {
    errors.push({ field: 'turn_number', message: 'turn_number is required.' });
  } else if (!Number.isInteger(turn_number) || turn_number < 1) {
    errors.push({ field: 'turn_number', message: 'turn_number must be a positive integer.' });
  }

  if (errors.length > 0) {
    throw new ValidationError('Reply body validation failed.', errors);
  }
}

module.exports = { validateContextBody, validateTickBody, validateReplyBody };
