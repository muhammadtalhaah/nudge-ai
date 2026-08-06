/**
 * Application error types.
 *
 * Services throw these; the error middleware is the only place that turns them into an
 * HTTP response. That keeps services free of HTTP concepts and means every error leaves
 * the API in the same envelope shape.
 */

import { ERROR_CODES, type ErrorCode } from '@shared/constants.ts';

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  /** Field-level detail for validation failures; surfaced to the client verbatim. */
  readonly details?: FieldIssue[];
  /** Marks errors we raised deliberately, as opposed to a crash. */
  readonly isOperational = true;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request contains invalid data', details?: FieldIssue[]) {
    super(422, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHENTICATED) {
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
  constructor(code: ErrorCode, message: string) {
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
  constructor(code: ErrorCode, message: string) {
    super(400, code, message);
  }
}

export class AiUnavailableError extends AppError {
  constructor(message = 'The assistant is unavailable right now') {
    super(503, ERROR_CODES.AI_UNAVAILABLE, message);
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
