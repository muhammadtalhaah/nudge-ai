/**
 * The chat reply contract, shared by the server and the client.
 *
 * Every field here is SERVER-DERIVED. The model produces only the extraction described in
 * `aiExtractionSchema` (an intent, some fields, and prose); the server then decides what
 * actually happened and builds this payload from real database records. The model never
 * authors a doctor card, a slot list, or a confirmation — so a hallucinated appointment
 * cannot be rendered as if it were real.
 */

import type { BookingField, ReplyKind } from './constants.ts';

export interface ChatProviderSummary {
  id: string;
  fullName: string;
  specialty: string;
  slotDurationMinutes: number;
}

export interface ChatAppointmentSummary {
  id: string;
  providerName: string;
  providerSpecialty: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

/**
 * Values to prefill the structured booking form with when the assistant could not complete
 * a booking on its own. This is the brief's "fallback to structured forms if user input is
 * incomplete or ambiguous" — the user finishes in a couple of clicks instead of retyping.
 */
export interface BookingFormPrefill {
  providerId?: string | null;
  specialty?: string | null;
  date?: string | null;
  time?: string | null;
  notes?: string | null;
}

export interface ChatReply {
  kind: ReplyKind;
  /** Prose shown to the user. */
  text: string;
  /** Present when kind is FORM_FALLBACK. */
  prefill?: BookingFormPrefill;
  /** Which booking details are still needed, so the UI can highlight them. */
  missing?: BookingField[];
  /** Candidate providers, when the assistant is helping narrow a choice. */
  providers?: ChatProviderSummary[];
  /** Set when kind is APPOINTMENT_CREATED. */
  appointment?: ChatAppointmentSummary;
  /** Set when kind is APPOINTMENT_LIST. */
  appointments?: ChatAppointmentSummary[];
  /**
   * True when the reply came from the offline rule-based provider rather than an LLM. The
   * UI surfaces this rather than passing a keyword matcher off as a language model.
   */
  degraded?: boolean;
}

/**
 * One fragment of an assistant turn, pushed while the model is still writing.
 *
 * This is the ONLY place model text reaches the client unmediated, and it is deliberately
 * inert: prose and nothing else. No doctor card, no appointment, no confirmation travels on
 * this event — those arrive only with the final `ChatReply`, built from real records. A
 * partial turn is therefore a draft the user can read early, never something they can act on.
 */
export interface ChatReplyDelta {
  sessionId: string;
  /** Identifies the turn, so concurrent turns cannot interleave into one bubble. */
  turnId: string;
  /** Text to append to what has arrived so far for this turn. */
  delta: string;
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  /** Structured payload for assistant turns, replayed when a conversation is reloaded. */
  reply?: ChatReply | null;
}

export interface ChatSessionView {
  id: string;
  title: string | null;
  status: 'active' | 'closed';
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}
