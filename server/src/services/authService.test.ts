/**
 * Auth integration tests, against a real database.
 *
 * Focus is on the properties that are easy to get subtly wrong and expensive to get wrong:
 * privilege escalation via signup, account enumeration, and refresh-token rotation.
 */

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import {
  closeDatabase,
  cookieHeader,
  refreshCookieFrom,
  resetDatabase,
  seedTenant,
} from '../test/helpers.ts';

const app = createApp();

const CREDENTIALS = { email: 'ada@example.com', password: 'correct horse battery' };

const signup = () =>
  request(app)
    .post('/api/auth/signup')
    .send({ fullName: 'Ada Lovelace', ...CREDENTIALS });

const login = () => request(app).post('/api/auth/login').send(CREDENTIALS);

beforeEach(async () => {
  await resetDatabase();
  await seedTenant();
});

afterAll(async () => {
  await closeDatabase();
});

describe('signup', () => {
  it('creates an account and returns an access token plus a refresh cookie', async () => {
    const response = await signup().expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('ada@example.com');
    expect(response.body.data.accessToken).toBeTypeOf('string');
    expect(refreshCookieFrom(response.headers)).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const response = await signup().expect(201);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('sets the refresh cookie httpOnly and scoped to the auth path', async () => {
    const response = await signup().expect(201);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.join(';');

    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('ignores a client-supplied role — self-signup cannot escalate to admin', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'Sneaky', ...CREDENTIALS, role: 'admin' })
      .expect(201);

    expect(response.body.data.user.role).toBe('customer');
  });

  it('rejects a duplicate email with 409', async () => {
    await signup().expect(201);
    const response = await signup().expect(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns field-level details for an invalid payload', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'A', email: 'not-an-email', password: 'short' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['fullName', 'email', 'password']));
  });

  it('normalises the email to lower case', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ fullName: 'Ada', email: '  ADA@Example.COM ', password: CREDENTIALS.password })
      .expect(201);

    expect(response.body.data.user.email).toBe('ada@example.com');
  });
});

describe('login', () => {
  beforeEach(async () => {
    await signup().expect(201);
  });

  it('succeeds with the right password', async () => {
    const response = await login().expect(200);
    expect(response.body.data.accessToken).toBeTypeOf('string');
  });

  it('gives an identical response for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: CREDENTIALS.email, password: 'not the password' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'not the password' })
      .expect(401);

    // Identical code and message: the login form must not reveal which emails exist.
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });
});

describe('protected routes', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered token', async () => {
    const { body } = await signup().expect(201);
    const tampered = `${body.data.accessToken.slice(0, -1)}X`;

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tampered}`).expect(401);
  });

  it('rejects a malformed Authorization header', async () => {
    const { body } = await signup().expect(201);
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', body.data.accessToken) // missing the "Bearer " scheme
      .expect(401);
  });

  it('accepts a valid token and returns the caller', async () => {
    const { body } = await signup().expect(201);
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);

    expect(response.body.data.user.email).toBe('ada@example.com');
  });
});

describe('refresh token rotation', () => {
  it('issues a different refresh token on every use', async () => {
    const first = await signup().expect(201);
    const original = refreshCookieFrom(first.headers)!;

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original))
      .expect(200);

    expect(refreshCookieFrom(rotated.headers)).not.toBe(original);
  });

  /**
   * Regression test for a real bug: the family revocation used to run inside the same
   * transaction as the throw, so the rollback silently undid it and the freshly issued
   * token kept working after a detected replay.
   */
  it('revokes the whole session family when a rotated token is replayed', async () => {
    const first = await signup().expect(201);
    const original = refreshCookieFrom(first.headers)!;

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(original))
      .expect(200);
    const current = refreshCookieFrom(rotated.headers)!;

    // Replaying the spent token is treated as a compromise.
    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(original)).expect(401);

    // The token that was legitimately issued must now be dead too.
    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(current)).expect(401);
  });

  it('lets exactly one of several concurrent refreshes win', async () => {
    const first = await signup().expect(201);
    const token = refreshCookieFrom(first.headers)!;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(token)),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
  });

  it('rejects an unknown refresh token', async () => {
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader('not-a-real-token'))
      .expect(401);
  });

  it('rejects a refresh with no cookie', async () => {
    await request(app).post('/api/auth/refresh').expect(401);
  });
});

describe('logout', () => {
  it('invalidates the refresh token and is idempotent', async () => {
    const first = await signup().expect(201);
    const token = refreshCookieFrom(first.headers)!;

    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token)).expect(200);
    // Calling it twice must not error — logout is not a state machine.
    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(token)).expect(200);

    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(token)).expect(401);
  });

  it('logout-all invalidates previously issued access tokens', async () => {
    const first = await signup().expect(201);
    const accessToken = first.body.data.accessToken;

    await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // token_version was bumped, so the still-unexpired access token is no longer accepted.
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
