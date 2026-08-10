-- =============================================================================
--  Nudge AI — tenant fixtures (businesses + providers)
-- =============================================================================
--
--  The half of the sample data that is safe to apply anywhere, including production:
--  it contains no user accounts and therefore no password hashes.
--
--  This file is not optional in a deployment. `authService` resolves
--  DEFAULT_BUSINESS_SLUG on every registration, and refuses to register anyone if the
--  row is missing — so without this seed a fresh deployment has no way to create even
--  the first account. `db/seed-demo.sql` holds the rest, and is local-only.
--
--  Safe to re-run: every insert is guarded by ON CONFLICT DO NOTHING against a fixed
--  UUID, so this is applied on every deploy rather than tracked as a one-off migration.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
--  Tenant
-- -----------------------------------------------------------------------------
INSERT INTO businesses (id, name, slug, timezone, open_hour, close_hour)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Northside Health Clinic',
  'northside-health',
  'UTC',
  9,
  17
)
ON CONFLICT (id) DO NOTHING;

-- A second tenant, present purely to prove that tenant scoping actually works: every
-- query in the application filters by business_id, and this row is what makes a missing
-- filter visible in testing instead of silently correct.
INSERT INTO businesses (id, name, slug, timezone, open_hour, close_hour)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'Southgate Dental',
  'southgate-dental',
  'UTC',
  8,
  16
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
--  Providers
-- -----------------------------------------------------------------------------
INSERT INTO providers (id, business_id, full_name, specialty, bio, slot_duration_minutes)
VALUES
  (
    'bbbbbbbb-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Maya Chen',
    'General Practice',
    'Family medicine and routine check-ups. 12 years in practice.',
    30
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Samuel Okafor',
    'Dermatology',
    'Skin conditions, allergy testing and minor procedures.',
    30
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Priya Raman',
    'Cardiology',
    'Preventive cardiology and cardiac risk assessment.',
    45
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Tomas Lindqvist',
    'Physiotherapy',
    'Sports injuries, post-operative rehabilitation and mobility work.',
    60
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Leila Haddad',
    'Paediatrics',
    'Childhood development, immunisations and general paediatric care.',
    30
  ),
  -- Inactive on purpose: booking against this provider must be rejected, and it must not
  -- appear in the browsable list.
  (
    'bbbbbbbb-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'Dr. Ronan Blake',
    'General Practice',
    'On extended leave.',
    30
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000007',
    '22222222-2222-4222-8222-222222222222',
    'Dr. Nina Alvarez',
    'Dentistry',
    'Routine dental care and hygiene.',
    30
  )
ON CONFLICT (id) DO NOTHING;

UPDATE providers
SET is_active = false
WHERE id = 'bbbbbbbb-0000-4000-8000-000000000006';

COMMIT;
