/**
 * Deterministic offline provider.
 *
 * Selected automatically when no MISTRAL_API_KEY is configured, so the application is fully
 * demoable and testable with no credentials, no network, and no cost.
 *
 * It is a keyword-and-regex intent matcher, not a language model, and it does not pretend
 * otherwise: `isDeterministic` is true, which the UI surfaces as a visible "offline
 * assistant" notice. The point is that it emits the *same JSON contract* as the real model
 * and flows through the identical validation and booking path — so every downstream rule is
 * exercised by the test suite without a live API.
 */

import { CHAT_INTENTS, REPLY_KIND } from '../../../../shared/constants.js';

import { resolveDate, resolveTime } from '../naturalDate.js';

const BOOK_HINTS = /\b(book|appointment|schedule|see|visit|slot|reserve|available|availability)\b/;
const CANCEL_HINTS = /\b(cancel|call off|drop)\b/;
const RESCHEDULE_HINTS = /\b(reschedul|move|change|postpone|shift)\w*\b/;
const LIST_HINTS =
  /\b(my appointments|my bookings|upcoming|coming up|what do i have|what have i got|show me|list)\b/;
const GREETING_HINTS = /^\s*(hi|hey|hello|good (morning|afternoon|evening)|thanks|thank you)\b/;

/** Common lay terms mapped to the specialties a clinic actually lists. */
const SYMPTOM_TO_SPECIALTY = [
  [/\b(skin|rash|acne|mole|eczema|derma)\w*\b/, 'Dermatology'],
  [/\b(heart|chest pain|cardio|blood pressure|palpitation)\w*\b/, 'Cardiology'],
  [/\b(child|kid|baby|infant|paediatric|pediatric)\w*\b/, 'Paediatrics'],
  [/\b(physio|back pain|knee|shoulder|muscle|injury|rehab)\w*\b/, 'Physiotherapy'],
  [/\b(tooth|teeth|dental|dentist)\w*\b/, 'Dentistry'],
  [
    /\b(check.?up|general|gp|doctor|unwell|sick|flu|cold|head ?ache|migraine|fever|cough|sore throat|nause\w*|dizzy|exhausted|fatigue)\b/,
    'General Practice',
  ],
];

/**
 * Classify the turn.
 *
 * `hasBookingSignal` is true when a specialty, doctor, date or time was recognised anywhere in
 * the recent conversation. It matters because people rarely use a booking verb: "tomorrow at
 * 2pm" is plainly about booking, and keyword matching alone reads it as gibberish. Deciding
 * intent after field extraction rather than before is what makes the offline assistant usable
 * instead of merely present.
 *
 * `isSymptomTurn` is the narrower fact and it is about *this* message only: somebody described
 * how they feel and asked for nothing. That used to be folded into a booking, which is how a
 * headache got answered with a booking form.
 *
 * @param {string} text
 * @param {{ hasBookingSignal: boolean, isSymptomTurn: boolean }} signals
 */
const detectIntent = (text, signals) => {
  const lower = text.toLowerCase();

  // Cancel and reschedule are tested before book: "reschedule my appointment" contains
  // "appointment" and would otherwise read as a fresh booking.
  if (CANCEL_HINTS.test(lower)) return CHAT_INTENTS.CANCEL;
  if (RESCHEDULE_HINTS.test(lower)) return CHAT_INTENTS.BOOK;
  if (LIST_HINTS.test(lower)) return CHAT_INTENTS.LIST;
  if (BOOK_HINTS.test(lower)) return CHAT_INTENTS.BOOK;

  // Ahead of the greeting test, so "hi, my back is killing me" is about the back rather than
  // the hi. `isSymptomTurn` has already established that no appointment was asked for.
  if (signals.isSymptomTurn) return CHAT_INTENTS.SYMPTOM;

  // A bare greeting is only a greeting when nothing else was understood — "hi, I need a
  // dermatologist tomorrow" is a booking.
  if (GREETING_HINTS.test(lower) && !signals.hasBookingSignal) return CHAT_INTENTS.GREETING;

  // Includes the "yes please" that accepts an offer to find someone: the specialty is still
  // carried from the turn that offered, so this reads as a booking signal and books.
  if (signals.hasBookingSignal) return CHAT_INTENTS.BOOK;
  return CHAT_INTENTS.OTHER;
};

/** An exact specialty from the live catalogue — the person named the service itself. */
const detectSpecialtyName = (text, context) => {
  const lower = text.toLowerCase();

  for (const specialty of context.specialties) {
    if (lower.includes(specialty.toLowerCase())) return specialty;
  }

  return null;
};

/**
 * A lay description of how someone feels, mapped onto a specialty this clinic offers.
 *
 * Kept apart from `detectSpecialtyName` because the two mean different things about the turn,
 * not just about the field: naming Dermatology is asking for a service, and saying your skin
 * itches is telling somebody how you are. Only the second one starts a conversation.
 */
const detectSymptomSpecialty = (text, context) => {
  const lower = text.toLowerCase();

  for (const [pattern, specialty] of SYMPTOM_TO_SPECIALTY) {
    if (pattern.test(lower)) {
      // Only offer it if this clinic actually has that specialty.
      const available = context.specialties.find(
        (s) => s.toLowerCase() === specialty.toLowerCase(),
      );
      if (available) return available;
    }
  }

  return null;
};

/** An exact name beats any guess, so the catalogue is consulted first. */
const detectSpecialty = (text, context) =>
  detectSpecialtyName(text, context) ?? detectSymptomSpecialty(text, context);

const detectProviderName = (text, context) => {
  const lower = text.toLowerCase();

  for (const provider of context.providers) {
    if (lower.includes(provider.fullName.toLowerCase())) return provider.fullName;

    // Surname only — "Dr. Okafor", "okafor".
    const surname = provider.fullName.split(/\s+/).pop();
    if (surname && surname.length > 3 && new RegExp(`\\b${surname.toLowerCase()}\\b`).test(lower)) {
      return provider.fullName;
    }
  }

  return null;
};

/**
 * Build the reply prose. Kept plain and specific — a rule-based matcher writing flowery
 * copy would read worse than one that simply says what it needs.
 *
 * @param {string} intent
 * @param {string[]} missing
 * @param {import('../provider.js').CompletionContext} context
 */
const composeReply = (intent, missing, context) => {
  if (intent === CHAT_INTENTS.GREETING) {
    // Once, on the opening turn, and only when we have a name — the same rule the real model
    // is given in prose, applied here as a condition because a regex cannot be persuaded.
    const name = context.isFirstReply && context.userFirstName ? ` ${context.userFirstName}` : '';
    return `Hello${name}. I can book, list or cancel an appointment for you. What do you need?`;
  }

  /*
   * The honest version of the conversation the real assistant holds.
   *
   * A keyword matcher cannot ask a useful follow-up question, and inventing one would be the
   * same pretence `isDeterministic` exists to avoid. What it can do is stop answering "my head
   * hurts" with a booking form: acknowledge, say plainly that it is not the one to advise, and
   * offer. The person's "yes" then carries the specialty this turn recognised into the ordinary
   * booking path.
   */
  if (intent === CHAT_INTENTS.SYMPTOM) {
    return (
      'I am sorry to hear that. I am not able to advise on it myself, but I can get you in ' +
      'front of someone who can — would you like me to find you a doctor?'
    );
  }

  if (intent === CHAT_INTENTS.LIST) {
    return 'Here are your upcoming appointments.';
  }

  if (intent === CHAT_INTENTS.CANCEL) {
    return 'Which appointment would you like to cancel?';
  }

  if (intent === CHAT_INTENTS.BOOK) {
    if (missing.length === 0) return 'Booking that for you now.';

    const labels = {
      specialty: 'what the appointment is for',
      providerName: 'which doctor you would like',
      date: 'which day',
      time: 'what time',
    };
    const wanted = missing.map((field) => labels[field]).join(', and ');
    return `I can arrange that — I just need ${wanted}. You can also fill in the form below.`;
  }

  return 'I can help with booking, listing or cancelling appointments. Could you rephrase what you need?';
};

/** @returns {import('../provider.js').AiProvider} */
export const createStubProvider = () => ({
  name: 'stub',
  isDeterministic: true,

  /**
   * It has nothing to stream. The reply is computed in one pass from regexes, so there is no
   * point at which half of it exists — emitting it in timed slices would be a typewriter
   * animation pretending to be generation, which is exactly the pretence `isDeterministic`
   * exists to avoid. Offline, the UI shows the working indicator and then the reply.
   */
  supportsStreaming: false,

  // Nothing here awaits, but the signature is the provider contract's, not this one's.
  async complete(request) {
    const { userMessage, context } = request;

    // Consider the recent conversation, not just this message, so details mentioned a turn
    // or two ago are not forgotten. This is the crude equivalent of the model's context
    // window, and it is why "tomorrow at 10" works after "I need a dermatologist".
    //
    // The exception is a conversation that just produced a booking: carrying those details
    // forward would make the next vague message re-book the same slot.
    const carryContext = context.lastReplyKind !== REPLY_KIND.APPOINTMENT_CREATED;

    const priorTurns = carryContext
      ? request.history
          .filter((message) => message.role === 'user')
          .slice(-3)
          .map((message) => message.content)
          .join('\n')
      : '';

    const today = new Date(`${context.todayIsoDate}T00:00:00Z`);

    /**
     * The current message wins; history only fills gaps.
     *
     * Order matters here and is easy to get wrong: scanning the whole conversation as one
     * string returns the *first* match, so "tomorrow at 2pm" from three turns ago would
     * override the "3pm" the user just typed. Resolving the newest statement first is what
     * makes correcting yourself mid-conversation work.
     */
    const newestFirst = (fromCurrent, fromHistory) =>
      fromCurrent ?? (carryContext ? fromHistory : null);

    /*
     * What this message on its own contains, held separately from what the conversation
     * already knows.
     *
     * The merged values below are what a booking is built from, but they are the wrong basis
     * for deciding whether this turn is somebody describing a symptom: a specialty recognised
     * two turns ago would make every following message look like a fresh complaint. The
     * symptom rule is about what was just said, so it reads these.
     */
    const saidSpecialty = detectSpecialtyName(userMessage, context);
    const saidSymptom = detectSymptomSpecialty(userMessage, context);
    const saidProvider = detectProviderName(userMessage, context);
    const saidDate = resolveDate(userMessage, today);
    const saidTime = resolveTime(userMessage);

    const specialty = newestFirst(
      saidSpecialty ?? saidSymptom,
      priorTurns ? detectSpecialty(priorTurns, context) : null,
    );
    const providerName = newestFirst(
      saidProvider,
      priorTurns ? detectProviderName(priorTurns, context) : null,
    );
    const date = newestFirst(saidDate, priorTurns ? resolveDate(priorTurns, today) : null);
    const time = newestFirst(saidTime, priorTurns ? resolveTime(priorTurns) : null);

    // Fields first, then intent — a recognised symptom or a date is itself the signal that
    // this turn is about booking.
    const hasBookingSignal = Boolean(specialty ?? providerName ?? date ?? time);

    /**
     * They said how they feel and asked for nothing.
     *
     * Every clause is a way the turn could be a request instead: naming the service, using a
     * booking verb, naming a doctor, naming a day or a time. With none of them present there is
     * nothing to book yet, and treating it as a booking is what put a form in front of someone
     * who had said their head hurt.
     */
    const isSymptomTurn =
      Boolean(saidSymptom) &&
      !saidSpecialty &&
      !saidProvider &&
      !saidDate &&
      !saidTime &&
      !BOOK_HINTS.test(userMessage.toLowerCase());

    const intent = detectIntent(userMessage, { hasBookingSignal, isSymptomTurn });

    // Only a booking needs a full set of details.
    const missing = [];
    if (intent === CHAT_INTENTS.BOOK) {
      if (!specialty && !providerName) missing.push('specialty');
      if (!providerName) missing.push('providerName');
      if (!date) missing.push('date');
      if (!time) missing.push('time');
    }

    /*
     * A symptom turn reports nothing, which is the same rule the real model is given.
     *
     * Sending the specialty anyway would be harmless today — the service ignores the fields of
     * a `symptom` turn — but it would be a claim the turn does not support, and the next reader
     * of either side would have to work out which one meant it. The specialty is not lost by
     * withholding it: what carries a conversation forward here is the person's own words in
     * `history`, which are re-read on the turn that actually books.
     */
    const isConversation = intent === CHAT_INTENTS.SYMPTOM;

    const extraction = {
      intent,
      fields: isConversation
        ? { specialty: null, providerName: null, date: null, time: null, notes: null }
        : { specialty, providerName, date, time, notes: null },
      missing,
      reply: composeReply(intent, missing, context),
    };

    // Returned as a JSON string, exactly as a model would, so the caller's parse-and-validate
    // path is identical for both providers. No special-casing downstream.
    return {
      raw: JSON.stringify(extraction),
      model: 'rule-based-stub',
      promptTokens: null,
      completionTokens: null,
    };
  },
});
