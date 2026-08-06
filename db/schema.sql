-- =============================================================================
--  Nudge AI — PostgreSQL schema
-- =============================================================================
--
--  Applied by `npm run db:setup`. This file is the single source of truth for the
--  schema; there is no migration tool in this prototype (see the note at the end of
--  this header for why, and what production would do instead).
--
--  Conventions
--    * snake_case identifiers. The repository layer maps rows to camelCase; nothing
--      above the repositories sees snake_case.
--    * UUID primary keys via gen_random_uuid() (pgcrypto, bundled since PG 13).
--    * All instants are timestamptz, stored in UTC. Timezone is applied at the query
--      and render boundaries only.
--    * Status/role columns are TEXT + CHECK rather than native ENUM. Adding a value is
--      a one-line change instead of ALTER TYPE, and the permitted values are already
--      centralised in shared/constants.ts.
--    * business_id on every tenant-scoped table — the optional multi-tenancy from the
--      brief. It is threaded through from day one because retrofitting a tenant key onto
--      a live schema is painful, and it costs almost nothing to carry now.
--
--  Migration note: a real deployment would use versioned migrations
--  (node-pg-migrate / Flyway) so schema changes are incremental, reviewable and
--  reversible. A single schema.sql was chosen here because the brief asks for the DDL
--  as a reviewable deliverable, and maintaining both would create two sources of truth.
-- =============================================================================

BEGIN;

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Required by the appointments exclusion constraint: btree_gist lets a GiST index mix
-- a scalar equality column (provider_id) with a range overlap operator in one index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
--  Shared trigger: keep updated_at honest without trusting the application to set it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
--  businesses — the tenant root
-- =============================================================================
CREATE TABLE businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  -- IANA zone, e.g. 'Asia/Karachi'. Business hours below are interpreted in this zone.
  timezone    text        NOT NULL DEFAULT 'UTC',
  open_hour   smallint    NOT NULL DEFAULT 9  CHECK (open_hour  BETWEEN 0 AND 23),
  close_hour  smallint    NOT NULL DEFAULT 17 CHECK (close_hour BETWEEN 1 AND 24),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT businesses_hours_ordered CHECK (close_hour > open_hour)
);

CREATE TRIGGER businesses_set_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
--  users — authentication and profile data
-- =============================================================================
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  email         text        NOT NULL CHECK (position('@' IN email) > 1),
  password_hash text        NOT NULL,
  full_name     text        NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone         text,
  role          text        NOT NULL DEFAULT 'customer'
                            CHECK (role IN ('customer', 'staff', 'admin')),
  is_active     boolean     NOT NULL DEFAULT true,
  -- Bumped on password change or deactivation; every access token carrying an older
  -- value is rejected. Gives us instant revocation without a token blacklist.
  token_version integer     NOT NULL DEFAULT 0,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Email is unique WITHIN a business, not globally: the same person may hold accounts at
-- two different tenants. This is the constraint most single-tenant schemas get wrong when
-- they later add multi-tenancy.
CREATE UNIQUE INDEX users_business_email_key ON users (business_id, lower(email));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
--  providers — the bookable resource (a practitioner)
-- =============================================================================
CREATE TABLE providers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  full_name             text        NOT NULL CHECK (length(btrim(full_name)) > 0),
  specialty             text        NOT NULL CHECK (length(btrim(specialty)) > 0),
  bio                   text,
  slot_duration_minutes smallint    NOT NULL DEFAULT 30
                                    CHECK (slot_duration_minutes BETWEEN 5 AND 480),
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER providers_set_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
--  chat_sessions — conversation history and metadata
-- =============================================================================
CREATE TABLE chat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title           text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'closed')),
  -- Denormalised so the session list can be ordered and rendered without touching
  -- chat_messages. Maintained by the application inside the same transaction as the
  -- message insert.
  message_count   integer     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER chat_sessions_set_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
--  chat_messages — one row per turn
-- =============================================================================
--  Normalised out of chat_sessions rather than kept as a JSONB array on the session.
--  Reasons: messages are append-only and unbounded, so an array would rewrite the whole
--  session row on every turn; per-message rows can be paginated and indexed; and the
--  extracted booking data stays attached to the exact turn that produced it.
-- =============================================================================
CREATE TABLE chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    text        NOT NULL CHECK (length(content) > 0),
  -- The structured booking fields the model pulled from this turn, already validated
  -- against shared/schemas.ts before insert. JSONB because the shape is a contract with
  -- the model, not something we query relationally.
  extracted_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
--  appointments — scheduling data and status
-- =============================================================================
CREATE TABLE appointments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider_id uuid        NOT NULL REFERENCES providers (id) ON DELETE RESTRICT,

  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,

  status      text        NOT NULL DEFAULT 'CONFIRMED'
                          CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED',
                                            'COMPLETED', 'NO_SHOW')),
  notes       text,

  -- Which surface created this: conversational or the structured form. Makes the AI
  -- funnel measurable, which is the point of logging AI interactions at all.
  source      text        NOT NULL DEFAULT 'form'
                          CHECK (source IN ('chat', 'form')),
  -- ON DELETE SET NULL: losing a conversation must never delete the appointment it made.
  chat_session_id uuid    REFERENCES chat_sessions (id) ON DELETE SET NULL,

  cancelled_at        timestamptz,
  cancellation_reason text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appointments_ends_after_starts CHECK (ends_at > starts_at),
  -- Keeps the cancellation columns consistent with the status rather than trusting
  -- application code to set them together.
  CONSTRAINT appointments_cancelled_fields CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    OR (status <> 'CANCELLED' AND cancelled_at IS NULL)
  )
);

-- -----------------------------------------------------------------------------
--  THE double-booking guard.
-- -----------------------------------------------------------------------------
--  Two concurrent requests for the same provider and overlapping time cannot both
--  commit — the database refuses the second regardless of what the application does.
--  The '[)' bound means a 09:00–09:30 appointment does not collide with 09:30–10:00.
--
--  Only PENDING and CONFIRMED occupy a slot, so cancelling frees the time immediately
--  and history is preserved (no row deletion, no tombstone flag).
--
--  Chosen over the alternatives:
--    * An application-level "SELECT then INSERT" check is racy by construction — both
--      requests read "free" before either writes.
--    * SELECT ... FOR UPDATE needs an existing row to lock. There is no slot row here
--      (availability is open-ended), so there is nothing to lock.
--    * A UNIQUE index on (provider_id, starts_at) would only catch exactly-equal start
--      times, not a 09:15 booking overlapping an existing 09:00–09:30.
--
--  Violations raise SQLSTATE 23P01 (exclusion_violation), which the error middleware
--  translates to HTTP 409 SLOT_UNAVAILABLE.
-- -----------------------------------------------------------------------------
ALTER TABLE appointments
  ADD CONSTRAINT appointments_provider_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));

-- The same protection from the customer's side: nobody can hold two appointments at
-- once, even with different providers.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_user_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));

CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
--  ai_interaction_logs — observability for the LLM calls
-- =============================================================================
--  Satisfies the brief's "log AI interactions for debugging or analytics". A table
--  rather than console-only, because the interesting questions are aggregate ones:
--  how often does extraction fail, how often do we fall back to the form, what does a
--  conversation cost, how slow is the provider.
-- =============================================================================
CREATE TABLE ai_interaction_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  session_id   uuid        REFERENCES chat_sessions (id) ON DELETE CASCADE,
  message_id   uuid        REFERENCES chat_messages (id) ON DELETE SET NULL,

  provider     text        NOT NULL,   -- 'mistral' | 'stub'
  model        text,
  outcome      text        NOT NULL
                           CHECK (outcome IN ('success', 'invalid_output',
                                              'provider_error', 'timeout')),

  prompt_tokens     integer CHECK (prompt_tokens     IS NULL OR prompt_tokens     >= 0),
  completion_tokens integer CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  latency_ms        integer CHECK (latency_ms        IS NULL OR latency_ms        >= 0),

  -- Prompt/response kept for debugging. Note: these contain user-authored text, so a
  -- production system needs a retention policy here. Called out in the README.
  request_payload  jsonb,
  response_payload jsonb,
  error_message    text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
--  refresh_tokens — rotating sessions
-- =============================================================================
--  Only the SHA-256 hash is stored: a database leak does not hand out usable sessions.
-- =============================================================================
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
--  INDEXES
-- =============================================================================
--  One index per real access path. Each is annotated with the query that justifies it;
--  an index without a caller is write cost for nothing.
-- =============================================================================

-- Login: SELECT ... FROM users WHERE business_id = $1 AND lower(email) = $2
--   → served by the users_business_email_key unique index defined above.

-- Browse bookable providers:
--   WHERE business_id = $1 AND is_active ORDER BY specialty, full_name
CREATE INDEX providers_business_active_idx
  ON providers (business_id, specialty, full_name)
  WHERE is_active;

-- "My appointments", newest first, paginated:
--   WHERE user_id = $1 [AND status = $2] ORDER BY starts_at DESC
CREATE INDEX appointments_user_starts_idx
  ON appointments (user_id, starts_at DESC);

-- A provider's day, and the read the booking flow does before inserting:
--   WHERE provider_id = $1 AND starts_at >= $2 AND starts_at < $3
CREATE INDEX appointments_provider_starts_idx
  ON appointments (provider_id, starts_at);

-- Tenant-wide upcoming schedule. Partial, because cancelled and completed rows
-- accumulate forever while only live ones are queried this way — the index stays small
-- regardless of history size.
CREATE INDEX appointments_business_upcoming_idx
  ON appointments (business_id, starts_at)
  WHERE status IN ('PENDING', 'CONFIRMED');

-- Session list for the sidebar: WHERE user_id = $1 ORDER BY last_message_at DESC
CREATE INDEX chat_sessions_user_recent_idx
  ON chat_sessions (user_id, last_message_at DESC NULLS LAST);

-- Replaying a conversation: WHERE session_id = $1 ORDER BY created_at
CREATE INDEX chat_messages_session_created_idx
  ON chat_messages (session_id, created_at);

-- AI debugging by conversation, and failure-rate analytics.
CREATE INDEX ai_logs_session_created_idx
  ON ai_interaction_logs (session_id, created_at DESC);
CREATE INDEX ai_logs_outcome_created_idx
  ON ai_interaction_logs (outcome, created_at DESC)
  WHERE outcome <> 'success';

-- Refresh rotation looks tokens up by hash (already UNIQUE). This partial index serves
-- "revoke every live session for this user" on logout-all and deactivation.
CREATE INDEX refresh_tokens_user_live_idx
  ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

-- =============================================================================
--  PERFORMANCE NOTES
-- =============================================================================
--
--  1. Where the load actually is. Reads dominate: appointment lists and conversation
--     replays. Both are indexed on their exact predicate and sort order, so they are
--     index scans, not sorts over a heap.
--
--  2. Partial indexes over full ones. appointments_business_upcoming_idx and
--     ai_logs_outcome_created_idx only cover rows anyone queries. In an appointment
--     system, historical rows grow without bound while the working set stays roughly
--     constant, so partial indexes keep index size proportional to live data.
--
--  3. The exclusion constraint is not free. It builds a GiST index and serialises
--     conflicting writes for the same provider. That is the correct trade — correctness
--     over throughput — and contention is per-provider, not global.
--
--  4. Denormalised counters. chat_sessions.message_count and last_message_at avoid a
--     COUNT/MAX over chat_messages to render a session list. They are written in the
--     same transaction as the message, so they cannot drift.
--
--  5. Where this stops scaling, and what to do then:
--       * chat_messages and ai_interaction_logs grow fastest. Past ~10^7 rows, partition
--         both by created_at (monthly) and drop old partitions on a retention policy.
--       * appointments would partition by business_id once one tenant dominates.
--       * Dashboard aggregates (bookings per day, AI fallback rate) should become a
--         materialised view refreshed on a schedule rather than aggregating live.
--       * ai_interaction_logs.request_payload/response_payload are the bulk of the
--         storage. Truncate or offload them to object storage after N days.
--
--  6. Deliberately absent. No full-text search index (provider lists are small enough to
--     filter in memory per tenant), and no covering/INCLUDE indexes — with tables this
--     size they would be premature.
--
--  7. Connection pooling. The pg Pool is capped in server config. Serverless Postgres
--     (Neon) is used through its pooled connection string, since a per-request
--     connection model would exhaust backends under any real concurrency.
--
-- =============================================================================

COMMIT;
