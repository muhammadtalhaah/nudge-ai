/**
 * Map a server error onto a react-hook-form's fields.
 *
 * The API returns `details: [{ path, message }]` for validation failures. Feeding those back
 * onto the exact fields is what makes server-side validation feel like part of the form rather
 * than a banner at the top that the user has to reconcile themselves.
 */

/**
 * @param error   the normalised error from the API client
 * @param setError react-hook-form's setError
 * @param knownFields field names present in this form
 * @returns the message to show at form level, or null if everything was field-specific
 */
export const applyServerErrors = (error, setError, knownFields = []) => {
  if (!error) return null;

  const details = Array.isArray(error.details) ? error.details : [];
  let matchedAny = false;

  for (const detail of details) {
    if (knownFields.includes(detail.path)) {
      setError(detail.path, { type: 'server', message: detail.message });
      matchedAny = true;
    }
  }

  // A duplicate-email conflict has no `details`, but it is unambiguously about one field.
  if (error.code === 'EMAIL_TAKEN' && knownFields.includes('email')) {
    setError('email', { type: 'server', message: error.message });
    return null;
  }

  // Anything not attributable to a field is shown as a form-level message, so an error is
  // never silently swallowed.
  return matchedAny ? null : error.message;
};

export default applyServerErrors;
