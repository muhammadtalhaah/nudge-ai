/**
 * The chat reply contract, shared by the server and the client.
 *
 * Every field here is SERVER-DERIVED. The model produces only the extraction described in
 * `aiExtractionSchema` (an intent, some fields, and prose); the server then decides what
 * actually happened and builds this payload from real database records. The model never
 * authors a doctor card, a slot list, or a confirmation — so a hallucinated appointment
 * cannot be rendered as if it were real.
 *
 * This module is documentation, not code: it carries no runtime value, only the JSDoc
 * typedefs that describe the payload both sides agree on. It is the one place to look to
 * answer "what can a chat reply contain, and who decided it". Editors resolve the typedefs
 * through `import('.../shared/chat.js')`, so the shapes still autocomplete in plain
 * JavaScript.
 */

/**
 * @typedef {object} ChatProviderSummary
 * @property {string} id
 * @property {string} fullName
 * @property {string} specialty
 * @property {number} slotDurationMinutes
 */

/**
 * @typedef {object} ChatAppointmentSummary
 * @property {string} id
 * @property {string} providerName
 * @property {string} providerSpecialty
 * @property {string} startsAt
 * @property {string} endsAt
 * @property {string} status
 */

/**
 * Values to prefill the structured booking form with when the assistant could not complete
 * a booking on its own. This is the brief's "fallback to structured forms if user input is
 * incomplete or ambiguous" — the user finishes in a couple of clicks instead of retyping.
 *
 * @typedef {object} BookingFormPrefill
 * @property {string | null} [providerId]
 * @property {string | null} [specialty]
 * @property {string | null} [date]
 * @property {string | null} [time]
 * @property {string | null} [notes]
 */

/**
 * @typedef {object} ChatReply
 * @property {string} kind One of REPLY_KIND.
 * @property {string} text Prose shown to the user.
 * @property {BookingFormPrefill} [prefill] Present when kind is FORM_FALLBACK.
 * @property {string[]} [missing] Which booking details are still needed, so the UI can
 *   highlight them. Values come from BOOKING_FIELDS.
 * @property {ChatProviderSummary[]} [providers] Candidate providers, when the assistant is
 *   helping narrow a choice.
 * @property {ChatAppointmentSummary} [appointment] Set when kind is APPOINTMENT_CREATED.
 * @property {ChatAppointmentSummary[]} [appointments] Set when kind is APPOINTMENT_LIST.
 * @property {string[]} [slots] Free start times as ISO instants, set when kind is SLOT_LIST.
 *   Instants rather than "10:00" for the same reason a booking confirmation carries no time:
 *   the server knows the clinic's timezone and the client knows the viewer's, and only one of
 *   them should be formatting.
 * @property {string} [slotDate] The day those slots fall on, YYYY-MM-DD in clinic time.
 * @property {boolean} [degraded] True when the reply came from the offline rule-based
 *   provider rather than an LLM. The UI surfaces this rather than passing a keyword matcher
 *   off as a language model.
 */

/**
 * One fragment of an assistant turn, pushed while the model is still writing.
 *
 * This is the ONLY place model text reaches the client unmediated, and it is deliberately
 * inert: prose and nothing else. No doctor card, no appointment, no confirmation travels on
 * this event — those arrive only with the final `ChatReply`, built from real records. A
 * partial turn is therefore a draft the user can read early, never something they can act on.
 *
 * @typedef {object} ChatReplyDelta
 * @property {string} sessionId
 * @property {string} turnId Identifies the turn, so concurrent turns cannot interleave into
 *   one bubble.
 * @property {string} delta Text to append to what has arrived so far for this turn.
 */

/**
 * @typedef {object} ChatMessageView
 * @property {string} id
 * @property {'user' | 'assistant' | 'system'} role
 * @property {string} content
 * @property {string} createdAt
 * @property {ChatReply | null} [reply] Structured payload for assistant turns, replayed when
 *   a conversation is reloaded.
 */

/**
 * @typedef {object} ChatSessionView
 * @property {string} id
 * @property {string | null} title
 * @property {'active' | 'closed'} status
 * @property {number} messageCount
 * @property {string | null} lastMessageAt
 * @property {string} createdAt
 */

export {};
