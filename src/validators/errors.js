'use strict';

/**
 * Base class for all application-level errors.
 *
 * Using a class hierarchy lets the error handler distinguish operational
 * errors (known, expected failure modes) from programming errors (bugs)
 * without instanceof checks scattered throughout the codebase.
 */
class AppError extends Error {
  /**
   * @param {string}  message
   * @param {number}  statusCode  HTTP status code
   * @param {string}  code        Machine-readable snake_case code
   * @param {any}     [details]   Optional extra context attached to the error response
   */
  constructor(message, statusCode, code, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'validation_error', details);
  }
}

class NotFoundError extends AppError {
  constructor(message) {
    super(message || 'Resource not found', 404, 'not_found');
  }
}

class ConflictError extends AppError {
  constructor(message, details) {
    super(message, 409, 'conflict', details);
  }
}

class InternalError extends AppError {
  constructor(message) {
    super(message || 'Internal server error', 500, 'internal_error');
    this.isOperational = false;
  }
}

module.exports = { AppError, ValidationError, NotFoundError, ConflictError, InternalError };
