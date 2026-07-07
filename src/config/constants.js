'use strict';

/**
 * Global constants shared across the entire application.
 * Values here are NEVER sourced from environment variables — they are
 * fixed invariants of the challenge contract.
 */

const VALID_SCOPES = Object.freeze(['category', 'merchant', 'customer', 'trigger']);

const VALID_SEND_AS = Object.freeze(['vera', 'merchant_on_behalf']);

const VALID_CTA = Object.freeze(['open_ended', 'binary', 'none']);

const VALID_REPLY_ACTIONS = Object.freeze(['send', 'wait', 'end']);

const VALID_FROM_ROLES = Object.freeze(['merchant', 'customer']);

const API_VERSION = 'v1';

const API_PREFIX = `/${API_VERSION}`;

/** Maximum number of actions a bot may return in a single /v1/tick response */
const MAX_ACTIONS_PER_TICK = 20;

/** Maximum conversation turns before the bot should attempt a graceful exit */
const MAX_TURNS_PER_CONVERSATION = 5;

/** Number of consecutive identical merchant messages before classifying as auto-reply */
const AUTO_REPLY_THRESHOLD = 3;

/** Judge's per-call SLA in milliseconds */
const JUDGE_TIMEOUT_MS = 30_000;

/** How long (ms) the bot should back off when it returns action=wait with no wait_seconds */
const DEFAULT_WAIT_SECONDS = 1_800;

/** Uptime start timestamp (process-level singleton) */
const SERVER_START_TIME = Date.now();

/**
 * Maximum number of messages kept per merchant in conversation history.
 * Older entries are automatically trimmed when this cap is exceeded.
 */
const MAX_CONVERSATION_MESSAGES = 100;

/**
 * All valid states in the MerchantStateMachine.
 * Transitions between these states are deterministic and driven by
 * real signals from performance data, subscription status, and engagement.
 */
const MERCHANT_STATES = Object.freeze({
  NEW: 'NEW',
  ACTIVE: 'ACTIVE',
  WAITING_REPLY: 'WAITING_REPLY',
  HIGH_PERFORMING: 'HIGH_PERFORMING',
  LOW_PERFORMING: 'LOW_PERFORMING',
  DECLINING: 'DECLINING',
  RECOVERING: 'RECOVERING',
  CAMPAIGN_RUNNING: 'CAMPAIGN_RUNNING',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  CUSTOMER_ENGAGED: 'CUSTOMER_ENGAGED',
  CUSTOMER_INACTIVE: 'CUSTOMER_INACTIVE',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
});

module.exports = {
  VALID_SCOPES,
  VALID_SEND_AS,
  VALID_CTA,
  VALID_REPLY_ACTIONS,
  VALID_FROM_ROLES,
  API_VERSION,
  API_PREFIX,
  MAX_ACTIONS_PER_TICK,
  MAX_TURNS_PER_CONVERSATION,
  MAX_CONVERSATION_MESSAGES,
  AUTO_REPLY_THRESHOLD,
  JUDGE_TIMEOUT_MS,
  DEFAULT_WAIT_SECONDS,
  SERVER_START_TIME,
  MERCHANT_STATES,
};
