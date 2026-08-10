/**
 * Business (tenant) persistence.
 */

const toBusiness = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  openHour: row.open_hour,
  closeHour: row.close_hour,
});

const COLUMNS = 'id, name, slug, timezone, open_hour, close_hour';

export const findBySlug = async (executor, slug) => {
  const { rows } = await executor.query(`SELECT ${COLUMNS} FROM businesses WHERE slug = $1`, [
    slug,
  ]);
  return rows[0] ? toBusiness(rows[0]) : null;
};

export const findById = async (executor, id) => {
  const { rows } = await executor.query(`SELECT ${COLUMNS} FROM businesses WHERE id = $1`, [id]);
  return rows[0] ? toBusiness(rows[0]) : null;
};

export default { findBySlug, findById };
