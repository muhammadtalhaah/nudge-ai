/**
 * The AI provider boundary.
 *
 * Everything above this contract — the chat service, the booking rules — has no idea which
 * model is in use, or whether a model is in use at all. That is the seam the brief calls
 * "clear boundaries between AI calls and business logic": a provider's only job is to turn a
 * prompt into text. It cannot read the database, book anything, or decide anything.
 *
 * The shapes below are the whole interface. They are documented as JSDoc typedefs so the
 * contract stays readable and editor-checkable in plain JavaScript; what actually enforces
 * it is that every provider is exercised by the same tests through the same `complete` call.
 */

/**
 * @typedef {object} ProviderMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * Live catalogue and clock facts.
 *
 * For a real model these are already rendered into `systemPrompt`; they are passed
 * structurally as well so the deterministic provider can match against them without having
 * to parse English back out of the prompt it was given.
 *
 * @typedef {object} CompletionContext
 * @property {string[]} specialties
 * @property {Array<{ id: string, fullName: string, specialty: string }>} providers
 * @property {string} todayIsoDate Today's date in the business timezone, YYYY-MM-DD.
 * @property {string} timezone
 * @property {string | null} userFirstName
 *   What to call the person, or null when we have nothing usable to call them.
 *
 *   Their first name only, taken from the authenticated account and never from anything they
 *   typed into the chat — an assistant that can be told who it is talking to is one that can be
 *   told it is talking to somebody else. It goes no further than the prompt: no reply payload
 *   carries it, and the only place it is persisted is inside whatever prose the assistant
 *   wrote with it, which is the conversation the person is already reading.
 * @property {boolean} isFirstReply
 *   True when this session has no assistant turn yet, so the reply being written is the
 *   opening one.
 *
 *   The greeting is a once-per-conversation event and this is the fact that makes it one. A
 *   model cannot decide it for itself: history is trimmed to the last few turns, so the
 *   twentieth message of a long conversation arrives looking exactly like the first. Derived
 *   from what is stored rather than remembered in the process, so a reload, a second tab and a
 *   restart all reach the same answer.
 * @property {string | null} lastReplyKind
 *   What the previous assistant turn resolved to, or null at the start of a conversation.
 *
 *   A real model infers this from the prose it can see in the history ("Booked — Dr Okafor
 *   on Thursday"). The deterministic provider cannot read prose, so it is given the fact
 *   directly — without it, a completed booking's date and doctor linger in its context and
 *   the next unrecognised message re-attempts the same booking.
 * @property {import('../../../shared/chat.js').BookingFormPrefill & { providerName?: string | null }} draft
 *   The booking already under way in this conversation, or an empty object.
 *
 *   Session state, not model state: it is read from what the assistant last told the user,
 *   so it survives a provider outage, a malformed completion, and a page reload. The model is
 *   shown it so it stops asking for details it has, and the service merges it back over the
 *   model's own fields so a turn that forgets one cannot cost the user their answer.
 *
 *   Carries `providerName` for the prompt, since a doctor's id means nothing to a model, and
 *   `providerId` for the service, which resolves against real rows.
 */

/**
 * Called with each new fragment of the model's `reply` prose while it is being generated.
 *
 * Only the prose: the surrounding JSON never reaches this callback, and neither does any
 * field the server acts on. A provider that cannot stream simply never calls it, which is
 * why it is optional on both sides — the turn still completes, just without the early text.
 *
 * @typedef {(delta: string) => void} ReplyDeltaHandler
 */

/**
 * @typedef {object} CompletionRequest
 * @property {string} systemPrompt
 * @property {ProviderMessage[]} history Prior turns, oldest first.
 * @property {string} userMessage
 * @property {CompletionContext} context
 * @property {ReplyDeltaHandler} [onReplyDelta] Opt in to incremental prose. Ignored by
 *   providers with `supportsStreaming: false`.
 */

/**
 * @typedef {object} CompletionResult
 * @property {string} raw Raw text from the model. Parsed and validated by the caller, never
 *   trusted here.
 * @property {string} model
 * @property {number | null} promptTokens
 * @property {number | null} completionTokens
 */

/**
 * @typedef {object} AiProvider
 * @property {'mistral' | 'stub'} name
 * @property {boolean} isDeterministic True when this provider is not a real language model,
 *   so the UI can say so.
 * @property {boolean} supportsStreaming
 *   True when `complete` honours `onReplyDelta`.
 *
 *   Declared rather than assumed: a provider that computes its answer in one step has no
 *   incremental output to give, and chopping a finished string into fake "tokens" would be
 *   an animation dressed up as generation. It stays false and the UI shows the wait honestly.
 * @property {(request: CompletionRequest) => Promise<CompletionResult>} complete
 * @property {(prompt: string) => Promise<string>} [summarise]
 *   Optional: one short freeform completion, used to name a conversation.
 *
 *   Optional because it is the one thing in this contract a non-model provider genuinely
 *   cannot fake. The deterministic provider matches keywords; it has no way to summarise, and
 *   a rule that pretended to would just be the truncation this replaced. Callers fall back
 *   when it is absent, so the offline mode keeps working without claiming an ability it lacks.
 */

/** Raised for any provider-side failure: network, timeout, bad status, empty body. */
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ isTimeout?: boolean, cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.isTimeout = options?.isTimeout ?? false;
  }
}
