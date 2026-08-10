/**
 * Chat session and message persistence.
 */

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

/** Matches chat_sessions_user_recent_idx. */
export const listSessionsForUser = async (executor, userId, limit = 30) => {
  const { rows } = await executor.query(
    `SELECT ${SESSION_COLUMNS}
       FROM chat_sessions
      WHERE user_id = $1
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toSession);
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
  setTitleIfEmpty,
};
