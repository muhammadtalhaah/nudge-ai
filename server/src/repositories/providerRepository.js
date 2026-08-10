/**
 * Provider persistence.
 */

const toProvider = (row) => ({
  id: row.id,
  businessId: row.business_id,
  fullName: row.full_name,
  specialty: row.specialty,
  bio: row.bio,
  slotDurationMinutes: row.slot_duration_minutes,
  isActive: row.is_active,
});

const COLUMNS = 'id, business_id, full_name, specialty, bio, slot_duration_minutes, is_active';

/** Bookable providers for a tenant. Matches the providers_business_active_idx index. */
export const listActive = async (executor, businessId, specialty) => {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS}
       FROM providers
      WHERE business_id = $1
        AND is_active
        AND ($2::text IS NULL OR specialty ILIKE $2)
      ORDER BY specialty, full_name`,
    [businessId, specialty ?? null],
  );
  return rows.map(toProvider);
};

/** Distinct specialties offered, for the booking form's filter and the assistant's prompt. */
export const listSpecialties = async (executor, businessId) => {
  const { rows } = await executor.query(
    `SELECT DISTINCT specialty
       FROM providers
      WHERE business_id = $1 AND is_active
      ORDER BY specialty`,
    [businessId],
  );
  return rows.map((row) => row.specialty);
};

/**
 * Fetch by id, scoped to the tenant.
 *
 * businessId is a required argument rather than an optional filter: a provider id from
 * another tenant must be indistinguishable from one that does not exist.
 */
export const findById = async (executor, businessId, id) => {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS} FROM providers WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  return rows[0] ? toProvider(rows[0]) : null;
};

/**
 * Best-effort name match, used by the assistant when a user names a practitioner in prose
 * ("Dr. Okafor"). Returns every candidate so the caller can decide what an ambiguous match
 * means, rather than silently guessing one.
 */
export const findByNameLike = async (executor, businessId, nameFragment) => {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS}
       FROM providers
      WHERE business_id = $1 AND is_active AND full_name ILIKE '%' || $2 || '%'
      ORDER BY full_name
      LIMIT 5`,
    [businessId, nameFragment],
  );
  return rows.map(toProvider);
};

export default { listActive, listSpecialties, findById, findByNameLike };
