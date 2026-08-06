/**
 * Business (tenant) persistence.
 */

import type { Executor } from '../db/pool.ts';

export interface Business {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  openHour: number;
  closeHour: number;
}

interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  open_hour: number;
  close_hour: number;
}

const toBusiness = (row: BusinessRow): Business => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  openHour: row.open_hour,
  closeHour: row.close_hour,
});

const COLUMNS = 'id, name, slug, timezone, open_hour, close_hour';

export const findBySlug = async (executor: Executor, slug: string): Promise<Business | null> => {
  const { rows } = await executor.query<BusinessRow>(
    `SELECT ${COLUMNS} FROM businesses WHERE slug = $1`,
    [slug],
  );
  return rows[0] ? toBusiness(rows[0]) : null;
};

export const findById = async (executor: Executor, id: string): Promise<Business | null> => {
  const { rows } = await executor.query<BusinessRow>(
    `SELECT ${COLUMNS} FROM businesses WHERE id = $1`,
    [id],
  );
  return rows[0] ? toBusiness(rows[0]) : null;
};

export default { findBySlug, findById };
