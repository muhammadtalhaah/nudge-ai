/**
 * Socket.IO integration tests, against a real listening server and real client sockets.
 *
 * The point of these is to prove the socket is genuinely just transport: the same rules that
 * hold over REST hold here, including handshake authentication, session ownership, and the
 * booking rules — because both paths call one service.
 */

import { createServer } from 'node:http';

import { io as createClient } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from '../../shared/constants.js';

import { createApp } from './app.js';
import { setProviderForTesting } from './ai/extraction.js';
import { createReplyStreamScanner } from './ai/replyStream.js';
import { pool } from './db/pool.js';
import { attachSocketServer } from './socket.js';
import { closeDatabase, resetDatabase, seedTenant } from './test/helpers.js';

const app = createApp();
let httpServer;
let port;
let ioServer;

let tenant;
let accessToken;
let otherAccessToken;
const openClients = [];

/** @returns {import('./ai/provider.js').AiProvider} */
const fakeProvider = (raw) => ({
  name: 'stub',
  isDeterministic: false,
  supportsStreaming: false,
  complete: async () => ({ raw, model: 'fake-model', promptTokens: 1, completionTokens: 1 }),
});

/**
 * A provider that generates, rather than one that returns.
 *
 * It feeds the response through the same scanner the Mistral path uses, in chunks that split
 * the document at arbitrary points — so these tests exercise the real decoding, not a
 * convenient stand-in that hands over whole words.
 *
 * @returns {import('./ai/provider.js').AiProvider}
 */
const streamingProvider = (raw, chunkSize = 7) => ({
  name: 'stub',
  isDeterministic: false,
  supportsStreaming: true,
  // Nothing here awaits, but the signature is the provider contract's, not this one's.
  complete: async (request) => {
    const scanner = createReplyStreamScanner();

    for (let index = 0; index < raw.length; index += chunkSize) {
      const prose = scanner.push(raw.slice(index, index + chunkSize));
      if (prose) request.onReplyDelta?.(prose);
    }

    return { raw, model: 'fake-model', promptTokens: 1, completionTokens: 1 };
  },
});

/** Collect every occurrence of an event until `settled` resolves. */
const collect = async (client, event, settled) => {
  const seen = [];
  const listener = (payload) => {
    seen.push(payload);
  };

  client.on(event, listener);
  await settled;
  client.off(event, listener);
  return seen;
};

const extraction = (overrides = {}) =>
  JSON.stringify({
    intent: 'greeting',
    fields: { specialty: null, providerName: null, date: null, time: null, notes: null },
    missing: [],
    reply: 'Hello.',
    ...overrides,
  });

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const registerUser = async (email) => {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ fullName: 'Test User', email, password: 'correct horse battery' })
    .expect(201);
  return response.body.data.accessToken;
};

const newSession = async (token) => {
  const response = await request(app)
    .post('/api/chat/sessions')
    .set({ Authorization: `Bearer ${token}` })
    .send({})
    .expect(201);
  return response.body.data.session.id;
};

/** Connect a client, resolving on connect and rejecting on a handshake refusal. */
const connect = (token) =>
  new Promise((resolve, reject) => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    openClients.push(client);

    client.on('connect', () => resolve(client));
    client.on('connect_error', (error) => reject(error));
  });

/** Wait for a named event, with a timeout that fails loudly rather than hanging. */
const waitFor = (client, event, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeoutMs,
    );
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

beforeAll(async () => {
  httpServer = createServer(app);
  ioServer = attachSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await seedTenant();
  accessToken = await registerUser('ada@example.com');
  otherAccessToken = await registerUser('grace@example.com');
});

afterEach(() => {
  setProviderForTesting(null);
  for (const client of openClients.splice(0)) client.close();
});

afterAll(async () => {
  await ioServer.close();
  await new Promise((resolve) => httpServer.close(() => resolve()));
  await closeDatabase();
});

describe('handshake authentication', () => {
  it('refuses a connection with no token', async () => {
    await expect(connect(undefined)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('refuses a connection with a tampered token', async () => {
    await expect(connect(`${accessToken.slice(0, -1)}X`)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('accepts a valid token', async () => {
    const client = await connect(accessToken);
    expect(client.connected).toBe(true);
  });

  it('refuses a token invalidated by logout-all', async () => {
    await request(app)
      .post('/api/auth/logout-all')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);

    // A long-lived socket must not outlive the credential that opened it.
    await expect(connect(accessToken)).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe('message round trip', () => {
  it('echoes the user message and then the assistant reply', async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const received = waitFor(client, SOCKET_EVENTS.MESSAGE_RECEIVED);
    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);

    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hello there' });

    expect((await received).message.content).toBe('hello there');
    expect((await replied).reply.text).toBe('Hello.');
  });

  it('emits a typing indicator before the reply', async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const typing = waitFor(client, SOCKET_EVENTS.ASSISTANT_TYPING);
    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });

    expect((await typing).typing).toBe(true);

    // The first typing event fires before the turn does any of its writing. Ending the test
    // here would leave those writes in flight, and the next TRUNCATE would block on their
    // locks until the hook timed out — a failure that lands on whichever test came next.
    await replied;
  });

  it('rejects an empty message with a validation error', async () => {
    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const failure = waitFor(client, SOCKET_EVENTS.ERROR);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: '   ' });

    expect((await failure).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a message with no sessionId', async () => {
    const client = await connect(accessToken);

    const failure = waitFor(client, SOCKET_EVENTS.ERROR);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { content: 'hello' });

    expect((await failure).code).toBe('VALIDATION_ERROR');
  });
});

describe('streaming the reply', () => {
  it('delivers the prose in fragments that add up to the final reply', async () => {
    setProviderForTesting(
      streamingProvider(extraction({ reply: 'Hello there — how can I help you today?' })),
    );

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);
    const deltas = collect(client, SOCKET_EVENTS.ASSISTANT_DELTA, replied);

    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });

    const fragments = await deltas;
    const final = await replied;

    // More than one fragment, or nothing was actually streamed.
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.map((fragment) => fragment.delta).join('')).toBe(
      'Hello there — how can I help you today?',
    );
    expect(final.reply.text).toBe('Hello there — how can I help you today?');

    // Every fragment belongs to the turn the final reply closes.
    for (const fragment of fragments) expect(fragment.turnId).toBe(final.turnId);
  });

  it('streams prose only — never the JSON around it', async () => {
    setProviderForTesting(
      streamingProvider(
        extraction({
          intent: 'book',
          fields: {
            specialty: 'General Practice',
            providerName: tenant.providerName,
            date: tomorrow(),
            time: '10:00',
            notes: null,
          },
          reply: "I'll get that booked for you.",
        }),
      ),
    );

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);
    const deltas = collect(client, SOCKET_EVENTS.ASSISTANT_DELTA, replied);

    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'book me in' });

    const streamed = (await deltas).map((fragment) => fragment.delta).join('');

    // The extraction's keys, the doctor's id, the intent — none of it is the user's business.
    expect(streamed).toBe("I'll get that booked for you.");
    expect(streamed).not.toContain('intent');
    expect(streamed).not.toContain('specialty');
    expect(streamed).not.toContain('{');
  });

  it('echoes the user message before any of the reply', async () => {
    setProviderForTesting(streamingProvider(extraction({ reply: 'Hello there.' })));

    const sessionId = await newSession(accessToken);
    const sender = await connect(accessToken);
    // A second tab has no optimistic copy, so ordering is load-bearing there: an answer must
    // never arrive before the message it answers.
    const observer = await connect(accessToken);

    const order = [];
    observer.on(SOCKET_EVENTS.MESSAGE_RECEIVED, () => order.push('user'));
    observer.on(SOCKET_EVENTS.ASSISTANT_DELTA, () => order.push('delta'));

    const replied = waitFor(observer, SOCKET_EVENTS.ASSISTANT_REPLY);
    sender.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });
    await replied;

    expect(order[0]).toBe('user');
    expect(order).toContain('delta');
  });

  it('sends no fragments at all for a provider that cannot stream', async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);
    const deltas = collect(client, SOCKET_EVENTS.ASSISTANT_DELTA, replied);

    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });

    expect(await deltas).toHaveLength(0);
    expect((await replied).reply.text).toBe('Hello.');
  });

  it('does not leak fragments to a different user', async () => {
    setProviderForTesting(streamingProvider(extraction({ reply: 'Something private.' })));

    const sessionId = await newSession(accessToken);
    const mine = await connect(accessToken);
    const theirs = await connect(otherAccessToken);

    let leaked = false;
    theirs.on(SOCKET_EVENTS.ASSISTANT_DELTA, () => {
      leaked = true;
    });

    const replied = waitFor(mine, SOCKET_EVENTS.ASSISTANT_REPLY);
    mine.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });
    await replied;

    expect(leaked).toBe(false);
  });
});

describe('the socket enforces the same rules as REST', () => {
  it("will not let a user post into someone else's conversation", async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const victimSession = await newSession(otherAccessToken);
    const client = await connect(accessToken);

    const failure = waitFor(client, SOCKET_EVENTS.ERROR);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId: victimSession, content: 'let me in' });

    // Same NOT_FOUND the REST route gives — the socket does not re-implement ownership.
    expect((await failure).code).toBe('NOT_FOUND');

    const { rows } = await pool.query(
      'SELECT count(*)::text AS count FROM chat_messages WHERE session_id = $1',
      [victimSession],
    );
    expect(rows[0].count).toBe('0');
  });

  it('books through the same service, honouring business rules', async () => {
    setProviderForTesting(
      fakeProvider(
        extraction({
          intent: 'book',
          fields: {
            specialty: 'General Practice',
            providerName: tenant.providerName,
            date: tomorrow(),
            time: '10:00',
            notes: null,
          },
          reply: 'Booking.',
        }),
      ),
    );

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const created = waitFor(client, SOCKET_EVENTS.APPOINTMENT_CREATED);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'book me in' });

    expect((await created).appointment.providerName).toBe(tenant.providerName);

    const { rows } = await pool.query('SELECT source FROM appointments');
    expect(rows[0].source).toBe('chat');
  });

  it('still refuses a double booking made over the socket', async () => {
    const startsAt = `${tomorrow()}T10:00:00.000Z`;

    await request(app)
      .post('/api/appointments')
      .set({ Authorization: `Bearer ${otherAccessToken}` })
      .send({ providerId: tenant.providerId, startsAt })
      .expect(201);

    setProviderForTesting(
      fakeProvider(
        extraction({
          intent: 'book',
          fields: {
            specialty: 'General Practice',
            providerName: tenant.providerName,
            date: tomorrow(),
            time: '10:00',
            notes: null,
          },
          reply: 'Booking.',
        }),
      ),
    );

    const sessionId = await newSession(accessToken);
    const client = await connect(accessToken);

    const replied = waitFor(client, SOCKET_EVENTS.ASSISTANT_REPLY);
    client.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'book 10am' });

    // Degrades to the form, exactly as over REST.
    expect((await replied).reply.kind).toBe('form_fallback');

    const { rows } = await pool.query(
      `SELECT count(*)::text AS count FROM appointments WHERE status = 'CONFIRMED'`,
    );
    expect(rows[0].count).toBe('1');
  });
});

describe('multi-tab delivery', () => {
  it('delivers a reply to every tab the same user has open', async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const sessionId = await newSession(accessToken);
    const tabOne = await connect(accessToken);
    const tabTwo = await connect(accessToken);

    const onTabTwo = waitFor(tabTwo, SOCKET_EVENTS.ASSISTANT_REPLY);
    tabOne.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });

    expect((await onTabTwo).reply.text).toBe('Hello.');
  });

  it('does not leak a reply to a different user', async () => {
    setProviderForTesting(fakeProvider(extraction()));

    const sessionId = await newSession(accessToken);
    const mine = await connect(accessToken);
    const theirs = await connect(otherAccessToken);

    let leaked = false;
    theirs.on(SOCKET_EVENTS.ASSISTANT_REPLY, () => {
      leaked = true;
    });

    const replied = waitFor(mine, SOCKET_EVENTS.ASSISTANT_REPLY);
    mine.emit(SOCKET_EVENTS.MESSAGE_SEND, { sessionId, content: 'hi' });
    await replied;

    // Rooms are keyed by user id, so another account's socket sees nothing.
    expect(leaked).toBe(false);
  });
});
