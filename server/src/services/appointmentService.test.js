/**
 * Appointment integration tests, against a real database.
 *
 * The headline test is the concurrent double-booking race. It is the reason the schema uses
 * an exclusion constraint instead of an application-level availability check, and it is the
 * one guarantee that cannot be verified by reading the code.
 */

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { closeDatabase, futureIso, resetDatabase, seedTenant } from '../test/helpers.js';

const app = createApp();

let tenant;
let accessToken;
let otherAccessToken;

const authorise = (token) => ({ Authorization: `Bearer ${token}` });

const registerUser = async (email) => {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ fullName: 'Test User', email, password: 'correct horse battery' })
    .expect(201);
  return response.body.data.accessToken;
};

const book = (token, body) =>
  request(app).post('/api/appointments').set(authorise(token)).send(body);

const newSession = async (token) => {
  const response = await request(app)
    .post('/api/chat/sessions')
    .set(authorise(token))
    .send({})
    .expect(201);
  return response.body.data.session.id;
};

const transcript = async (token, sessionId) => {
  const response = await request(app)
    .get(`/api/chat/sessions/${sessionId}/messages`)
    .set(authorise(token))
    .expect(200);
  return response.body.data.messages;
};

beforeEach(async () => {
  await resetDatabase();
  tenant = await seedTenant();
  accessToken = await registerUser('ada@example.com');
  otherAccessToken = await registerUser('grace@example.com');
});

afterAll(async () => {
  await closeDatabase();
});

describe('booking', () => {
  it('creates a confirmed appointment', async () => {
    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
      notes: 'First visit',
    }).expect(201);

    expect(response.body.data.appointment.status).toBe('CONFIRMED');
    expect(response.body.data.appointment.providerName).toBe(tenant.providerName);
  });

  it('derives ends_at from the provider slot length', async () => {
    const startsAt = futureIso(24);
    const response = await book(accessToken, { providerId: tenant.providerId, startsAt }).expect(
      201,
    );

    const { startsAt: start, endsAt: end } = response.body.data.appointment;
    const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
    expect(minutes).toBe(30);
  });

  it('rejects a time in the past', async () => {
    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }).expect(400);

    expect(response.body.error.code).toBe('SLOT_IN_PAST');
  });

  it('rejects an inactive provider', async () => {
    await pool.query('UPDATE providers SET is_active = false WHERE id = $1', [tenant.providerId]);

    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(400);

    expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reports a provider from another tenant as not found', async () => {
    const other = await seedTenant('southgate-dental');

    const response = await book(accessToken, {
      providerId: other.providerId,
      startsAt: futureIso(24),
    }).expect(404);

    // Not 403: confirming the id exists would leak another tenant's data.
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication', async () => {
    await request(app)
      .post('/api/appointments')
      .send({ providerId: tenant.providerId, startsAt: futureIso(24) })
      .expect(401);
  });
});

describe('double-booking prevention', () => {
  it('rejects a second booking of the same slot', async () => {
    const startsAt = futureIso(48);

    await book(accessToken, { providerId: tenant.providerId, startsAt }).expect(201);
    const second = await book(otherAccessToken, { providerId: tenant.providerId, startsAt }).expect(
      409,
    );

    expect(second.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rejects a partially overlapping booking', async () => {
    const base = Date.now() + 48 * 60 * 60 * 1000;

    await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: new Date(base).toISOString(),
    }).expect(201);

    // 15 minutes into a 30-minute appointment. A UNIQUE(provider_id, starts_at) index
    // would let this through; the range exclusion constraint does not.
    const overlapping = await book(otherAccessToken, {
      providerId: tenant.providerId,
      startsAt: new Date(base + 15 * 60_000).toISOString(),
    }).expect(409);

    expect(overlapping.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('allows a back-to-back booking that merely touches', async () => {
    const base = Date.now() + 48 * 60 * 60 * 1000;

    await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: new Date(base).toISOString(),
    }).expect(201);

    // Starts exactly when the previous one ends. The '[)' range bound makes this legal.
    await book(otherAccessToken, {
      providerId: tenant.providerId,
      startsAt: new Date(base + 30 * 60_000).toISOString(),
    }).expect(201);
  });

  /**
   * The race. Ten simultaneous requests for one slot, all past validation at the same
   * moment. Exactly one may win.
   */
  it('lets exactly one of ten concurrent bookings win', async () => {
    const startsAt = futureIso(72);
    const tokens = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) => registerUser(`racer${index}@example.com`)),
    );

    const responses = await Promise.all(
      tokens.map((token) => book(token, { providerId: tenant.providerId, startsAt })),
    );

    const created = responses.filter((r) => r.status === 201);
    const conflicted = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(9);
    expect(conflicted.every((r) => r.body.error.code === 'SLOT_UNAVAILABLE')).toBe(true);

    // And the database agrees: one blocking row, not ten.
    const { rows } = await pool.query(
      `SELECT count(*)::text AS count FROM appointments
        WHERE provider_id = $1 AND status IN ('PENDING','CONFIRMED')`,
      [tenant.providerId],
    );
    expect(rows[0].count).toBe('1');
  });

  it('stops one user holding two overlapping appointments with different providers', async () => {
    const startsAt = futureIso(96);

    await book(accessToken, { providerId: tenant.providerId, startsAt }).expect(201);

    const clash = await book(accessToken, {
      providerId: tenant.otherProviderId,
      startsAt,
    }).expect(409);

    expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('frees the slot again once cancelled', async () => {
    const startsAt = futureIso(120);

    const first = await book(accessToken, { providerId: tenant.providerId, startsAt }).expect(201);

    await request(app)
      .patch(`/api/appointments/${first.body.data.appointment.id}/cancel`)
      .set(authorise(accessToken))
      .send({ reason: 'Changed my mind' })
      .expect(200);

    // Only PENDING and CONFIRMED participate in the constraint, so the time is bookable.
    await book(otherAccessToken, { providerId: tenant.providerId, startsAt }).expect(201);
  });
});

describe('ownership scoping', () => {
  it("does not let one user read another user's appointment", async () => {
    const mine = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    const response = await request(app)
      .get(`/api/appointments/${mine.body.data.appointment.id}`)
      .set(authorise(otherAccessToken))
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it("does not let one user cancel another user's appointment", async () => {
    const mine = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    await request(app)
      .patch(`/api/appointments/${mine.body.data.appointment.id}/cancel`)
      .set(authorise(otherAccessToken))
      .send({})
      .expect(404);

    // Still live, so the failed attempt genuinely changed nothing.
    const { rows } = await pool.query('SELECT status FROM appointments WHERE id = $1', [
      mine.body.data.appointment.id,
    ]);
    expect(rows[0].status).toBe('CONFIRMED');
  });

  it("only lists the caller's own appointments", async () => {
    await book(accessToken, { providerId: tenant.providerId, startsAt: futureIso(24) }).expect(201);
    await book(otherAccessToken, { providerId: tenant.providerId, startsAt: futureIso(48) }).expect(
      201,
    );

    const response = await request(app)
      .get('/api/appointments')
      .set(authorise(accessToken))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });
});

describe('cancellation rules', () => {
  it('refuses to cancel twice', async () => {
    const created = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    const url = `/api/appointments/${created.body.data.appointment.id}/cancel`;
    await request(app).patch(url).set(authorise(accessToken)).send({}).expect(200);

    const second = await request(app).patch(url).set(authorise(accessToken)).send({}).expect(400);
    expect(second.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('refuses to cancel a completed appointment', async () => {
    const created = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    await pool.query("UPDATE appointments SET status = 'COMPLETED' WHERE id = $1", [
      created.body.data.appointment.id,
    ]);

    const response = await request(app)
      .patch(`/api/appointments/${created.body.data.appointment.id}/cancel`)
      .set(authorise(accessToken))
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('rescheduling', () => {
  it('moves an appointment and leaves the old slot free', async () => {
    const originalStart = futureIso(24);
    const created = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: originalStart,
    }).expect(201);

    const moved = await request(app)
      .patch(`/api/appointments/${created.body.data.appointment.id}/reschedule`)
      .set(authorise(accessToken))
      .send({ startsAt: futureIso(30) })
      .expect(200);

    expect(moved.body.data.appointment.id).not.toBe(created.body.data.appointment.id);

    // Someone else can now take the time that was vacated.
    await book(otherAccessToken, { providerId: tenant.providerId, startsAt: originalStart }).expect(
      201,
    );
  });

  it('leaves the original intact when the new time is taken', async () => {
    const wanted = futureIso(30);
    await book(otherAccessToken, { providerId: tenant.providerId, startsAt: wanted }).expect(201);

    const mine = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    await request(app)
      .patch(`/api/appointments/${mine.body.data.appointment.id}/reschedule`)
      .set(authorise(accessToken))
      .send({ startsAt: wanted })
      .expect(409);

    // The transaction rolled back, so the original booking survived unchanged.
    const { rows } = await pool.query('SELECT status, starts_at FROM appointments WHERE id = $1', [
      mine.body.data.appointment.id,
    ]);
    expect(rows[0].status).toBe('CONFIRMED');
  });
});

describe('availability', () => {
  it('omits slots that are already taken', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const date = tomorrow.toISOString().slice(0, 10);

    const before = await request(app)
      .get(`/api/appointments/availability?providerId=${tenant.providerId}&date=${date}`)
      .set(authorise(accessToken))
      .expect(200);

    const takenSlot = before.body.data.slots[2];
    expect(takenSlot).toBeTruthy();

    await book(accessToken, { providerId: tenant.providerId, startsAt: takenSlot }).expect(201);

    const after = await request(app)
      .get(`/api/appointments/availability?providerId=${tenant.providerId}&date=${date}`)
      .set(authorise(accessToken))
      .expect(200);

    expect(after.body.data.slots).not.toContain(takenSlot);
    expect(after.body.data.slots).toHaveLength(before.body.data.slots.length - 1);
  });

  it('rejects a malformed date', async () => {
    const response = await request(app)
      .get(`/api/appointments/availability?providerId=${tenant.providerId}&date=12-08-2026`)
      .set(authorise(accessToken))
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  /**
   * The fixture clinic is open 00:00–24:00 in UTC, which is exactly the shape that used to
   * break: hour 24 is not a wall-clock hour any zone reports, so correcting a guess against
   * it walked the end of the day forward until the window spanned three days.
   */
  it('keeps every slot inside the day that was asked for', async () => {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await request(app)
      .get(`/api/appointments/availability?providerId=${tenant.providerId}&date=${date}`)
      .set(authorise(accessToken))
      .expect(200);

    const { slots } = response.body.data;
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      expect(slot.slice(0, 10)).toBe(date);
    }

    // Open round the clock at 30-minute slots: a full day is 48 of them, not 96 or 144.
    expect(slots).toHaveLength(48);
  });
});

/**
 * A booking finished in the in-chat form.
 *
 * The form is rendered inside a chat bubble and answers a question the assistant asked, so the
 * booking belongs to that conversation. It used to leave no trace in it at all — the thread
 * ended on the question, and a reload showed no sign the appointment had ever been made.
 *
 * The confirmation is built here from the row that was just written, exactly as the
 * conversational path builds it, so the model has authored none of it.
 */
describe('recording a form booking in its conversation', () => {
  it('adds a confirmation turn, and returns it with the appointment', async () => {
    const sessionId = await newSession(accessToken);

    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
      chatSessionId: sessionId,
    }).expect(201);

    // Returned inline: the form completes over REST and has no socket to deliver this on.
    const { chatMessage, appointment } = response.body.data;
    expect(chatMessage.role).toBe('assistant');
    expect(chatMessage.reply.kind).toBe('appointment_created');
    expect(chatMessage.reply.appointment.id).toBe(appointment.id);
    expect(chatMessage.reply.appointment.providerName).toBe(tenant.providerName);

    // Persisted, not just returned — this is what a reload replays.
    const messages = await transcript(accessToken, sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(chatMessage.id);
    expect(messages[0].reply.kind).toBe('appointment_created');

    /*
     * No date or time in the prose. The server knows the clinic's timezone and only the browser
     * knows the viewer's, so the instant travels on the payload and is formatted in exactly one
     * place. A time in both read as two different appointments.
     */
    expect(messages[0].content).toContain(tenant.providerName);
    expect(messages[0].content).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('records nothing for a booking made outside a conversation', async () => {
    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
    }).expect(201);

    // The standalone form on the appointments page has no conversation to write to.
    expect(response.body.data.chatMessage).toBeNull();
  });

  it('refuses another user’s conversation, and books nothing', async () => {
    const theirSession = await newSession(otherAccessToken);

    const response = await book(accessToken, {
      providerId: tenant.providerId,
      startsAt: futureIso(24),
      chatSessionId: theirSession,
    }).expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');

    // Checked before the insert, so the refusal costs nothing and leaves nothing behind: no
    // appointment for the caller, and no turn in a thread that is not theirs.
    const mine = await request(app)
      .get('/api/appointments')
      .set(authorise(accessToken))
      .expect(200);
    expect(mine.body.data).toHaveLength(0);

    expect(await transcript(otherAccessToken, theirSession)).toHaveLength(0);
  });
});
