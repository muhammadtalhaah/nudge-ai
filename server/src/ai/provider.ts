/**
 * The AI provider boundary.
 *
 * Everything above this interface — the chat service, the booking rules — has no idea which
 * model is in use, or whether a model is in use at all. That is the seam the brief calls
 * "clear boundaries between AI calls and business logic": a provider's only job is to turn a
 * prompt into text. It cannot read the database, book anything, or decide anything.
 */

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Live catalogue and clock facts.
 *
 * For a real model these are already rendered into `systemPrompt`; they are passed
 * structurally as well so the deterministic provider can match against them without having
 * to parse English back out of the prompt it was given.
 */
export interface CompletionContext {
  specialties: string[];
  providers: Array<{ id: string; fullName: string; specialty: string }>;
  /** Today's date in the business timezone, YYYY-MM-DD. */
  todayIsoDate: string;
  timezone: string;
  /**
   * What the previous assistant turn resolved to, or null at the start of a conversation.
   *
   * A real model infers this from the prose it can see in the history ("Booked — Dr Okafor
   * on Thursday"). The deterministic provider cannot read prose, so it is given the fact
   * directly — without it, a completed booking's date and doctor linger in its context and
   * the next unrecognised message re-attempts the same booking.
   */
  lastReplyKind: string | null;
}

/**
 * Called with each new fragment of the model's `reply` prose while it is being generated.
 *
 * Only the prose: the surrounding JSON never reaches this callback, and neither does any
 * field the server acts on. A provider that cannot stream simply never calls it, which is
 * why it is optional on both sides — the turn still completes, just without the early text.
 */
export type ReplyDeltaHandler = (delta: string) => void;

export interface CompletionRequest {
  systemPrompt: string;
  /** Prior turns, oldest first. */
  history: ProviderMessage[];
  userMessage: string;
  context: CompletionContext;
  /** Opt in to incremental prose. Ignored by providers with `supportsStreaming: false`. */
  onReplyDelta?: ReplyDeltaHandler;
}

export interface CompletionResult {
  /** Raw text from the model. Parsed and validated by the caller, never trusted here. */
  raw: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AiProvider {
  readonly name: 'mistral' | 'stub';
  /** True when this provider is not a real language model, so the UI can say so. */
  readonly isDeterministic: boolean;
  /**
   * True when `complete` honours `onReplyDelta`.
   *
   * Declared rather than assumed: a provider that computes its answer in one step has no
   * incremental output to give, and chopping a finished string into fake "tokens" would be
   * an animation dressed up as generation. It stays false and the UI shows the wait honestly.
   */
  readonly supportsStreaming: boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** Raised for any provider-side failure: network, timeout, bad status, empty body. */
export class ProviderError extends Error {
  readonly isTimeout: boolean;

  constructor(message: string, options?: { isTimeout?: boolean; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.isTimeout = options?.isTimeout ?? false;
  }
}
