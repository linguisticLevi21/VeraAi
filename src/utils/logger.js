'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors, json, splat } = format;

/** Human-readable format for local development */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  splat(),
  printf(({ level, message, timestamp: ts, requestId, ...meta }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts}${rid} ${level}: ${message}${metaStr}`;
  })
);

/** Structured JSON format for production / log aggregation */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json()
);

function buildTransports() {
  const list = [];

  list.push(new transports.Console({
    silent: false,
    format: config.isProduction ? prodFormat : devFormat,
  }));

  if (config.isProduction) {
    const logDir = path.resolve(config.log.dir);

    list.push(
      new transports.DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: prodFormat,
      })
    );

    list.push(
      new transports.DailyRotateFile({
        level: 'error',
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: prodFormat,
      })
    );
  }

  return list;
}

const logger = createLogger({
  level: config.log.level,
  transports: buildTransports(),
  exitOnError: false,
});

/**
 * Returns a child logger pre-bound with the given requestId.
 * Controllers and services call this at the top of each request handler
 * so every log line in that call carries the request ID automatically.
 *
 * @param {string} requestId
 * @returns {import('winston').Logger}
 */
logger.forRequest = function forRequest(requestId) {
  return logger.child({ requestId });
};

module.exports = logger;
