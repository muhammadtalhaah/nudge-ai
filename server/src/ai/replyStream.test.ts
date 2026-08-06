/**
 * The scanner's job is to be correct about half a document.
 *
 * These tests therefore care far more about *where* the input is split than about what it
 * says: a network read can land between a backslash and the character it escapes, or between
 * the two halves of a surrogate pair, and getting that wrong shows up as mangled text in
 * front of a user rather than as an exception.
 */

import { describe, expect, it } from 'vitest';

import { createReplyStreamScanner } from './replyStream.ts';

/** Feed a document one character at a time — the most hostile split there is. */
const streamByCharacter = (json: string): string => {
  const scanner = createReplyStreamScanner();
  let out = '';
  for (const char of json) out += scanner.push(char);
  return out;
};

/** Feed it in fixed-size slices, to catch splits the per-character case cannot produce. */
const streamInChunks = (json: string, size: number): string => {
  const scanner = createReplyStreamScanner();
  let out = '';
  for (let index = 0; index < json.length; index += size) {
    out += scanner.push(json.slice(index, index + size));
  }
  return out;
};

const EXTRACTION = JSON.stringify({
  intent: 'book',
  fields: { specialty: 'Dermatology', providerName: null, date: null, time: null, notes: null },
  missing: ['date', 'time'],
  reply: 'I can arrange that — which day suits you?',
});

describe('reading the reply out of a partial document', () => {
  it('yields the whole value when the document arrives in one piece', () => {
    const scanner = createReplyStreamScanner();
    expect(scanner.push(EXTRACTION)).toBe('I can arrange that — which day suits you?');
    expect(scanner.isDone()).toBe(true);
  });

  it('yields the same value character by character', () => {
    expect(streamByCharacter(EXTRACTION)).toBe('I can arrange that — which day suits you?');
  });

  it.each([2, 3, 5, 7, 16, 64])('yields the same value in chunks of %i', (size) => {
    expect(streamInChunks(EXTRACTION, size)).toBe('I can arrange that — which day suits you?');
  });

  it('emits progressively rather than all at the end', () => {
    const scanner = createReplyStreamScanner();
    const emissions = [
      scanner.push('{"intent":"greeting","missing":[],"reply":"Hello'),
      scanner.push(' there'),
      scanner.push('."}'),
    ];

    // The point of the exercise: text was readable before the document was.
    expect(emissions[0]).toBe('Hello');
    expect(emissions.join('')).toBe('Hello there.');
  });

  it('emits nothing until the reply key is reached', () => {
    const scanner = createReplyStreamScanner();
    expect(scanner.push('{"intent":"book","fields":{"specialty":"Cardiology"},')).toBe('');
    expect(scanner.push('"missing":[],"reply":"On it."}')).toBe('On it.');
  });
});

describe('values that could be mistaken for the key', () => {
  it('ignores the word "reply" inside an earlier string value', () => {
    const json = JSON.stringify({
      intent: 'other',
      fields: { notes: 'please reply: soon' },
      reply: 'Understood.',
    });

    expect(streamByCharacter(json)).toBe('Understood.');
  });

  it('ignores a nested key of the same name', () => {
    const json = '{"fields":{"reply":"nested"},"reply":"top level"}';
    expect(streamByCharacter(json)).toBe('top level');
  });

  it('stops at the end of the value and ignores trailing keys', () => {
    const json = '{"reply":"Done.","intent":"other"}';
    const scanner = createReplyStreamScanner();

    expect(scanner.push(json)).toBe('Done.');
    expect(scanner.isDone()).toBe(true);
    expect(scanner.push('{"reply":"again"}')).toBe('');
  });
});

describe('escapes', () => {
  const cases: Array<[string, string]> = [
    ['a quoted phrase', 'She said "next Tuesday" to me.'],
    ['a backslash', 'Path\\to\\nowhere'],
    ['a newline', 'Line one\nLine two'],
    ['a tab', 'Before\tafter'],
    ['a forward slash', 'and/or'],
    ['an emoji beyond the basic plane', 'Booked 🎉 for you'],
    ['an accented character', 'Dr Ångström is free'],
  ];

  it.each(cases)('decodes %s', (_label, value) => {
    const json = JSON.stringify({ reply: value });

    expect(createReplyStreamScanner().push(json)).toBe(value);
    // The same value must survive a split at every single position.
    expect(streamByCharacter(json)).toBe(value);
    expect(streamInChunks(json, 3)).toBe(value);
  });

  it('holds back a \\uXXXX escape split across chunks rather than mangling it', () => {
    const scanner = createReplyStreamScanner();

    // 'é' is 'é'; arriving two characters at a time it is only decodable at the end.
    expect(scanner.push('{"reply":"caf\\u00')).toBe('caf');
    expect(scanner.push('e9 open"}')).toBe('é open');
  });

  it('holds back a lone trailing backslash rather than emitting it', () => {
    const scanner = createReplyStreamScanner();

    expect(scanner.push('{"reply":"quote: \\')).toBe('quote: ');
    expect(scanner.push('"here\\" done"}')).toBe('"here" done');
  });
});

describe('input that never becomes a readable reply', () => {
  it('emits nothing for a null reply', () => {
    const scanner = createReplyStreamScanner();
    expect(scanner.push('{"intent":"other","reply":null}')).toBe('');
    expect(scanner.isDone()).toBe(true);
  });

  it('emits nothing when the key never appears', () => {
    expect(streamByCharacter('{"intent":"other","text":"wrong shape"}')).toBe('');
  });

  it('emits what it had when the document is cut off mid-reply', () => {
    const scanner = createReplyStreamScanner();

    // A truncated response still fails validation downstream and degrades to the form; the
    // point here is only that the scanner does not throw on it.
    expect(scanner.push('{"intent":"other","reply":"I was about to say')).toBe(
      'I was about to say',
    );
    expect(scanner.isDone()).toBe(false);
  });

  it('reads a reply that survived a leading markdown fence', () => {
    // JSON mode should prevent this, but the non-streaming path tolerates it and so does this.
    expect(streamByCharacter('```json\n{"reply":"Fenced but fine."}\n```')).toBe(
      'Fenced but fine.',
    );
  });
});
