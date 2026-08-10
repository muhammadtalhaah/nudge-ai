# Nudge AI — AI-assisted appointment booking

A working prototype of a SaaS appointment-booking app. You describe what you need in plain
language, an LLM extracts the booking details, and the system books it — falling back to a
prefilled form whenever the model cannot get all the way there.

Built as a technical assessment. The emphasis is on architecture, service boundaries, and
defensible decisions rather than feature count.

**Live demo:** _not yet deployed — see [Deployment](#deployment). `render.yaml` and a
`Dockerfile` are in the repo, ready to point at a host._

---

## Quick start

**Prerequisites:** Node 20+ and PostgreSQL 14+. No API key needed — the app ships with a
deterministic offline assistant and runs fully without credentials.

```bash
git clone https://github.com/muhammadtalhaah/nudge-ai.git
cd nudge-ai
npm install

cp server/.env.example server/.env
# Edit server/.env: set DATABASE_URL, and generate the two JWT secrets with
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

createdb nudge_ai_dev
npm run db:setup      # applies db/schema.sql
npm run db:seed       # applies db/seed.sql — sample clinic, doctors, appointments

npm run dev           # API on :4000, client on :5173
```

Open http://localhost:5173 and sign in with a seeded account:

| Email               | Password        | Role     |
| ------------------- | --------------- | -------- |
| `ada@example.com`   | `Password123!`  | customer |
| `grace@example.com` | `Password123!`  | customer |
| `admin@example.com` | `AdminPass123!` | admin    |

To use the real LLM, set `MISTRAL_API_KEY` in `server/.env` (a free key from
[console.mistral.ai](https://console.mistral.ai)) and restart. The app auto-selects Mistral
when a key is present and the offline assistant when it is not.

### Commands

| Command                                     | What it does                                                        |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                               | API + client with hot reload                                        |
| `npm run build`                             | Builds the client (the server runs from source — no build step)     |
| `npm start`                                 | Runs the server for production (serves API **and** client from one port) |
| `npm test`                                  | Full suite — server (real Postgres) then client (jsdom)             |
| `npm run db:setup` / `db:seed` / `db:reset` | Schema, sample data, drop-and-recreate                              |
| `npm run format`                            | Prettier                                                            |
| `node scripts/browserSmoke.mjs`             | Drives the running app in Chrome, writes screenshots                |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  client/          React 19 + Vite + Tailwind v4 + shadcn/ui     │
│  pages → hooks → api → (REST + Socket.IO)                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │  same origin: Vite proxies /api in dev,
                            │  the API serves the bundle in production
┌───────────────────────────▼─────────────────────────────────────┐
│  server/          Node + Express 5 + Socket.IO (JavaScript)     │
│                                                                 │
│   routes  →  controllers  →  services  →  repositories  →  pg   │
│   wiring     HTTP↔service    rules +        SQL +               │
│              only            transactions   row mapping         │
│                                                                 │
│   ai/  provider boundary: mistral | offline stub                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  PostgreSQL       8 tables. The exclusion constraint on         │
│                   appointments is the authority on availability. │
└─────────────────────────────────────────────────────────────────┘

shared/   Zod schemas + domain constants, imported by BOTH sides
```

Full detail in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

### The three ideas that shape everything else

**1. One service layer, two transports.** `chatService.handleMessage()` is the single entry
point for a chat turn. The REST endpoint calls it and the Socket.IO handler calls it. The
WebSocket is transport, not a second implementation — so no rule can hold over one path and
not the other. The socket test suite asserts exactly this by re-running the REST guarantees
over the socket.

**2. The database is the authority on availability.** Booking does not check whether a slot
is free and then insert; it just inserts, and a PostgreSQL `EXCLUDE` constraint refuses any
overlap. A check-then-insert is racy by construction — two requests both read "free" before
either writes. There is a test that fires ten simultaneous bookings at one slot and asserts
exactly one 201 and nine 409s.

**3. The model proposes; the server decides.** The LLM only ever returns an intent and some
strings. It cannot read the database, cannot book, never sees an appointment id, and is never
consulted about authorisation. Its output is parsed through a Zod schema before anything
downstream trusts it, and every booking it suggests is re-validated against real records.

---

## The AI integration

One structured-extraction call per turn. No tool-calling loop, no agent framework.

```
user message
    │
    ├─ persisted first  ── so a provider outage cannot lose what they typed
    │
    ├─ last N turns loaded as context (simple memory, no vector store)
    │
    ├─ provider.complete()  ──►  Mistral  |  offline stub
    │                             both return the SAME JSON contract
    │
    ├─ Zod validation  ──►  fails?  ──►  FORM FALLBACK
    │
    ├─ resolve "Dr. Okafor" / "Dermatology" against real provider rows
    │       unknown → form fallback     ambiguous → offer a choice
    │
    ├─ complete + unambiguous?  ──►  appointmentService.book()
    │       refused (slot taken, past, closed) → form fallback, nothing lost
    │
    └─ every outcome logged to ai_interaction_logs
```

**The fallback is the feature.** When extraction is incomplete or ambiguous, the reply carries
a `form_fallback` payload with whatever _was_ understood, and the client renders the booking
form prefilled with those values and the missing fields marked. Say "I have an itchy rash" and
you get a form with Dermatology and Dr. Okafor already chosen, and Date/Time flagged as still
needed. The user finishes in two clicks instead of retyping.

Conversations are listed in the sidebar and selected **by URL** (`/chat?session=<id>`), so switching threads, reloading, and sharing a link all reopen the same conversation — including its stored rich payloads.

**Guardrails**, all tested:

| Risk                                        | Mitigation                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Malformed / hallucinated JSON               | Parsed through `aiExtractionSchema`; failure degrades to the form                                               |
| Invented doctor                             | Resolved against real rows; no match → form fallback                                                            |
| Provider outage or timeout                  | Caught, logged, degrades to the form — never a 500                                                              |
| Prompt injection                            | Model output grants no authority; identity comes from the JWT, mutations re-validated server-side               |
| Destructive action from a model instruction | "Cancel everything" only ever _lists_ appointments; cancelling requires a deliberate click on a specific record |
| Cross-tenant / cross-user access            | Every query scoped by `business_id` and `user_id` from the token                                                |
| Medical advice                              | System prompt refuses diagnosis and redirects to scheduling                                                     |
| Cost / abuse                                | Per-user rate limit on both REST and socket paths                                                               |

**Structured UI payloads are server-derived, never model-authored.** Doctor cards, slot lists
and confirmations are built from database records. A hallucinated appointment cannot be
rendered as if it were real.

### Streaming the reply

The model does not emit prose — it emits a JSON object, and the prose is one field inside it.
So streaming is not "forward the tokens": `ai/replyStream.js` decodes the `reply` string out
of a document whose closing brace has not arrived yet, and forwards only that. The structure
around it (`intent`, `fields`, `missing`) is never shown, and no JSON parser is ever run over
an incomplete document. Fragments go out as `assistant:delta`; the finished turn follows as
`assistant:reply`.

**What streams is a draft, and the UI treats it as one.** The prompt has the assistant say
"I'll get that booked", never "you're booked" — so early prose is a statement of intent, and
the authoritative reply that replaces it is what actually happened, built from the records the
service just wrote. That is also why a delta can never carry an appointment: acting on a
partial turn is exactly the thing this design refuses.

**Only real generation streams.** `supportsStreaming` is declared per provider. Mistral streams;
the offline stub computes its answer in one pass and returns `false`, because slicing a
finished string into timed "tokens" would be an animation pretending to be generation — the
same pretence `isDeterministic` exists to avoid. Offline, the working indicator shows and then
the reply appears. The REST path does not stream either, and the client handles both.

**How much it buys, measured against the live API.** Because `reply` is the _last_ key, most of
the wait is spent generating the fields before any prose exists — first fragment lands at
78–91% of total turn latency. Moving `reply` first cuts that to 53–64%, roughly tripling the
visible benefit, and produced identical extractions on the cases tried. It is not done here:
writing prose before committing to the extraction is a real change to the AI contract, and
the sample was three messages, not an evaluation.

---

## API

All routes are under `/api`. Responses use one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { "page": 1, "total": 12, ... } }

// failure
{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "...",
  "details": [{ "path": "email", "message": "..." }] }, "requestId": "…" }
```

`details` carries field-level errors, which the client maps back onto the offending form
input rather than showing a banner.

| Method       | Path                           | Auth   | Notes                                                        |
| ------------ | ------------------------------ | ------ | ------------------------------------------------------------ |
| `POST`       | `/auth/signup`                 | —      | Sets the refresh cookie. Role is ignored — always `customer` |
| `POST`       | `/auth/login`                  | —      | Identical response for wrong password and unknown email      |
| `POST`       | `/auth/refresh`                | cookie | Rotates the token; replay revokes the whole session family   |
| `POST`       | `/auth/logout`                 | cookie | Idempotent                                                   |
| `POST`       | `/auth/logout-all`             | bearer | Also invalidates live access tokens                          |
| `GET`        | `/auth/me`                     | bearer |                                                              |
| `GET`        | `/providers`                   | bearer | `?specialty=`                                                |
| `GET`        | `/providers/specialties`       | bearer |                                                              |
| `GET`        | `/appointments`                | bearer | `?scope=upcoming\|past\|all&status=&page=&limit=`            |
| `POST`       | `/appointments`                | bearer | 409 `SLOT_UNAVAILABLE` on overlap                            |
| `GET`        | `/appointments/:id`            | bearer | 404 for someone else's — not 403                             |
| `PATCH`      | `/appointments/:id/cancel`     | bearer | Frees the slot                                               |
| `PATCH`      | `/appointments/:id/reschedule` | bearer | Atomic: old slot released only if the new one is secured     |
| `GET`        | `/appointments/availability`   | bearer | `?providerId=&date=YYYY-MM-DD`                               |
| `GET`/`POST` | `/chat/sessions`               | bearer |                                                              |
| `GET`        | `/chat/sessions/:id/messages`  | bearer | Replays stored rich payloads                                 |
| `POST`       | `/chat/sessions/:id/messages`  | bearer | REST equivalent of the socket path                           |
| `GET`        | `/health` · `/ready`           | —      | Liveness; readiness also proves the DB is reachable          |

**Socket.IO** — JWT in the handshake, rooms keyed by user id.
Up: `chat:message`. Down: `chat:received`, `assistant:typing`, `assistant:delta`,
`assistant:reply`, `appointment:created`, `chat:error`.

`assistant:delta` carries the reply as the model writes it, tagged with a `turnId` so
concurrent turns cannot interleave. It is prose and nothing else — the appointment, the
doctor cards and the prefilled form arrive only with `assistant:reply`. See
**[Streaming the reply](#streaming-the-reply)**.

---

## Database

Eight tables. Full DDL with per-index rationale and performance notes in
**[db/schema.sql](db/schema.sql)**; sample inserts in **[db/seed.sql](db/seed.sql)**.

| Table                 | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `businesses`          | Tenant root — `business_id` scopes every other table        |
| `users`               | Auth + profile. Email unique **per business**, not globally |
| `providers`           | The bookable practitioner                                   |
| `appointments`        | Scheduling data + status + `source` (`chat` \| `form`)      |
| `chat_sessions`       | Conversation metadata                                       |
| `chat_messages`       | One row per turn, with the extracted/reply payload as JSONB |
| `ai_interaction_logs` | Model, tokens, latency, outcome, payloads                   |
| `refresh_tokens`      | SHA-256 hashes only                                         |

The centrepiece:

```sql
ALTER TABLE appointments
  ADD CONSTRAINT appointments_provider_no_overlap
  EXCLUDE USING gist (provider_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));
```

Chosen over a `UNIQUE(provider_id, starts_at)` index, which only catches exactly-equal start
times and would happily let a 09:15 booking overlap an existing 09:00–09:30; and over
`SELECT … FOR UPDATE`, which needs an existing row to lock when availability here is
open-ended. The `'[)'` bound means back-to-back appointments are legal while overlaps are not.
A second constraint applies the same rule per user, so nobody can be in two places at once.

Multi-tenancy (`business_id`) is included — the brief lists it as optional, but retrofitting
a tenant key onto a live schema is painful and carrying it from the start costs almost
nothing. The seed includes a second tenant specifically so a missing scope filter shows up in
testing instead of passing silently.

---

## Key decisions and tradeoffs

**Socket.IO over SSE or polling.** The brief named WebSockets or polling. Polling is wasteful
and feels laggy; SSE would fit the unidirectional shape better but is neither option named.
Socket.IO gives literal compliance plus a typing indicator and multi-tab sync. The cost is a
socket server to authenticate and shut down cleanly — handled in `socket.js`, and it is
transport only.

**Streaming decodes the model's JSON rather than animating a finished string.** The easy
version of this feature is to compute the reply, then reveal it a few characters at a time —
identical on screen, and worth nothing, since the user still waits for the whole turn before
anything appears. Streaming the real generation costs an incremental scanner
(`ai/replyStream.js`) and a provider capability flag, and gives back genuine time-to-first-word.
It also keeps the codebase honest with itself: the same reason the offline stub is labelled
degraded rather than passed off as a model is the reason it does not fake a token stream.

**Single service, one origin.** Express serves the API _and_ the built React bundle. One
deploy, no CORS, and the httpOnly refresh cookie works with `SameSite=Lax` instead of
requiring `SameSite=None` and third-party cookie permission. A split deploy is more
production-shaped but adds two failure modes to a live demo for no functional gain.

**Access token in memory, refresh token in an httpOnly cookie.** Nothing is in
`localStorage`, so an XSS bug cannot read either credential. The cost is a silent refresh on
boot and a bootstrap gate in the router so a reload does not flash a redirect to `/login`.

**Refresh rotation with replay detection.** Each refresh token is single-use. Presenting a
spent one revokes every session for that user — we cannot distinguish theft from a cloned
session, and failing closed is right for a 30-day credential. This required a
compare-and-swap on the revoke so five concurrent refreshes from one page load do not look
like an attack.

**No ORM.** Hand-written SQL in the repository layer. The most important behaviour in this
system is a PostgreSQL exclusion constraint and a range type; an ORM would abstract away
exactly the thing worth being explicit about. The tradeoff is more boilerplate in row mapping.

**`schema.sql` instead of migrations.** The brief asks for the DDL as a reviewable
deliverable. Maintaining migrations _and_ a schema file creates two sources of truth. A real
deployment would use versioned migrations — called out under limitations.

**Zod schemas shared by both sides, with no build step.** `shared/` holds plain `.js`
modules. The server imports them directly at run time and Vite bundles the same files for the
client. No workspace package, no watch task, no `dist` to go stale, and a validation rule
cannot disagree between browser and API.

**JavaScript end to end, with validation at the edges.** Both packages are plain ES modules,
so the server runs straight from source — no compile step in dev, in test, or in the
container. Correctness at the boundaries is enforced at run time instead of at compile time,
which is where it actually matters: every request body, query string and model response is
parsed through a Zod schema before any other code sees it, and the shapes that are documentation
rather than enforcement (the chat reply contract, the AI provider interface) are JSDoc typedefs
that editors still resolve.

**Tests hit a real database.** The guarantees that matter — the exclusion constraint,
rotation under concurrency — are enforced _by_ Postgres. A mocked `pg` client would let every
one of them pass while the real behaviour was broken.

---

## Assumptions and known limitations

Deliberate scope choices, not oversights.

**Product scope**

- **Bookings confirm immediately.** There is no staff role in this brief, so a `PENDING`
  appointment would have nobody to approve it. The status column models the full lifecycle
  (`PENDING`/`CONFIRMED`/`CANCELLED`/`COMPLETED`/`NO_SHOW`), so adding an approval queue is a
  service change, not a migration.
- **No doctor or admin UI.** An `admin` role exists and can read across its tenant via the
  API, but no dashboard is built. No analytics, no doctor-side availability management.
- **Availability is "open during business hours unless taken."** No per-provider working
  hours, no time off, no recurring rules. Business hours are per-tenant (`open_hour`,
  `close_hour`).
- **Signup has no role selector.** Self-signup is always a customer; the server ignores any
  `role` in the payload. Admins are seeded.
- **No email verification, password reset, reminders, or notifications.**

**Technical**

- **Single-instance rate limiting.** Counters are in-memory. Behind more than one instance
  they would need to move to Redis.
- **No pagination UI.** The API paginates properly (`page`, `limit`, `hasNextPage`); the
  appointments view requests one page, since seeded volumes do not need more.
- **`ai_interaction_logs` stores prompt and response payloads.** Useful for debugging, but it
  is user-authored text and a real deployment needs a retention policy.
- **Expired refresh tokens are not swept.** `deleteExpired()` exists but nothing schedules it.
- **Streaming is socket-only, and Mistral-only.** The REST endpoint returns the finished turn
  in one response, and the offline stub has nothing incremental to give. Both are handled: the
  client shows the working indicator and then the reply. Fragments are also fire-and-forget:
  a drop mid-turn leaves a gap in the partial text, since deltas resume on reconnect rather
  than replaying. The completed message still arrives and replaces it, so nothing is lost.
- **No CSP.** A hashless Vite bundle would need `unsafe-inline`, which would make the header
  decorative. Helmet's other headers are on.
- **The offline assistant is a keyword matcher.** It handles the demo paths well and is
  honest about what it is (the UI marks replies as degraded), but multi-turn state tracking is
  where it is weakest — it resolves the newest statement about each field and falls back to
  recent turns, which is a heuristic, not comprehension.
- **`npm audit` reports two advisories with no available fix**: a React Router RSC-mode CSRF
  issue (this is a plain SPA with no RSC and no server actions, so the affected code path does
  not exist here) and an esbuild dev-server issue that is Windows-only and dev-only. Both are
  on the latest published versions; downgrading react-router to "fix" the first would
  reintroduce fourteen older advisories.

**Environment note.** This was built on macOS 12, where Playwright cannot install its own
Chromium. `scripts/browserSmoke.mjs` therefore drives the system Google Chrome via
`channel: 'chrome'`.

---

## Testing

```bash
npm test                       # everything
npm test --workspace server    # 127 tests, integration ones against real Postgres
npm test --workspace client    # 34 component/unit tests in jsdom
```

Server tests use a separate `nudge_ai_test` database (auto-derived from `DATABASE_URL`, with a
guard that refuses to run against anything not named `*nudge_ai_test*`) and truncate between
tests. The AI provider is swapped for a stub, so they need no API key and make no network
calls.

The tests worth reading:

- **`appointmentService.test.js`** — ten concurrent bookings for one slot; exactly one wins.
  Also partial overlap, back-to-back legality, cancel-frees-the-slot, and the cross-user IDOR
  matrix.
- **`chatService.test.js`** — every way a model can misbehave (prose instead of JSON,
  truncated JSON, invented intent, invented doctor, another tenant's doctor, outage, timeout)
  and the assertion that each degrades to the form with nothing booked.
- **`authService.test.js`** — refresh rotation, replay revoking the family, and five
  concurrent refreshes yielding exactly one winner. The replay test is a regression test for a
  real bug: the family revocation originally ran inside the transaction that then threw, so the
  rollback silently undid it.
- **`socket.test.js`** — the socket enforces the same ownership and booking rules as REST, and
  neither a reply nor a streamed fragment leaks to another user's socket. The streaming cases
  assert that fragments sum to the final reply, that the JSON around it never escapes, and
  that the user's message is echoed before any of the answer to it.
- **`replyStream.test.js`** — the scanner, fed a document one character at a time and in
  chunks of every awkward size, because a network read can land between a backslash and what
  it escapes or between the halves of a surrogate pair. Also the near-misses: the word "reply"
  inside an earlier value, a nested key of the same name, `"reply": null`, and a response cut
  off mid-sentence.

**Browser smoke test.** `node scripts/browserSmoke.mjs` (with the app running) drives Chrome
through login, inline validation, the theme toggle, a conversational booking, the appointments
table, cancellation, a reload, and the mobile card layout — writing screenshots to
`.smoke-shots/` and failing on any console error. It found four real bugs during development,
including a resolver/Zod incompatibility and a timezone double-formatting defect where the
chat prose said "10:00" above a card reading "15:00".

---

## Deployment

The repo is deploy-ready but **not yet deployed** — that needs the account credentials.

**Render** (blueprint included):

1. Push the repo.
2. Render → New → Blueprint → point at this repo. `render.yaml` provisions the web service
   and a managed Postgres, and generates the JWT secrets.
3. Once live: `npm run db:setup` and `npm run db:seed` against `DATABASE_URL` (Render shell,
   or locally with the external connection string).
4. Optionally set `MISTRAL_API_KEY` in the dashboard to enable the real model.

**Docker** anywhere else:

```bash
docker build -t nudge-ai .
docker run -p 4000:4000 --env-file server/.env nudge-ai
```

Either way one service serves the API, the WebSocket, and the client from a single origin.

---

## Project layout

```
shared/            Zod schemas + constants, imported by client and server
db/                schema.sql, seed.sql
server/src/
  routes/          middleware + validation + controller wiring only
  controllers/     HTTP ↔ service translation
  services/        business rules and transactions
  repositories/    SQL and row→camelCase mapping
  ai/              provider boundary, prompts, extraction guard, date parsing
  middlewares/     requireAuth, validate, rateLimit, requestId, errorHandler
  db/              pool, transaction helper
  errors/          AppError hierarchy, pg error translation
client/src/
  pages/           one folder per screen, with its own components/ and hooks/
  components/ui/   shadcn primitives (generated)
  components/shared/  wrappers that own repeated decisions
  api/             apisauce client with single-flight 401 refresh
  hooks/           TanStack Query hooks, socket lifecycle
  context/         auth, theme, layout (sidebar open/closed)
  styles/theme.css THE design token layer — a restyle touches only this file
scripts/           browserSmoke.mjs
```

`client/src/styles/theme.css` is the single file a visual redesign touches. No feature
component hardcodes a colour, radius or font; they all read semantic tokens. Values are
currently shadcn's neutral defaults — deliberately, since the brief states branding polish is
not evaluated.

---

## Licence

MIT — see [LICENSE](LICENSE).
