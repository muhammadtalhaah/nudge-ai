/**
 * Server-error mapping.
 *
 * This is the seam that decides whether a server validation failure shows up next to the
 * offending input or as an unhelpful banner, so it is worth testing directly.
 */

import { describe, expect, it, vi } from 'vitest';

import { applyServerErrors } from './serverErrors';

describe('applyServerErrors', () => {
  it('returns null for no error', () => {
    expect(applyServerErrors(null, vi.fn(), ['email'])).toBeNull();
  });

  it('attaches a detail to a known field and reports no form-level message', () => {
    const setError = vi.fn();
    const result = applyServerErrors(
      {
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: [{ path: 'email', message: 'Already used' }],
      },
      setError,
      ['email', 'password'],
    );

    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Already used' });
    expect(result).toBeNull();
  });

  it('falls back to a form-level message when the field is not in this form', () => {
    const setError = vi.fn();
    const result = applyServerErrors(
      {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid data',
        details: [{ path: 'somethingElse', message: 'Nope' }],
      },
      setError,
      ['email'],
    );

    // Never silently swallowed — an error the form cannot place still gets shown.
    expect(setError).not.toHaveBeenCalled();
    expect(result).toBe('The request contains invalid data');
  });

  it('routes EMAIL_TAKEN to the email field even with no details array', () => {
    const setError = vi.fn();
    const result = applyServerErrors(
      { code: 'EMAIL_TAKEN', message: 'An account with that email already exists', details: null },
      setError,
      ['email', 'password'],
    );

    expect(setError).toHaveBeenCalledWith('email', {
      type: 'server',
      message: 'An account with that email already exists',
    });
    expect(result).toBeNull();
  });

  it('returns the message for an error with no details at all', () => {
    const result = applyServerErrors(
      { code: 'NETWORK_ERROR', message: 'Could not reach the server.', details: null },
      vi.fn(),
      ['email'],
    );
    expect(result).toBe('Could not reach the server.');
  });
});
