/**
 * Appointment persistence.
 *
 * Reads join providers so the API can return a usable appointment in one round trip
 * instead of making the client fetch names separately.
 */

import type { AppointmentSource, AppointmentStatus } from '@shared/constants.ts';

import type { Executor } from '../db/pool.ts';

export interface Appointment {
  id: string;
  businessId: string;
  userId: string;
  providerId: string;
  providerName: string;
  providerSpecialty: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  source: AppointmentSource;
  chatSessionId: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
}

interface AppointmentRow {
  id: string;
  business_id: string;
  user_id: string;
  provider_id: string;
  provider_name: string;
  provider_specialty: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  notes: string | null;
  source: AppointmentSource;
  chat_session_id: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
}

const toAppointment = (row: AppointmentRow): Appointment => ({
  id: row.id,
  businessId: row.business_id,
  userId: row.user_id,
  providerId: row.provider_id,
  providerName: row.provider_name,
  providerSpecialty: row.provider_specialty,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  notes: row.notes,
  source: row.source,
  chatSessionId: row.chat_session_id,
  cancelledAt: row.cancelled_at,
  cancellationReason: row.cancellation_reason,
  createdAt: row.created_at,
});

const SELECT_WITH_PROVIDER = `
  SELECT a.id, a.business_id, a.user_id, a.provider_id,
         p.full_name AS provider_name, p.specialty AS provider_specialty,
         a.starts_at, a.ends_at, a.status, a.notes, a.source, a.chat_session_id,
         a.cancelled_at, a.cancellation_reason, a.created_at
    FROM appointments a
    JOIN providers p ON p.id = a.provider_id
`;

export interface CreateAppointmentRow {
  businessId: string;
  userId: string;
  providerId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes?: string | null;
  source: AppointmentSource;
  chatSessionId?: string | null;
}

/**
 * Insert an appointment.
 *
 * There is no "is this slot free?" query beforehand, and that is the point: the exclusion
 * constraint is the authority. A check-then-insert would race, because two requests can
 * both read "free" before either writes. A rejection arrives here as SQLSTATE 23P01 and is
 * translated to 409 SLOT_UNAVAILABLE by the error middleware.
 */
export const create = async (
  executor: Executor,
  input: CreateAppointmentRow,
): Promise<Appointment> => {
  const { rows } = await executor.query<{ id: string }>(
    `INSERT INTO appointments
       (business_id, user_id, provider_id, starts_at, ends_at, status, notes, source, chat_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.businessId,
      input.userId,
      input.providerId,
      input.startsAt,
      input.endsAt,
      input.status,
      input.notes ?? null,
      input.source,
      input.chatSessionId ?? null,
    ],
  );

  const id = rows[0]?.id;
  if (!id) throw new Error('INSERT ... RETURNING produced no row');

  const created = await findById(executor, id);
  if (!created) throw new Error('appointment vanished immediately after insert');
  return created;
};

/** Unscoped lookup — callers are responsible for authorising the result. */
export const findById = async (executor: Executor, id: string): Promise<Appointment | null> => {
  const { rows } = await executor.query<AppointmentRow>(`${SELECT_WITH_PROVIDER} WHERE a.id = $1`, [
    id,
  ]);
  return rows[0] ? toAppointment(rows[0]) : null;
};

export type AppointmentScope = 'upcoming' | 'past' | 'all';

export interface ListFilters {
  userId: string;
  status?: AppointmentStatus | undefined;
  scope: AppointmentScope;
  page: number;
  limit: number;
}

/**
 * A user's appointments, newest-relevant first.
 *
 * Upcoming is sorted ascending (the next appointment matters most) while past is sorted
 * descending (the most recent matters most) — the ordering follows what the reader wants,
 * not one arbitrary rule.
 */
export const listForUser = async (
  executor: Executor,
  filters: ListFilters,
): Promise<{ items: Appointment[]; total: number }> => {
  const conditions = ['a.user_id = $1'];
  const params: unknown[] = [filters.userId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.status = $${params.length}`);
  }

  if (filters.scope === 'upcoming') {
    // Future *and* still live. A cancelled appointment is not "upcoming" — showing it here
    // made a cancellation look like it had not taken effect. It remains visible under All.
    conditions.push(`a.starts_at >= now() AND a.status IN ('PENDING', 'CONFIRMED')`);
  } else if (filters.scope === 'past') {
    conditions.push('a.starts_at < now()');
  }

  const where = conditions.join(' AND ');
  const order = filters.scope === 'upcoming' ? 'a.starts_at ASC' : 'a.starts_at DESC';

  // Count and page in parallel — they are independent reads.
  const offset = (filters.page - 1) * filters.limit;
  const [countResult, pageResult] = await Promise.all([
    executor.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM appointments a WHERE ${where}`,
      params,
    ),
    executor.query<AppointmentRow>(
      `${SELECT_WITH_PROVIDER} WHERE ${where} ORDER BY ${order} LIMIT ${filters.limit} OFFSET ${offset}`,
      params,
    ),
  ]);

  return {
    items: pageResult.rows.map(toAppointment),
    total: Number(countResult.rows[0]?.total ?? 0),
  };
};

/**
 * Cancel, guarding the status transition in the WHERE clause.
 *
 * Restricting to currently-blocking statuses makes the update a conditional write: a second
 * concurrent cancel, or a cancel of an already-completed appointment, changes 0 rows and the
 * caller reports an invalid transition. Doing this check in application code after a SELECT
 * would leave a window between the two.
 */
export const cancel = async (
  executor: Executor,
  id: string,
  reason: string | null,
): Promise<Appointment | null> => {
  const { rowCount } = await executor.query(
    `UPDATE appointments
        SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2
      WHERE id = $1 AND status IN ('PENDING', 'CONFIRMED')`,
    [id, reason],
  );

  if (!rowCount) return null;
  return findById(executor, id);
};

/** Upcoming appointments for the assistant to reference when asked to cancel or list. */
export const listUpcomingForUser = async (
  executor: Executor,
  userId: string,
  limit = 10,
): Promise<Appointment[]> => {
  const { rows } = await executor.query<AppointmentRow>(
    `${SELECT_WITH_PROVIDER}
      WHERE a.user_id = $1
        AND a.status IN ('PENDING', 'CONFIRMED')
        AND a.starts_at >= now()
      ORDER BY a.starts_at ASC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toAppointment);
};

/**
 * Times already taken for a provider on a given day, so the booking UI and the assistant
 * can offer slots that are actually free.
 */
export const listBookedTimesForProvider = async (
  executor: Executor,
  providerId: string,
  fromInclusive: Date,
  toExclusive: Date,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> => {
  const { rows } = await executor.query<{ starts_at: Date; ends_at: Date }>(
    `SELECT starts_at, ends_at
       FROM appointments
      WHERE provider_id = $1
        AND status IN ('PENDING', 'CONFIRMED')
        AND starts_at >= $2
        AND starts_at < $3
      ORDER BY starts_at`,
    [providerId, fromInclusive, toExclusive],
  );
  return rows.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at }));
};

export default {
  create,
  findById,
  listForUser,
  cancel,
  listUpcomingForUser,
  listBookedTimesForProvider,
};
