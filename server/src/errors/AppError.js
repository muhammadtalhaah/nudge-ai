/**
 * Application error types.
 *
 * Services throw these; the error middleware is the only place that turns them into an
 * HTTP response. That keeps services free of HTTP concepts and means every error leaves
 * the API in the same envelope shape.
 */

import { ERROR_CODES } from '../../../shared/constants.js';

/**
 * Field-level detail for a validation failure, surfaced to the client verbatim.
 *
 * @typedef {object} FieldIssue
 * @property {string} path Dotted path of the offending field, or `_root`.
 * @property {string} message Human-readable reason, shown next to the form field.
 */

export class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code One of ERROR_CODES.
   * @param {string} message
   * @param {FieldIssue[]} [details]
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    /** Marks errors we raised deliberately, as opposed to a crash. */
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request contains invalid data', details) {
    super(422, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', code = ERROR_CODES.UNAUTHENTICATED) {
    super(401, code, message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // Deliberately identical whether the email is unknown or the password is wrong —
    // a differing message turns the login form into an account enumeration oracle.
    super(401, ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(403, ERROR_CODES.FORBIDDEN, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, ERROR_CODES.NOT_FOUND, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code, message) {
    super(409, code, message);
  }
}

/** Raised when the double-booking exclusion constraint rejects a write. */
export class SlotUnavailableError extends ConflictError {
  constructor(message = 'That time is no longer available. Please choose another slot.') {
    super(ERROR_CODES.SLOT_UNAVAILABLE, message);
  }
}

export class EmailTakenError extends ConflictError {
  constructor() {
    super(ERROR_CODES.EMAIL_TAKEN, 'An account with that email already exists');
  }
}

export class BadRequestError extends AppError {
  constructor(code, message) {
    super(400, code, message);
  }
}

export class AiUnavailableError extends AppError {
  constructor(message = 'The assistant is unavailable right now') {
    super(503, ERROR_CODES.AI_UNAVAILABLE, message);
  }
}

export const isAppError = (error) => error instanceof AppError;
