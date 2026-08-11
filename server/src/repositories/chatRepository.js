/**
 * Chat session and message persistence.
 */

import { REPLY_KIND } from '../../../shared/constants.js';

const toSession = (row) => ({
  id: row.id,
  businessId: row.business_id,
  userId: row.user_id,
  title: row.title,
  status: row.status,
  messageCount: row.message_count,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
});

/** `extractedData` holds the built reply payload for assistant turns, null otherwise. */
const toMessage = (row) => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  extractedData: row.extracted_data,
  createdAt: row.created_at,
});

const SESSION_COLUMNS =
  'id, business_id, user_id, title, status, message_count, last_message_at, created_at';

/**
 * @param {{ businessId: string, userId: string, title?: string | null }} input
 */
export const createSession = async (executor, input) => {
  const { rows } = await executor.query(
    `INSERT INTO chat_sessions (business_id, user_id, title)
     VALUES ($1, $2, $3)
     RETURNING ${SESSION_COLUMNS}`,
    [input.businessId, input.userId, input.title ?? null],
  );

  const row = rows[0];
  if (!row) throw new Error('INSERT ... RETURNING produced no row');
  return toSession(row);
};

/** Unscoped; the service authorises the result. */
export const findSessionById = async (executor, id) => {
  const { rows } = await executor.query(
    `SELECT ${SESSION_COLUMNS} FROM chat_sessions WHERE id = $1`,
    [id],
  );
  return rows[0] ? toSession(rows[0]) : null;
};

/**
 * One page of a user's conversations, newest activity first.
 *
 * Ordered by `COALESCE(last_message_at, created_at)` rather than by `last_message_at` with
 * nulls last. Two things follow from collapsing it to one non-null key, and both matter:
 *
 *   A conversation with no messages yet sorts by when it was created, which puts a
 *   just-started one at the top where the person who just started it is looking. Under nulls
 *   last it went to the very bottom — invisible in a list this long, and on the final page
 *   once that list is paginated.
 *
 *   Keyset pagination becomes a single row-value comparison. `(activity, id) < (cursor)` is an
 *   exact "everything after this row" in the same order the query sorts by, with `id` breaking
 *   ties so no row can sit on a page boundary and be returned twice or skipped.
 *
 * `chat_sessions_user_recent_idx` still serves the `user_id` lookup; the ordering itself is a
 * small in-memory sort, which is the right trade for a per-user list of this size.
 *
 * @param {{ limit: number, after?: { activityAt: Date, id: string } | null }} options
 * @returns {Promise<{ items: object[], nextCursor: { activityAt: Date, id: string } | null }>}
 */
export const listSessionsForUser = async (executor, userId, options = {}) => {
  const limit = options.limit ?? 30;
  const after = options.after ?? null;

  // One more than asked for: whether a further page exists is then a fact about this result,
  // not a guess. Without it the last full page is followed by an empty one, and the scroll
  // sentinel fires a pointless request to discover the list had already ended.
  const { rows } = await executor.query(
    `SELECT ${SESSION_COLUMNS}, COALESCE(last_message_at, created_at) AS activity_at
       FROM chat_sessions
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL
             OR (COALESCE(last_message_at, created_at), id) < ($2::timestamptz, $3::uuid))
      ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
      LIMIT $4`,
    [userId, after?.activityAt ?? null, after?.id ?? null, limit + 1],
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(toSession),
    nextCursor: hasMore && last ? { activityAt: last.activity_at, id: last.id } : null,
  };
};

/**
 * @param {{ sessionId: string, role: string, content: string,
 *           extractedData?: object | null }} input
 */
export const addMessage = async (executor, input) => {
  const { rows } = await executor.query(
    `INSERT INTO chat_messages (session_id, role, content, extracted_data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, session_id, role, content, extracted_data, created_at`,
    [
      input.sessionId,
      input.role,
      input.content,
      input.extractedData ? JSON.stringify(input.extractedData) : null,
    ],
  );

  const row = rows[0];
  if (!row) throw new Error('INSERT ... RETURNING produced no row');

  // Denormalised counters, updated in the same transaction as the insert so they cannot
  // drift from the messages they describe.
  await executor.query(
    `UPDATE chat_sessions
        SET message_count = message_count + 1, last_message_at = $2
      WHERE id = $1`,
    [input.sessionId, row.created_at],
  );

  return toMessage(row);
};

/** Full transcript, oldest first — used to replay a conversation in the UI. */
export const listMessages = async (executor, sessionId) => {
  const { rows } = await executor.query(
    `SELECT id, session_id, role, content, extracted_data, created_at
       FROM chat_messages
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC`,
    [sessionId],
  );
  return rows.map(toMessage);
};

/**
 * The last N turns, for the model's context window. "Simple memory is sufficient" per the
 * brief — no summarisation, no embeddings, just a bounded tail.
 *
 * Fetched newest-first with a LIMIT so the database does the trimming, then reversed into
 * chronological order for the prompt.
 */
export const listRecentTurns = async (executor, sessionId, limit) => {
  const { rows } = await executor.query(
    `SELECT role, content
       FROM chat_messages
      WHERE session_id = $1 AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [sessionId, limit * 2],
  );

  return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
};

/**
 * The `kind` of the most recent assistant reply in a session, or null if there is none.
 *
 * Read from the stored reply payload rather than recomputed, so it always reflects what the
 * user was actually shown.
 */
export const findLastReplyKind = async (executor, sessionId) => {
  const { rows } = await executor.query(
    `SELECT extracted_data->>'kind' AS kind
       FROM chat_messages
      WHERE session_id = $1 AND role = 'assistant'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [sessionId],
  );
  return rows[0]?.kind ?? null;
};

/**
 * What the conversation has already established about the booking under discussion.
 *
 * Derived from the last reply that carried one, rather than stored in a column of its own.
 * The reply payload is already persisted so the UI can replay a conversation, and a second
 * copy of the same facts would only be somewhere for the two to disagree.
 *
 * Any reply kind that prefills something contributes — the booking form and a list of free
 * slots settle exactly the same kind of fact, and a slot list is how "and Friday?" keeps hold
 * of whose Friday. Two rules then make it correct:
 *
 *   A completed booking ends the draft. Without that, the details of the appointment someone
 *   just booked linger, and the next vague message books it again.
 *
 *   Fields the reply itself named in `missing` are dropped. That single line is what makes a
 *   refused slot forget the time while keeping the doctor: when `book` fails on "that slot is
 *   taken", the fallback prefills the time the user tried — so they can see and amend it —
 *   but lists it as missing, which is the reply saying that value is not settled.
 *
 * @returns {Promise<import('../../../shared/chat.js').BookingFormPrefill>} Empty when there
 *   is nothing in progress.
 */
export const findBookingDraft = async (executor, sessionId) => {
  const { rows } = await executor.query(
    `SELECT extracted_data AS reply
       FROM chat_messages
      WHERE session_id = $1
        AND role = 'assistant'
        AND extracted_data->>'kind' = ANY($2)
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [sessionId, [REPLY_KIND.FORM_FALLBACK, REPLY_KIND.SLOT_LIST, REPLY_KIND.APPOINTMENT_CREATED]],
  );

  const reply = rows[0]?.reply;
  if (!reply || reply.kind === REPLY_KIND.APPOINTMENT_CREATED) return {};

  const settled = Array.isArray(reply.missing) ? reply.missing : [];
  const prefill = reply.prefill ?? {};
  const keep = (field, value) => (settled.includes(field) ? null : (value ?? null));

  return {
    providerId: keep('providerName', prefill.providerId),
    specialty: keep('specialty', prefill.specialty),
    date: keep('date', prefill.date),
    time: keep('time', prefill.time),
    notes: prefill.notes ?? null,
  };
};

/** Derived from the first user message so the session list is scannable. */
export const setTitleIfEmpty = async (executor, sessionId, title) => {
  await executor.query('UPDATE chat_sessions SET title = $2 WHERE id = $1 AND title IS NULL', [
    sessionId,
    title.slice(0, 120),
  ]);
};

export default {
  createSession,
  findSessionById,
  listSessionsForUser,
  addMessage,
  listMessages,
  listRecentTurns,
  findLastReplyKind,
  findBookingDraft,
  setTitleIfEmpty,
};
