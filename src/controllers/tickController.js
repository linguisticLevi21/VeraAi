'use strict';

const { validateTickBody } = require('../validators/schemas');
const { processTick } = require('../services/tickService');
const { success } = require('../utils/response');

/**
 * POST /v1/tick
 *
 * Periodic wake-up call from the judge. The bot evaluates its current
 * context state and returns zero or more proactive action objects.
 *
 * Critical constraint: must respond within 30 seconds. If processing
 * cannot complete in time, the service layer returns [] immediately.
 *
 * Success response (200):
 *   { actions: ActionItem[] }
 */
async function tickHandler(req, res, next) {
  try {
    validateTickBody(req.body);
  } catch (err) {
    return next(err);
  }

  try {
    const { now, available_triggers = [] } = req.body;

    const result = await processTick({
      now,
      availableTriggers: available_triggers,
      log: req.log,
    });

    // Enrich observability log with first action details
    if (result.actions && result.actions.length > 0) {
      const first = result.actions[0];
      res.locals.observability.merchantId = first.merchant_id;
      res.locals.observability.strategy = first.template_name;
    }

    return success(res, result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { tickHandler };
