'use strict';

require('dotenv').config();

/**
 * Central configuration loader.
 * All environment variables are resolved here exactly once.
 * Import this module everywhere you need configuration — never read
 * process.env directly in other modules.
 */

function requireEnv(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key, defaultValue) {
  return process.env[key] !== undefined ? process.env[key] : defaultValue;
}

function optionalInt(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: "${raw}"`);
  }
  return parsed;
}

const config = {
  env: optionalEnv('NODE_ENV', 'development'),
  port: optionalInt('PORT', 3000),

  isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
  isDevelopment: optionalEnv('NODE_ENV', 'development') === 'development',

  log: {
    level: optionalEnv('LOG_LEVEL', 'info'),
    dir: optionalEnv('LOG_DIR', 'logs'),
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 60_000),
    max: optionalInt('RATE_LIMIT_MAX', 200),
  },

  context: {
    maxSizeBytes: optionalInt('MAX_CONTEXT_SIZE_BYTES', 512_000),
  },

  bot: {
    teamName: optionalEnv('TEAM_NAME', 'Team Vera'),
    teamMembers: optionalEnv('TEAM_MEMBERS', 'Alice,Bob')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    model: optionalEnv('BOT_MODEL', 'claude-opus-4-7'),
    approach: optionalEnv(
      'BOT_APPROACH',
      'single-prompt composer with retrieval over digest items'
    ),
    contactEmail: optionalEnv('CONTACT_EMAIL', 'team@example.com'),
    version: optionalEnv('BOT_VERSION', '1.0.0'),
    submittedAt: optionalEnv('BOT_SUBMITTED_AT', new Date().toISOString()),
  },
};

module.exports = config;
