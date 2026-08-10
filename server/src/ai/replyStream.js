/**
 * Reading prose out of a JSON object that is still being written.
 *
 * The model does not emit prose — it emits a JSON object, and the prose is one string field
 * inside it. So streaming the assistant's reply is not "forward the tokens": it is decoding
 * one string value out of a document whose closing brace has not arrived yet, without ever
 * running a JSON parser over something incomplete.
 *
 * That is what this scanner does. Feed it chunks in order; it returns the newly readable
 * characters of the `reply` value each time, and nothing else. Everything before that key
 * (intent, fields, missing) is structure the user must never see, and is silently skipped —
 * which is also why the system prompt puts `reply` last: by the time prose starts arriving,
 * the extraction that governs it is already complete.
 *
 * It is a reader, never an authority. The complete response is still parsed and validated
 * normally, and the reply the user ends up with is the one the server decides on. What
 * streams here is a draft.
 */

/** Single-character JSON escapes. `\uXXXX` is handled separately. */
const SHORT_ESCAPES = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Where the scanner is in the document. Exactly one of:
 *
 *   'seeking'      walking the document looking for the target key at the top level
 *   'after-string' just closed a string; waiting to see whether a `:` makes it a key
 *   'expect-value' the key matched; waiting for the opening quote of its value
 *   'capturing'    inside the value, decoding it
 *   'done'         the value ended, or turned out not to be a string; nothing more is emitted
 *
 * @typedef {'seeking' | 'after-string' | 'expect-value' | 'capturing' | 'done'} Phase
 */

/**
 * @typedef {object} ReplyStreamScanner
 * @property {(chunk: string) => string} push Feed the next chunk; returns whatever became
 *   readable, or '' if nothing did.
 * @property {() => boolean} isDone True once the value has been fully read (or established
 *   to be unreadable).
 */

/**
 * @param {string} [key] the object key whose string value should be streamed out
 * @returns {ReplyStreamScanner}
 */
export const createReplyStreamScanner = (key = 'reply') => {
  /**
   * Chunks accumulate because a token can be split anywhere — mid-escape, mid-key, even
   * mid-`\uXXXX`. The cursor only advances past characters that have been fully decided, so
   * a split sequence is simply re-read once its remainder arrives.
   */
  let buffer = '';
  let cursor = 0;
  /** @type {Phase} */
  let phase = 'seeking';

  /** Nesting depth, so `reply` nested inside another object is not mistaken for the real one. */
  let depth = 0;
  /** The most recently closed string, a candidate key until a `:` confirms it. */
  let lastString = '';

  /**
   * Walk structure until the target key's value begins. Returns true once it has.
   *
   * String contents are skipped rather than decoded here — a value containing the word
   * "reply" must not be mistaken for the key itself, which is the whole reason this is a
   * scanner and not a regular expression.
   */
  const seek = () => {
    while (cursor < buffer.length) {
      const char = buffer[cursor];

      if (phase === 'after-string') {
        if (/\s/.test(char)) {
          cursor += 1;
          continue;
        }
        // A string followed by ':' was a key. Anything else was a value; keep looking.
        if (char === ':' && lastString === key && depth === 1) {
          cursor += 1;
          phase = 'expect-value';
          continue;
        }
        phase = 'seeking';
        continue;
      }

      if (phase === 'expect-value') {
        if (/\s/.test(char)) {
          cursor += 1;
          continue;
        }
        if (char === '"') {
          cursor += 1;
          phase = 'capturing';
          return true;
        }
        // `"reply": null` — valid JSON, no prose to stream. Validation will reject it later.
        phase = 'done';
        return false;
      }

      if (char === '"') {
        // Ran out mid-string: leave the cursor on the opening quote so the next chunk
        // re-enters here rather than resuming inside the string and reading its contents
        // as structure.
        if (!skipString()) return false;
        phase = 'after-string';
        continue;
      }

      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') depth -= 1;

      cursor += 1;
    }

    return false;
  };

  /**
   * Skip the string whose opening quote is at the cursor, recording its contents raw.
   *
   * Returns false if the closing quote has not arrived yet, leaving the cursor exactly where
   * it was so the whole string is re-scanned once the rest turns up. Re-scanning is cheap and
   * the alternative — remembering a position inside a string — is the state that goes wrong.
   */
  const skipString = () => {
    const quoteAt = cursor;
    let index = quoteAt + 1;

    while (index < buffer.length) {
      const char = buffer[index];

      if (char === '\\') {
        // A trailing backslash means the escape is split across chunks.
        if (index + 1 >= buffer.length) return false;
        index += 2;
        continue;
      }

      if (char === '"') {
        lastString = buffer.slice(quoteAt + 1, index);
        cursor = index + 1;
        return true;
      }

      index += 1;
    }

    return false;
  };

  /** Decode as much of the value as is unambiguously complete. */
  const capture = () => {
    let out = '';

    while (cursor < buffer.length) {
      const char = buffer[cursor];

      if (char === '"') {
        cursor += 1;
        phase = 'done';
        break;
      }

      if (char === '\\') {
        // Hold: the escape's meaning depends on characters that have not arrived.
        if (cursor + 1 >= buffer.length) break;

        const next = buffer[cursor + 1];

        if (next === 'u') {
          if (cursor + 6 > buffer.length) break;
          const hex = buffer.slice(cursor + 2, cursor + 6);
          const code = Number.parseInt(hex, 16);
          // Surrogate pairs arrive as two escapes and concatenate correctly as-is.
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          cursor += 6;
          continue;
        }

        out += SHORT_ESCAPES[next] ?? next;
        cursor += 2;
        continue;
      }

      out += char;
      cursor += 1;
    }

    return out;
  };

  return {
    push(chunk) {
      if (phase === 'done' || !chunk) return '';

      buffer += chunk;

      // Already inside the value, or seek got us there this time round.
      if (phase !== 'capturing' && !seek()) return '';

      return capture();
    },

    isDone: () => phase === 'done',
  };
};
