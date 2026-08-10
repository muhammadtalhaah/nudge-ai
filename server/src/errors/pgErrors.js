/**
 * Translates PostgreSQL error codes into application errors.
 *
 * This is the seam that lets the database enforce invariants while the API still returns
 * a meaningful status. Without it, the exclusion constraint doing its job would surface
 * as an opaque 500.
 */

import { ERROR_CODES } from '../../../shared/constants.js';

import { ConflictError, SlotUnavailableError } from './AppError.js';

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  NOT_NULL_VIOLATION: '23502',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
};

/**
 * Narrow an unknown throw to something that looks like a pg driver error.
 *
 * A `code` string is the only marker worth trusting — everything else about the object is
 * driver detail, and anything without one did not come from the database.
 */
const asPgError = (error) => {
  if (typeof error !== 'object' || error === null) return null;
  return typeof error.code === 'string' ? error : null;
};

/**
 * Returns an AppError when the failure is a database constraint we understand, or null to
 * let the caller treat it as an unexpected error.
 *
 * Constraint names are matched explicitly rather than by pattern: if a constraint is
 * renamed, this returns null and the request 500s loudly, which is preferable to silently
 * reporting the wrong reason.
 */
export const translatePgError = (error) => {
  const pgError = asPgError(error);
  if (!pgError) return null;

  switch (pgError.code) {
    case PG_CODES.EXCLUSION_VIOLATION: {
      if (pgError.constraint === 'appointments_provider_no_overlap') {
        return new SlotUnavailableError('That time was just taken. Please pick another slot.');
      }
      if (pgError.constraint === 'appointments_user_no_overlap') {
        return new SlotUnavailableError('You already have an appointment that overlaps this time.');
      }
      return new SlotUnavailableError();
    }

    case PG_CODES.UNIQUE_VIOLATION: {
      if (pgError.constraint === 'users_business_email_key') {
        return new ConflictError(
          ERROR_CODES.EMAIL_TAKEN,
          'An account with that email already exists',
        );
      }
      return new ConflictError(ERROR_CODES.VALIDATION_ERROR, 'That value is already in use');
    }

    case PG_CODES.CHECK_VIOLATION:
      return new ConflictError(
        ERROR_CODES.VALIDATION_ERROR,
        'The request would leave the record in an invalid state',
      );

    case PG_CODES.FOREIGN_KEY_VIOLATION:
      return new ConflictError(ERROR_CODES.VALIDATION_ERROR, 'A referenced record does not exist');

    // Transient contention. A retry may well succeed, so tell the client that.
    case PG_CODES.SERIALIZATION_FAILURE:
    case PG_CODES.DEADLOCK_DETECTED:
    case PG_CODES.LOCK_NOT_AVAILABLE:
      return new ConflictError(
        ERROR_CODES.SLOT_UNAVAILABLE,
        'The server was busy. Please try again.',
      );

    default:
      return null;
  }
};
