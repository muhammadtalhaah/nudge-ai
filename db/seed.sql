-- =============================================================================
--  Nudge AI — sample data
-- =============================================================================
--
--  Applied by `npm run db:seed`. Safe to re-run: every insert is guarded by
--  ON CONFLICT DO NOTHING against a fixed UUID, so the script is idempotent.
--
--  Dates are computed relative to now() rather than hardcoded, so the seeded schedule is
--  always "this week" no matter when the reviewer runs it. A fixture with literal 2024
--  dates would show an empty "upcoming" list and make the app look broken.
--
--  Demo credentials (development only — these hashes are public in the repo, which is
--  exactly why the same values must never exist in a deployed environment):
--    customer  ada@example.com    / Password123!
--    customer  grace@example.com  / Password123!
--    admin     admin@example.com  / AdminPass123!
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
--  Users
-- -----------------------------------------------------------------------------
INSERT INTO users (id, business_id, email, password_hash, full_name, phone, role)
VALUES
  (
    'aaaaaaaa-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'ada@example.com',
    '$2b$12$6Ra.qnLuIJ/VU.hfC9DO7eUMi/GjiDXrqnDzuHB0Myl9KLTEdj5lO',
    'Ada Lovelace',
    '+1 555 0100',
    'customer'
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'grace@example.com',
    '$2b$12$6Ra.qnLuIJ/VU.hfC9DO7eUMi/GjiDXrqnDzuHB0Myl9KLTEdj5lO',
    'Grace Hopper',
    '+1 555 0101',
    'customer'
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'admin@example.com',
    '$2b$12$i36ahxj7EI55Nej0fDQ7S.XS4Zpb/1Q9eEUHO7CBl0vQ64JZmhOe.',
    'Clinic Admin',
    NULL,
    'admin'
  ),
  -- Same email address, different tenant. Legal because the unique index is
  -- (business_id, lower(email)), and a useful guard against that constraint regressing.
  (
    'aaaaaaaa-0000-4000-8000-000000000004',
    '22222222-2222-4222-8222-222222222222',
    'ada@example.com',
    '$2b$12$6Ra.qnLuIJ/VU.hfC9DO7eUMi/GjiDXrqnDzuHB0Myl9KLTEdj5lO',
    'Ada Lovelace',
    NULL,
    'customer'
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

-- -----------------------------------------------------------------------------
--  Appointments
-- -----------------------------------------------------------------------------
--  date_trunc to the hour keeps the seeded times on clean boundaries, and the offsets
--  land them inside the 09:00–17:00 business window.
-- -----------------------------------------------------------------------------
INSERT INTO appointments (
  id, business_id, user_id, provider_id,
  starts_at, ends_at, status, notes, source,
  cancelled_at, cancellation_reason
)
VALUES
  -- Upcoming, confirmed, booked conversationally.
  (
    'cccccccc-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    date_trunc('day', now()) + interval '2 days 10 hours',
    date_trunc('day', now()) + interval '2 days 10 hours 30 minutes',
    'CONFIRMED',
    'Recurring rash on left forearm.',
    'chat',
    NULL, NULL
  ),
  -- Upcoming, confirmed, booked through the form.
  (
    'cccccccc-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000003',
    date_trunc('day', now()) + interval '5 days 14 hours',
    date_trunc('day', now()) + interval '5 days 14 hours 45 minutes',
    'CONFIRMED',
    NULL,
    'form',
    NULL, NULL
  ),
  -- Past, completed — gives the history view something to show.
  (
    'cccccccc-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    date_trunc('day', now()) - interval '9 days' + interval '11 hours',
    date_trunc('day', now()) - interval '9 days' + interval '11 hours 30 minutes',
    'COMPLETED',
    'Annual check-up.',
    'form',
    NULL, NULL
  ),
  -- Cancelled. Note this shares its slot with the confirmed appointment below to prove
  -- the exclusion constraint ignores non-blocking statuses.
  (
    'cccccccc-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000001',
    date_trunc('day', now()) + interval '3 days 9 hours',
    date_trunc('day', now()) + interval '3 days 9 hours 30 minutes',
    'CANCELLED',
    NULL,
    'chat',
    now() - interval '1 day',
    'Patient rescheduled.'
  ),
  -- Same provider, same time as the cancelled row above: allowed, because only PENDING
  -- and CONFIRMED participate in the constraint.
  (
    'cccccccc-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    date_trunc('day', now()) + interval '3 days 9 hours',
    date_trunc('day', now()) + interval '3 days 9 hours 30 minutes',
    'CONFIRMED',
    'Took over the cancelled slot.',
    'form',
    NULL, NULL
  ),
  -- Past no-show, for status-rendering coverage.
  (
    'cccccccc-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000004',
    date_trunc('day', now()) - interval '3 days' + interval '15 hours',
    date_trunc('day', now()) - interval '3 days' + interval '16 hours',
    'NO_SHOW',
    NULL,
    'form',
    NULL, NULL
  ),
  -- Grace has an upcoming one too, so switching accounts shows different data.
  (
    'cccccccc-0000-4000-8000-000000000007',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000005',
    date_trunc('day', now()) + interval '1 day 13 hours',
    date_trunc('day', now()) + interval '1 day 13 hours 30 minutes',
    'CONFIRMED',
    'Six-month paediatric review.',
    'chat',
    NULL, NULL
  )
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
--  Chat history
-- -----------------------------------------------------------------------------
--  A completed booking conversation, so the chat view is not empty on first load and the
--  message → appointment link is demonstrable.
-- -----------------------------------------------------------------------------
INSERT INTO chat_sessions (id, business_id, user_id, title, status, message_count, last_message_at)
VALUES (
  'dddddddd-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'Dermatology appointment',
  'active',
  4,
  now() - interval '2 hours'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (id, session_id, role, content, extracted_data, created_at)
VALUES
  (
    'eeeeeeee-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-000000000001',
    'user',
    'Hi, I need to see someone about a skin rash',
    '{"intent":"book","fields":{"specialty":"Dermatology","providerName":null,"date":null,"time":null,"notes":"skin rash"},"missing":["date","time"]}'::jsonb,
    now() - interval '2 hours 5 minutes'
  ),
  (
    'eeeeeeee-0000-4000-8000-000000000002',
    'dddddddd-0000-4000-8000-000000000001',
    'assistant',
    'I can help with that. Dr. Samuel Okafor covers dermatology. What day works for you?',
    NULL,
    now() - interval '2 hours 4 minutes'
  ),
  (
    'eeeeeeee-0000-4000-8000-000000000003',
    'dddddddd-0000-4000-8000-000000000001',
    'user',
    'Day after tomorrow at 10am please',
    '{"intent":"book","fields":{"specialty":"Dermatology","providerName":"Dr. Samuel Okafor","date":null,"time":"10:00","notes":"skin rash"},"missing":[]}'::jsonb,
    now() - interval '2 hours 1 minute'
  ),
  -- The stored reply payload matters: the assistant's last turn is what tells the next turn
  -- that a booking already completed, so a vague follow-up does not re-book the same slot.
  -- Times are deliberately absent from the prose — the client renders them in the viewer's
  -- timezone from the appointment record itself.
  (
    'eeeeeeee-0000-4000-8000-000000000004',
    'dddddddd-0000-4000-8000-000000000001',
    'assistant',
    'Booked with Dr. Samuel Okafor. The details are below, and it is now in your appointments.',
    '{"kind":"appointment_created","text":"Booked with Dr. Samuel Okafor. The details are below, and it is now in your appointments."}'::jsonb,
    now() - interval '2 hours'
  )
ON CONFLICT (id) DO NOTHING;

-- Link the appointment back to the conversation that produced it.
UPDATE appointments
SET chat_session_id = 'dddddddd-0000-4000-8000-000000000001'
WHERE id = 'cccccccc-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
--  AI interaction logs
-- -----------------------------------------------------------------------------
--  Includes one failure row, because the failure path is the interesting one: it is what
--  triggers the structured-form fallback.
-- -----------------------------------------------------------------------------
INSERT INTO ai_interaction_logs (
  id, business_id, user_id, session_id, message_id,
  provider, model, outcome,
  prompt_tokens, completion_tokens, latency_ms,
  request_payload, response_payload, error_message, created_at
)
VALUES
  (
    'ffffffff-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000001',
    'mistral',
    'mistral-small-latest',
    'success',
    412, 88, 734,
    '{"turns":1}'::jsonb,
    '{"intent":"book","missing":["date","time"]}'::jsonb,
    NULL,
    now() - interval '2 hours 5 minutes'
  ),
  (
    'ffffffff-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-000000000001',
    'eeeeeeee-0000-4000-8000-000000000003',
    'mistral',
    'mistral-small-latest',
    'invalid_output',
    455, 61, 902,
    '{"turns":3}'::jsonb,
    '{"raw":"Sure! I will book that for you."}'::jsonb,
    'Response did not satisfy aiExtractionSchema: expected object, received string',
    now() - interval '2 hours 2 minutes'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- -----------------------------------------------------------------------------
--  Summary
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM businesses)          AS businesses,
  (SELECT count(*) FROM users)               AS users,
  (SELECT count(*) FROM providers)           AS providers,
  (SELECT count(*) FROM appointments)        AS appointments,
  (SELECT count(*) FROM chat_sessions)       AS chat_sessions,
  (SELECT count(*) FROM chat_messages)       AS chat_messages,
  (SELECT count(*) FROM ai_interaction_logs) AS ai_logs;
