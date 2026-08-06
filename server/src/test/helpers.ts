/**
 * Shared test helpers: database reset, tenant/provider fixtures, and cookie plumbing.
 */

import { randomUUID } from 'node:crypto';

import { pool } from '../db/pool.ts';
import { REFRESH_COOKIE_NAME } from '../utils/cookies.ts';

/**
 * Truncate every application table between tests.
 *
 * TRUNCATE ... CASCADE rather than per-table DELETE: it resets in one statement regardless
 * of foreign-key order, and it is far faster than deleting rows.
 */
export const resetDatabase = async (): Promise<void> => {
  await pool.query(`
    TRUNCATE ai_interaction_logs, refresh_tokens, appointments,
             chat_messages, chat_sessions, providers, users, businesses
    RESTART IDENTITY CASCADE
  `);
};

export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};

export interface SeededTenant {
  businessId: string;
  /** General Practice. */
  providerId: string;
  providerName: string;
  /** Dermatology — used to test one user double-booking across two providers. */
  otherProviderId: string;
  otherProviderName: string;
}

/**
 * Minimal tenant: one business, two active providers.
 *
 * Provider names are derived from the slug so two tenants never share a name. That matters:
 * with identical names in both tenants, a "cannot book another tenant's provider" test would
 * pass by accidentally matching the caller's own provider, and would keep passing even if
 * tenant scoping broke entirely.
 */
export const seedTenant = async (slug = 'northside-health'): Promise<SeededTenant> => {
  const businessId = randomUUID();
  await pool.query(
    `INSERT INTO businesses (id, name, slug, timezone, open_hour, close_hour)
     VALUES ($1, 'Test Clinic', $2, 'UTC', 0, 24)`,
    [businessId, slug],
  );

  // "northside-health" -> "Northsidehealth"
  const label = slug.replace(/-/g, '').replace(/^./, (c) => c.toUpperCase());
  const providerName = `Dr. ${label} Generalist`;
  const otherProviderName = `Dr. ${label} Dermatologist`;

  const providerId = randomUUID();
  const otherProviderId = randomUUID();
  await pool.query(
    `INSERT INTO providers (id, business_id, full_name, specialty, slot_duration_minutes)
     VALUES ($1, $3, $4, 'General Practice', 30),
            ($2, $3, $5, 'Dermatology', 30)`,
    [providerId, otherProviderId, businessId, providerName, otherProviderName],
  );

  return { businessId, providerId, providerName, otherProviderId, otherProviderName };
};

/** Extract the refresh cookie value from a supertest response's set-cookie header. */
export const refreshCookieFrom = (headers: Record<string, unknown>): string | null => {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];

  for (const cookie of cookies) {
    const match = new RegExp(`${REFRESH_COOKIE_NAME}=([^;]+)`).exec(cookie);
    // An expired clear-cookie also matches, so ignore the empty value it carries.
    if (match?.[1] && match[1] !== '') return match[1];
  }
  return null;
};

export const cookieHeader = (token: string): string => `${REFRESH_COOKIE_NAME}=${token}`;

/** Business hours are 0–24 in fixtures, so any future hour is bookable. */
export const futureIso = (hoursFromNow: number): string =>
  new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
