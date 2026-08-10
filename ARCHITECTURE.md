# Architecture

Companion to the [README](README.md), which covers setup, the API surface, and the headline
decisions. This document is about _why the code is shaped the way it is_ — the layering rules,
where each kind of logic lives, and the reasoning behind the seams.

---

## Layering

```
routes  →  controllers  →  services  →  repositories  →  pg
```

Each layer has one job and is not allowed to do the next one's.

| Layer           | May                                                              | May not                                     |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `routes/`       | Wire middleware, validation and a controller                     | Contain logic of any kind                   |
| `controllers/`  | Read a validated request, call one service, choose a status code | Touch SQL, enforce rules, check ownership   |
| `services/`     | Enforce business rules, own transactions, compose repositories   | Know about `req`/`res` or HTTP status codes |
| `repositories/` | Run SQL, map rows to camelCase                                   | Decide policy, know who is asking           |

Two consequences worth stating explicitly, because they are what make the layering real rather
than decorative:

**Repositories are unscoped by design.** `appointmentRepository.findById()` will happily return
any appointment. That is deliberate — a repository that tried to enforce authorisation would
need to know about callers, and every method would grow an actor argument. Authorisation is the
service's job, and it happens where the record is actually loaded.

**Services never leak driver errors.** `appointmentService` catches PostgreSQL constraint
violations and rethrows them as domain errors. It has two callers — the REST controller and the
chat assistant — and the assistant needs to _handle_ a rejected booking by offering a form
rather than letting a `23P01` become a 409 response. If services leaked SQLSTATE codes, every
caller would have to understand them.

### Transactions across repositories

Every repository function takes an `Executor` first — either the pool or a checked-out
transaction client:

```ts
export interface Executor {
  query<R>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}
```

That one convention lets a service compose several repository calls atomically without any
repository knowing transactions exist:

```ts
return withTransaction(async (tx) => {
  const released = await appointmentRepository.cancel(tx, id, 'Rescheduled');
  const replacement = await appointmentRepository.create(tx, { ... });
  return replacement;
});
```

Reschedule is the case that needs it: the old slot must not be released unless the new one is
secured. If the new time is taken, the exclusion constraint aborts the transaction and the
original booking is untouched — verified by a test.

---

## Concurrency: the exclusion constraint

The single most important design decision in the system.

Booking does not ask whether a slot is free. It inserts, and lets the database refuse:

```sql
EXCLUDE USING gist (provider_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'))
```

**Why not check first?** Because check-then-insert is racy by construction. Two requests both
`SELECT` and both see "free", then both `INSERT`. No amount of application-level care fixes
this; only the database can serialise it.

**Why not `SELECT … FOR UPDATE`?** It needs an existing row to lock. Availability here is
open-ended — there is no slot table — so there is nothing to lock.

**Why not `UNIQUE (provider_id, starts_at)`?** It only catches exactly-equal start times. A
09:15 booking overlapping an existing 09:00–09:30 would sail through.

The `WHERE` clause is what makes cancellation work: only `PENDING` and `CONFIRMED` occupy a
slot, so cancelling frees the time immediately with no row deletion and no tombstone flag, and
history is preserved.

A violation surfaces as SQLSTATE `23P01`, which `errors/pgErrors.js` translates to **409
`SLOT_UNAVAILABLE`**. A second constraint applies the same rule per `user_id`, so one person
cannot hold two overlapping appointments with different doctors.

The cost is real and worth naming: a GiST index to maintain, and writes for the same provider
serialise against each other. That is the correct trade — correctness over throughput — and
contention is per-provider, not global.

---

## The AI boundary

```
chatService  ──►  ai/extraction.js  ──►  AiProvider  ──►  Mistral | stub
   decides            validates            returns text
```

`AiProvider` is deliberately tiny:

```js
/**
 * @typedef {object} AiProvider
 * @property {'mistral' | 'stub'} name
 * @property {boolean} isDeterministic
 * @property {boolean} supportsStreaming
 * @property {(request: CompletionRequest) => Promise<CompletionResult>} complete
 */
```

A provider turns a prompt into text. It cannot read the database, book anything, or decide
anything. Everything above the boundary is unaware of which model is in use, or whether one is.

**`extraction.js` is the guard.** It parses the response (recovering JSON from a markdown fence
if the model added one), validates it against `aiExtractionSchema`, and returns a discriminated
result. There is no path by which unvalidated model output reaches business logic. It never
throws: an outage, a timeout, or unusable output all return `ok: false`, and the caller responds
with the structured form. An assistant that 500s because a third-party API had a bad minute
would be a worse product than one that hands you a form.

**`chatService` decides what an extraction means.** It resolves the model's free-text
`"Dr. Okafor"` / `"Dermatology"` against real provider rows. This is where hallucination stops
being dangerous — an invented name simply fails to match. Ambiguity is reported rather than
guessed at, because silently picking one of three matching doctors is worse than asking.

**Booking goes through `appointmentService`.** The assistant cannot book anything a direct API
call could not: business hours, past dates, inactive providers and double-booking are all
enforced in one place regardless of which surface initiated it.

### The intents are the questions, not the phrasing

`list`, `providers` and `availability` are three separate intents because they are three
separate questions that happen to sound alike. All of "list my appointments", "list all the
doctors" and "list what's free on Thursday" are list-shaped, and when one intent covered them
the server answered every one of them from the caller's own appointments — so asking about the
clinic's doctors returned "you have no upcoming appointments". A true sentence, and a non-answer.

The taxonomy is the fix, but the reason it is safe is that the model only ever classifies. It
does not fetch: doctors come from provider rows and free slots from `getAvailability`, which
generates them from business hours minus real bookings. The prompt forbids the model from
naming a free time in its own words for exactly this reason — the sentence is its work, the
times underneath it are not.

`availability` also refuses one inheritance the booking flow allows. A day is the _subject_ of
an availability question, so the draft's date is dropped before the merge: asked "and what
about Friday?", Mistral names Friday in its prose and leaves the field null, and inheriting
Thursday there would show real times for a day nobody asked about, under a sentence naming
another one. Asking which day costs a turn; the alternative is confidently wrong.

### Conversation state lives in the session, not the model

Replaying the transcript is not the same as remembering. A model reads a turn at a time, and one
that is asked to re-derive a whole booking from ten turns of chat will eventually drop a field
and ask for it twice — which reads, to the person typing, as an assistant that was not listening.

So the booking under discussion is a server fact. `findBookingDraft` reads it from the last reply
the user was actually shown, which is already persisted so conversations can be replayed; deriving
it rather than storing it separately means there is no second copy to fall out of step. Two rules
make it correct, and both were bugs first:

- **A completed booking ends the draft.** Otherwise the details of the appointment just made are
  still lying around, and the next vague message books it again.
- **A field the reply listed in `missing` is dropped.** When `book` is refused, the fallback
  prefills the time that failed — so the person can see and amend it — but names it missing. That
  one line is what makes a taken 10:00 forget the time and keep the doctor.

The draft is used on both sides of the model. The prompt states it, so the assistant stops asking
for what it has and can act on a bare "yes". `mergeDraft` folds it back under the returned fields,
so a turn that forgets the doctor still books with them. The current turn always wins — that is
what makes "actually, make it Thursday" work, and why the merge only ever fills nulls. Its one
exception is a changed specialty retiring the doctor chosen under the old one, which is the
difference between a clumsy question and a wrong booking.

None of this is trust. The merged fields are still resolved against real provider rows and still
booked through `appointmentService`; the draft can only ever re-supply a value the user themselves
gave earlier in the same session.

### Why the offline provider exists

Selected automatically when `MISTRAL_API_KEY` is absent. It matters for three reasons:

1. **The app always runs.** A reviewer with no key gets a working demo, not an error.
2. **The test suite needs no key, no network, and costs nothing** — while still exercising the
   real validation, resolution and booking path, because the stub emits the _same JSON
   contract_ as the model.
3. **It is honest.** `isDeterministic: true` propagates to `reply.degraded`, and the UI says so
   rather than passing a keyword matcher off as a language model.

Its known weakness is language, and it is not a weakness worth fixing. It matches keywords, so a
plural it was not taught ("appointments"), a question it has no rule for ("any other doctors?"),
and a bare "sure" all fall through to "could you rephrase that?" — the difference between a
regex and a model, showing exactly where you would expect it. `reply.degraded` says so in the UI.
Multi-turn state is the one part it does not have to get right on its own: the session's booking
draft is merged in above the provider boundary, so the stub inherits it like the model does. The
`lastReplyKind` signal is still passed to it directly, because a completed booking has to stop its
own history scan from re-attempting the same slot, and it cannot read the prose that would say so.

### Prompt injection

Doctor bios, specialty names and appointment notes all flow into the model's context and are
attacker-influenceable. The mitigation is structural rather than textual:

- **Identity never comes from the model.** `req.auth` is populated only by `requireAuth` from a
  verified token. `user_id` is not a model-supplied field anywhere.
- **Model output grants no authority.** The worst it can do is name a doctor or a time, both of
  which are re-validated against the database.
- **Destructive actions are not model-triggered.** A `cancel` intent only ever _lists_
  appointments. Cancelling requires a click on a specific record, hitting the ordinary REST
  endpoint with its own ownership check. There is a test that feeds the model a full
  "cancel everything" instruction and asserts nothing changes.

---

## Authentication

**Access token** — short-lived signed JWT, held in the API client's memory. Stateless, so
authenticating a request costs no database round trip for the token itself.

**Refresh token** — long-lived opaque random string, _not_ a JWT, stored server-side as a
SHA-256 hash and delivered as an httpOnly cookie. A JWT here would be unrevocable, which is
exactly the property you do not want on a 30-day credential. Only the hash is stored, so a
database leak yields no usable sessions.

Nothing is in `localStorage`. The cost is that a page reload has no token in memory, so
`AuthProvider` attempts a silent refresh on boot and the router waits behind an
`isBootstrapping` gate — without it, every refresh would flash a redirect to `/login`.

### Rotation and replay detection

Each refresh token is single-use. Presenting a spent one revokes **every** session for that
user: we cannot distinguish a stolen token from a cloned session, and failing closed is correct
for a long-lived credential.

Two subtleties, both learned from bugs:

**The family revocation must commit.** Originally it ran inside the transaction that then threw
the 401 — so the rollback silently undid the revocation, and the token that was supposed to be
killed kept working. It now runs on the pool, outside any transaction that might roll back.
There is a regression test.

**Rotation is a compare-and-swap.** `revokeById` returns a row count and guards on
`revoked_at IS NULL`. Only the request that actually flips the row may mint a new pair; a
concurrent duplicate gets zero rows and is treated as a replay. Without this, five queries
firing on one page load with an expired token would look like an attack — which is also why the
client's refresh is single-flight.

### Per-request database check

`requireAuth` verifies the JWT _and_ loads the user, checking `is_active` and `token_version`.
A stateless check alone would keep working for up to the full token lifetime after an account
is deactivated or its password changed. One primary-key lookup buys immediate revocation. At
high throughput this is the thing to cache with a short TTL — not to remove.

---

## The client

**State ownership** is split deliberately:

| Kind                                | Where                           | Why                                                                                                                                       |
| ----------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Server data                         | TanStack Query                  | Caching, retries, invalidation                                                                                                            |
| Auth + theme                        | Context                         | Genuinely global, changes rarely                                                                                                          |
| Chat messages                       | Local state in `useChatSession` | Arrive by push, append-only — a request/response cache would be fighting the transport                                                    |
| Filters, which conversation is open | URL query params                | Survives refresh, shareable as a link — and lets the sidebar switch threads by navigation rather than reaching into the chat page's state |

**Invalidation is the mechanism that keeps views consistent.** A booking made in the chat
invalidates `queryKeys.appointments.all`, and the appointments page refetches — neither knows
the other exists. Keys come from a factory rather than inline literals, because hand-written
arrays drift and the symptom is a stale screen after a successful action, which reads as a bug
in the action.

**Booking is deliberately not optimistic.** It can be refused by the database, and showing a
confirmed appointment that then vanishes is worse than a brief spinner — especially for
something a person will plan their day around. Optimistic updates are right for cheap,
reversible, always-succeeding actions; this is none of those.

**The API client owns auth recovery.** `request()` retries once through a single-flight refresh
on `TOKEN_EXPIRED`. Nothing else in the client thinks about tokens.

**The socket is additive.** `useChatSession` prefers it and falls back to the REST endpoint when
disconnected. The server treats both identically, so a dropped WebSocket degrades the
experience without breaking it — and the connection state is shown rather than hidden.

### Theme tokens

`client/src/styles/theme.css` is the only file a redesign touches. No feature component
hardcodes a colour, radius or font. Appointment statuses have semantic tokens
(`--status-confirmed`, …) and always render an icon and a text label alongside the colour, so
status is never communicated by colour alone.

Tailwind v4 has no JS config, so the tokens are CSS custom properties exposed to utilities via
`@theme inline`, and dark mode is a `@custom-variant` on a class (not a media query) because the
theme is user-togglable. The no-flash-on-reload problem is solved by a small inline script in
`index.html` that applies the stored class before the bundle loads.

`next-themes` — which shadcn's generated `sonner.jsx` reaches for by default — was removed. This
is a Vite SPA with no Next.js, the team standard is Context for global state, and the whole
behaviour is about thirty lines.

---

## Shared contracts

`shared/` holds Zod schemas and domain constants as plain `.js` modules, imported by both
packages. The server imports them directly at run time; Vite bundles the same files for the
client. `shared/chat.js` is the exception — it carries no runtime value, only the JSDoc typedefs
that document the chat reply contract both sides agree on.

No workspace package, no build step, no `dist` to go stale — and, more importantly, no way for a
validation rule to disagree between the browser and the API. `loginSchema` lower-cases and trims
the email in the browser _and_ on the server because it is one schema. The client test asserts
the error message a user sees comes from that shared file.

The alternative was a fourth workspace package with its own build, which for a handful of small
schemas would have been more pipeline than value. The tradeoff is that `shared/` must stay free
of runtime dependencies beyond Zod — anything Node-specific in there would break the client
bundle.

---

## Error handling

One `AppError` hierarchy. Services throw; a single middleware turns them into responses. Route
handlers have no `try`/`catch` — Express 5 forwards rejected promises automatically.

`pgErrors.js` translates constraint violations by **explicit constraint name**, not by pattern.
If a constraint is renamed, translation returns `null` and the request 500s loudly, which is far
preferable to silently reporting the wrong reason.

4xx logs at `warn` (client behaviour); 5xx logs at `error` with the stack (our problem). The
client sees a code, a message, and a request id — never a stack trace or a SQL fragment.

Two error-message choices worth flagging:

- **Login is identical for a wrong password and an unknown email**, and burns comparable CPU in
  both cases. Without the artificial work, "unknown email" returns in about a millisecond while
  "wrong password" takes ~250ms, and that timing gap alone tells an attacker which addresses are
  registered — defeating the point of the vague message.
- **Another user's record is 404, not 403.** Confirming "this exists but is not yours" leaks
  that the id is real.

---

## What I would do next

In rough order of value:

1. **Versioned migrations** replacing `schema.sql`.
2. **Redis** for rate limiting and the `requireAuth` user lookup, so more than one instance
   behaves correctly.
3. **Per-provider working hours and time off**, which is the first thing real scheduling needs.
4. **Retention policy on `ai_interaction_logs`**, plus partitioning it and `chat_messages` by
   month once they grow.
5. **An approval workflow** — the status model already supports it.
6. **Streaming on the REST path too.** It is socket-only today; see
   [Streaming the reply](README.md#streaming-the-reply) for how the socket path works.

Streaming replies used to head this list. It is now implemented over the socket — the entry
above is the remaining half.
