'use strict';

const { getContextCounts } = require('../services/contextService');
const { success } = require('../utils/response');
const { SERVER_START_TIME } = require('../config/constants');
const config = require('../config');

/**
 * GET /v1/healthz
 *
 * Liveness probe polled by the judge every 60 seconds.
 * Three consecutive failures → bot disqualified.
 *
 * Response shape (challenge contract §2.4):
 * {
 *   status:          "ok",
 *   uptime_seconds:  number,
 *   contexts_loaded: { category, merchant, customer, trigger }
 * }
 */
function healthz(req, res) {
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  const contextsLoaded = getContextCounts();

  return success(res, {
    status: 'ok',
    uptime_seconds: uptimeSeconds,
    contexts_loaded: contextsLoaded,
  });
}

/**
 * GET /v1/metadata
 *
 * Bot identity endpoint. Called once during the judge warmup phase.
 *
 * Response shape (challenge contract §2.5):
 * {
 *   team_name, team_members, model, approach,
 *   contact_email, version, submitted_at
 * }
 */
function metadata(req, res) {
  return success(res, {
    team_name: config.bot.teamName,
    team_members: config.bot.teamMembers,
    model: config.bot.model,
    approach: config.bot.approach,
    contact_email: config.bot.contactEmail,
    version: config.bot.version,
    submitted_at: config.bot.submittedAt,
  });
}

module.exports = { healthz, metadata };
