# Buddy

Buddy translates student feedback into preference API calls, rebuilds a schedule
with the existing Python CP-SAT optimizer, and renders its result in React.
The integrated demo lives on `merged` (the repository's lowercase branch name).

## Run

Use Node.js 20.9+ and Python 3.11+ with an OR-Tools wheel available for your platform.
From the repository root:

```bash
npm run setup
cp buddy/.env.example buddy/.env.local  # only if you do not already have this file
# Add OPENAI_API_KEY to buddy/.env.local
npm run dev -- --port 3100
```

Open http://localhost:3100. The root command starts Next.js and the Python API on
port 8000. `BUDDY_PYTHON` can select an existing virtualenv Python. To use an already
running optimizer, set `FASTAPI_BASE_URL` in the shell before running the command.
The Next.js server also reads that URL from `buddy/.env.local`.

For a production local demo: `npm run build`, then `npm start -- --port 3100`.
Canvas is still not required, and sign-in is optional for the demo (see
"Sign in with CMU" below). MongoDB now **is** used when reachable,
for two different things:
- Courses/tasks: the Python optimizer reads these from the real Atlas cluster
  (credentials in `backend/.env.local` — see "MongoDB" below) instead of the
  static `test-data/schedule_test_data.json`.
- Preferences and run history: every chat-triggered solve saves the resulting
  preference set (`preferences` collection) and logs a durable record of the
  solve itself (`optimizer_runs` — CLAUDE.md's "why" log: objective, best
  bound, gap, solve time, what was asked for). A fresh server start or a
  brand-new browser tab restores your last-saved preferences instead of
  resetting to the generic 8am-5pm default.

If Mongo isn't configured, isn't seeded, or the client's IP isn't in Atlas's
Network Access list, both fall back automatically — courses/tasks to the
static file, preferences to that same generic default — loudly, not silently
(check the Python process's startup log for which one it picked each time).
A Mongo write failing never fails the chat request it's attached to; it only
means that particular change doesn't survive a restart. An OpenAI key and the
Python service are required for chat; there is one interpreter and one
scheduling engine, with no simulated fallback.

## MongoDB

Course/task data now lives in the same Atlas cluster `backend/`'s Next.js app
already uses. One-time setup:

1. Confirm `backend/.env.local` has a working `MONGODB_URI`/`MONGODB_DB` (copy
   from `backend/.env.example` if you don't have this file — see `backend/README.md`
   for how to get a connection string).
2. Make sure your current IP is in Atlas's **Network Access** list (Atlas UI →
   Network Access → Add IP Address) — Mongo drivers fail this as a TLS handshake
   error (`TLSV1_ALERT_INTERNAL_ERROR`), not a clean "unauthorized," which reads
   confusingly like a code bug the first time you hit it. It isn't one.
3. Seed Carlos's real test data once per cluster:
   ```bash
   cd backend/optimizer && source .venv/bin/activate && python seed_mongo.py
   ```
   Safe to re-run any time `test-data/schedule_test_data.json` changes — every
   write is an upsert. `--wipe` clears this project's seeded docs first (tagged
   `seed_source: "carlos_test_data"`, so it never touches `backend/lib/catalog.js`'s
   own unrelated synthetic course catalog living in the same `courses` collection).

No seeding step needed for preferences/run history — those write themselves the
first time you use the demo (`backend/optimizer/mongo_state.py`, wired into
`preference_pipeline.py`). There is one implicit demo user (`"demo-carlos"`,
same as the seeded courses/tasks): sign-in gates who reaches the app, but the
optimizer's own state is not yet keyed per account — a real per-account version
keys these by a real `user_id` instead.

See `backend/optimizer/mongo_loader.py` / `seed_mongo.py` (courses/tasks) and
`mongo_state.py` (preferences/optimizer_runs) for the field mapping and exactly
what is (and isn't) read from/written to Mongo.

## Sign in with CMU (Google OAuth)

CMU Andrew accounts are Google Workspace accounts, so Google OAuth restricted to
the `andrew.cmu.edu` hosted domain authenticates against CMU's own directory. No
CMU service-provider registration, and Buddy never sees a password.

Sign-in has three modes, decided by `buddy/lib/auth/env.ts`:

| Google credentials | `NODE_ENV` | Mode | Behaviour |
|---|---|---|---|
| set | any | `oauth` | Real gate. Only allowed domains get in. |
| missing | development | `demo` | Zero-config walkthrough: one fixed demo student, no login. |
| missing | production | `unconfigured` | **Fails closed.** Sign-in screen explains what is missing. |

`BUDDY_ALLOW_DEMO=1` forces `demo` even with credentials set — used by the
Playwright suite and for demoing offline. The production row is the important
one: a deploy that loses its env vars must not silently sign everyone in.

To turn on real sign-in, fill these into `buddy/.env.local` (all documented in
`buddy/.env.example`):

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=$(openssl rand -base64 48)
OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
ALLOWED_EMAIL_DOMAINS=andrew.cmu.edu,cmu.edu
```

In Google Cloud Console → Credentials → OAuth client ID (Web), the **Authorized
redirect URI must match `OAUTH_REDIRECT_URI` character for character**, port
included. That mismatch is the single most common failure — if you run the demo
on `--port 3100`, register `http://localhost:3100/api/auth/google/callback` too.

`MONGODB_URI` is optional. With it, sign-in upserts SCHEMA.md's `users` document
(keyed on the Google `sub`, never the email) and the session route reads through
to it, so deleting an account immediately invalidates its cookie. Without it the
signed cookie is the whole user record — fine for a demo, and the tradeoffs are
spelled out at the top of `buddy/lib/auth/users.ts`.

## Try it

1. Confirm the default preferences or customize your selected courses and focus hours.
2. View the September 12–25, 2026 demo calendar.
3. Open **Ask Buddy** and try “I prefer studying in the evening.”
4. Try “Keep Friday 7 PM to midnight free” or “Limit Sunday study time to 90 minutes.”
5. Expand the preference API calls in the reply and inspect the rebuilt calendar.
   Undo restores both the previous calendar and its preferences.

Chat acknowledges feedback immediately, shows the interpreted preference change,
then displays the optimizer stage and elapsed time. You can draft the next message
or stop the request. Only a successful final result replaces the calendar. A stopped
Python solve may finish in the background, but its result is discarded. There is
no live percent-complete; the final solver status and objective bound gap are real
CP-SAT metadata. The gap is not a percentage of student satisfaction.

## Integration

```text
React chat → Next.js /api/chat/messages
  → one OpenAI wrapper selects tools from backend/optimizer/tool_schemas.json
  → Python /preferences/operations applies the existing /tools handlers
  → scheduler.build_and_solve runs CP-SAT once with the updated preferences
  → complete solver plan returned to React
```

The batch endpoint uses an isolated PreferenceStore so an error or cancelled request
cannot leave a half-applied preference update. Current preferences travel with the
browser's plan; there is no persistence. Initial data comes from the full original
`test-data/schedule_test_data.json`, filtered only by selected courses. The starting
plan is computed by CP-SAT and cached for reset; every chat tool batch runs a new
solve. Generated lecture reviews are included, and unscheduled blocks are disclosed.

OpenAI can set preferred hours, daily workload limits, protected time blocks, break
habits, remove a preference, or list preferences. It does not select event times.
Unsupported or ambiguous requests get an explanation or clarification without a
calendar change. Exact block lengths, quiz-specific priorities, and commitment
hours are not implemented by the existing preference tools. Soft preferences may
lose tradeoffs against other objectives; protected blocks are hard constraints on
flexible work. Lectures stay fixed.

## Checks

```bash
npm test
npm run build
cd buddy && npx playwright install chromium && cd ..
npm run test:e2e
```

Browser tests run the actual Python optimizer and a test-only HTTP fixture for the
OpenAI service. They exercise the same SDK and production wrapper, including the
streamed stages, calendar replacement, undo, errors, and cancellation. Live OpenAI
verification needs a valid key and quota.

## Hosting

On Vercel, select root directory `buddy` and enable source files outside that root.
Use the Next.js preset. Set server-only `OPENAI_API_KEY`, `OPENAI_MODEL`, and
`FASTAPI_BASE_URL` pointing to a separately hosted Python service. Vercel does not
run this local Python process automatically. Allow enough function runtime for
OpenAI plus the bounded CP-SAT solve (routes request up to 180 seconds).

The original MongoDB API and standalone Vite mock app are retained as historical
components; this demo's entry point is Next.js. See [buddy/PIPELINE.md](buddy/PIPELINE.md)
for the active contract and [PREFERENCE_API.md](PREFERENCE_API.md) for tool semantics.
