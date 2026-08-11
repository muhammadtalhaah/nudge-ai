/**
 * Naming a conversation.
 *
 * The same shape as `extraction.js` and for the same reason: model output is untrusted text,
 * so it is sanitised and bounded here and nothing downstream has to think about it. The
 * difference is the stakes. An extraction that fails costs someone their turn; a title that
 * fails costs a sidebar row its label, so this never throws, never retries, and never blocks —
 * every failure path simply returns null and the caller uses its fallback.
 *
 * What the model is allowed to decide is one short string that is only ever displayed. It
 * cannot reach a booking, and it is escaped by React on the way to the screen.
 */

import { aiLogger } from '../logger/index.js';
import { buildTitlePrompt } from './prompts.js';
import { getProvider } from './extraction.js';

/** Long enough for five words, short enough that the sidebar never has to truncate mid-word. */
const MAX_LENGTH = 48;

/**
 * Reduce whatever came back to something that can be a row in a list.
 *
 * Models like to answer a request for a title with `"Itchy Rash"` — quoted, occasionally
 * prefixed with "Title:", once in a while followed by an explanation on a second line. All of
 * that is recoverable, and recovering it is worth more than rejecting the turn over
 * punctuation.
 *
 * @returns {string | null} Null when nothing usable survived.
 */
const sanitise = (raw) => {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/^\s*(title|conversation)\s*[:\-—]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // A model that ignored the brief and wrote a sentence has not produced a title. Better to
  // fall back than to put half a paragraph in a 200px column.
  if (!cleaned || cleaned.length > MAX_LENGTH * 2) return null;

  return cleaned.slice(0, MAX_LENGTH);
};

/**
 * Name a conversation from its opening exchange.
 *
 * @param {string} userMessage
 * @param {string} assistantReply
 * @returns {Promise<string | null>} Null when the provider cannot summarise, the call failed,
 *   or the output was unusable — all of which the caller treats identically.
 */
export const generateTitle = async (userMessage, assistantReply) => {
  const provider = getProvider();

  // The deterministic provider has no `summarise`, which is the honest answer for a keyword
  // matcher. Offline conversations get the caller's fallback instead.
  if (typeof provider.summarise !== 'function') return null;

  try {
    const raw = await provider.summarise(buildTitlePrompt(userMessage, assistantReply));
    const title = sanitise(raw);

    if (!title) {
      aiLogger.warn({ provider: provider.name }, 'title completion was not usable');
      return null;
    }

    // The prompt's own escape hatch for a conversation too vague to name. Treated as no
    // answer rather than written in, so the fallback decides instead.
    return /^new conversation$/i.test(title) ? null : title;
  } catch (error) {
    aiLogger.warn({ err: error, provider: provider.name }, 'could not generate a title');
    return null;
  }
};

export default { generateTitle };
