'use strict';

const { Router } = require('express');
const { pushContextHandler } = require('../controllers/contextController');
const { tickHandler } = require('../controllers/tickController');
const { replyHandler } = require('../controllers/replyController');

const router = Router();

/**
 * POST /v1/context
 * Receive a context push from the judge.
 */
router.post('/context', pushContextHandler);

/**
 * POST /v1/tick
 * Periodic wake-up — bot evaluates and optionally initiates conversations.
 */
router.post('/tick', tickHandler);

/**
 * POST /v1/reply
 * Receive a merchant/customer reply and return the next bot action.
 */
router.post('/reply', replyHandler);

module.exports = router;
