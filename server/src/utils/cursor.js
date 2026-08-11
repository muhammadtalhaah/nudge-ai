/**
 * Opaque pagination cursors.
 *
 * A cursor is a base64url-encoded JSON object naming the last row of a page. It is opaque on
 * purpose: the client passes back whatever it was given and never constructs one, so the sort
 * key stays an implementation detail the server can change without breaking a caller that
 * hard-coded its shape.
 *
 * Opaque is not the same as trusted. What comes back is attacker-controlled text and is
 * validated against a schema before use, exactly like a request body.
 */

/** @param {object} payload */
export const encodeCursor = (payload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

/**
 * @param {string} raw
 * @returns {object | null} Null when the string is not a base64url-encoded JSON object —
 *   which the caller should treat as a bad request, not as "no cursor".
 */
export const decodeCursor = (raw) => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export default { encodeCursor, decodeCursor };
