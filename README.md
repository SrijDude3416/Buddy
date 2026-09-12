# Buddy

Amazon doesn't ask what you want — it does math on what you've done and hands you
something personalized. Buddy does that for a student's semester: classes, deadlines,
and how you actually like to work go in, and a real optimizer (Google OR-Tools'
CP-SAT solver) places every study session around your fixed class times, reporting
how close to provably optimal it got instead of just guessing at a schedule.

The AI layer never touches the schedule directly. Chat feedback ("keep Friday nights
free," "I do better in the evening") is translated by OpenAI into typed preference
calls from a fixed, validated catalog — never raw event edits — and a deterministic
Python compiler turns each one into a CP-SAT constraint or objective term. The model
translates what you want into math; the solver decides when things actually happen.
That boundary is what makes "AI optimizes the math for you" true rather than a slogan,
and it's enforced in code, not just policy — see [CLAUDE.md](CLAUDE.md) for the
non-negotiable principles this project holds itself to.

## Run

Use Node.js 20.9+ and Python 3.11+ with an OR-Tools wheel available for your platform.
From the repository root:

```bash
npm run setup        # on Windows: npm run setup:win
cp buddy/.env.example buddy/.env.local  # only if you do not already have this file
# Add OPENAI_API_KEY to buddy/.env.local
npm run dev -- --port 3100
```

`setup` and `setup:win` are the same steps written for each platform's virtualenv
layout — `bin/python` and `python3` on macOS/Linux, `Scripts\python.exe` and the `py`
launcher on Windows. Everything after setup (`dev`, `start`, `test:e2e`) detects the
platform itself and is the same command everywhere.

Open http://localhost:3100. The root command starts Next.js and the Python API on
port 8000. `BUDDY_PYTHON` can select an existing virtualenv Python. To use an already
running optimizer, set `FASTAPI_BASE_URL` in the shell before running the command.
The Next.js server also reads that URL from `buddy/.env.local`.

For a production local demo: `npm run build`, then `npm start -- --port 3100`.
The opening screen offers **Get started** and **Demo**, with no authentication.
Get started uses MongoDB and reports an error if live data cannot be loaded.
Demo uses `test-data/schedule_test_data.json` and never reads or writes MongoDB.

Configure `MONGODB_URI` and `MONGODB_DB` in `backend/.env.local` for live planner
data, plus the schedule catalog settings below in `buddy/.env.local`.
The public planner uses the existing shared Mongo dataset (`demo-carlos` by default);
set `BUDDY_MONGODB_USER_ID` in the Python service environment to select another
existing dataset. Google credentials and SESSION_SECRET are not needed.

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
`preference_pipeline.py`). Get started uses the shared MongoDB dataset; Demo stays entirely file-backed.

See `backend/optimizer/mongo_loader.py` / `seed_mongo.py` (courses/tasks) and
`mongo_state.py` (preferences/optimizer_runs) for the field mapping and exactly
what is (and isn't) read from/written to Mongo.

### The class catalog cluster

The class list in onboarding's **Customize** picker comes from a `schedule`
collection in a **separate** Atlas account from the one above — one document per
class, carrying `course_id`, `course_title`, and `lecture`/`recitation` arrays of
sections (`subcategory`, `days`, `begin_time`, `end_time`, building, room,
instructors). It has its own variables in `buddy/.env.local` (template in
`buddy/.env.example`) precisely so it can never be confused with `MONGODB_URI`:

```
SCHEDULE_MONGODB_URI=
SCHEDULE_MONGODB_DB=
SCHEDULE_MONGODB_COLLECTION=schedule
```

Check the connection before touching the UI:

```bash
node --env-file=buddy/.env.local buddy/scripts/check-schedule.mjs
```

The same Network Access caveat from step 2 above applies. If the cluster isn't
configured or isn't reachable, `GET /api/courses` serves the built-in list from
`test-data/schedule_test_data.json` instead — but says so, in the response's
`source` field, in a server log line, and in a note under the picker itself. The
demo never goes down over this, and it never silently pretends either.

### Sections, and how class times reach the calendar

Roughly a third of the catalog's courses offer more than one lecture or recitation,
so the class question asks which section is yours — inline, as part of picking the
class, not as a sixth onboarding question. A course with exactly one option is
resolved silently; Continue waits only on genuine forks.

The picked sections' meeting times travel to the optimizer as `courses` on
`POST /preferences/operations` (`preference_pipeline.CourseOverride`), which is new:
the solver previously only knew the courses it loaded at startup and rejected any
other id. They come back on `plan.courses[].meeting_times`, which is what lets a
chat-driven re-solve hand the same course straight back instead of losing its class
blocks. Sections are resolved from Mongo server-side — the browser only ever sends
section ids, so it can't inject arbitrary blocks into a solve.

Two deliberate limits:

- **These courses have no assignment data**, so a plan built from them shows your
  real timetable and no study sessions. That's stated rather than papered over with
  invented coursework.
- **Doha sections are filtered out.** The catalog covers every CMU campus, and a
  Qatar section's Sun–Thu week describes a different student's semester.

Picking two classes that meet at the same hour returns a 400 naming both. That
would otherwise reach CP-SAT as two immovable overlapping intervals and come back
as a bare `INFEASIBLE` for the whole schedule — see the note in `scheduler.py`
about why a routine block now yields to a class.

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
cannot leave a half-applied preference update. Demo's preferences travel with the
browser's plan and are never written to Mongo — every demo session starts from the
exact same seeded set, on purpose (see `backend/optimizer/mongo_state.py`'s
`demo_default_preferences()`). Get started's preferences persist to MongoDB per
account. Initial task/course data comes from `test-data/schedule_test_data.json`
(demo) or the account's own Mongo data (Get started), filtered only by selected
courses. The starting plan is computed by CP-SAT and cached for reset; every chat
tool batch runs a new solve. Generated lecture reviews are included, and unscheduled
blocks are disclosed.

Thirteen tools, not one bare "move this event" — `preference_pipeline.py`'s full
catalog, spec'd in [PREFERENCE_API.md](PREFERENCE_API.md): preferred work hours,
daily workload limits, protected time blocks, break habits, task spacing, urgency
emphasis, minimum session gaps, meal windows (a bounded range CP-SAT places freely,
not a fixed time), personal commitments (gym, club meetings — lockable to an exact
time or left as a movable window), adding or removing a real assignment (with an
optional exact session-by-session breakdown, e.g. "two 2-hour sessions then a
30-minute review"), removing a preference, and listing what's active. OpenAI never
selects event times, even when asked to add a task — it supplies the facts (course,
deadline, how much work), CP-SAT still decides every session's placement.
Unsupported or ambiguous requests get an explanation or clarification without a
calendar change. Soft preferences may lose tradeoffs against other objectives;
protected blocks and locked commitments are hard constraints on flexible work.
Lectures stay fixed.

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
