'use strict';

const { Router } = require('express');
const { healthz, metadata } = require('../controllers/systemController');

const router = Router();

/**
 * GET /v1/healthz
 * Liveness probe — polled by the judge every 60 seconds.
 */
router.get('/healthz', healthz);

/**
 * GET /v1/metadata
 * Bot identity — called once during judge warmup.
 */
router.get('/metadata', metadata);

module.exports = router;
