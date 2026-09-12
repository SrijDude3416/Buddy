# Preference API — the AI-facing interface to the scheduler

**Audience note, read this before anything else below:** this document is written for
whatever has tool-calling access to this system and *no other context* — no access to
`backend/optimizer/`'s source, no memory of how these numbers were arrived at, none of
the trial and error that produced them. If you are a model reading this as part of a
tool declaration, or an engineer wiring one up, everything you need should be on this
page. Where something is a rule rather than a suggestion, it's written as one.

Companion file: [`backend/optimizer/tool_schemas.json`](backend/optimizer/tool_schemas.json)
is the paste-ready version of every tool below, as standard JSON-Schema function
declarations (Gemini/OpenAI/Claude-compatible). The two are meant to stay in sync by
hand; this document is the *why*, that file is the *exact contract*.

**Status key used throughout this doc:** 🟢 implemented & tested against real data ·
🟡 specified here, not yet built — safe to build against, the eventual implementation
is committing to this shape · 🔴 designed but no contract exists yet, don't build
against it.

---

## 1. The mental model, in one paragraph

A student's calendar is produced by a CP-SAT solver (Google OR-Tools), not by a
language model. The model never edits the schedule and never touches solver code —
every tool call below does exactly one thing: it produces one typed
`{type, value, weight}` preference object, which a fixed, deterministic Python
compiler (never the model) turns into either a hard rule or a weighted term the solver
optimizes against. A chat message can trigger zero, one, or several tool calls, each
landing in the `preferences` collection. **A re-solve is meant to follow automatically
— as a backend-owned side effect of the write, not as something the model asks for —
but that orchestration doesn't exist yet.** §2 specifies the one piece of it that does:
the actual function that runs a solve, and the contract its HTTP wrapper will expose.
You (the model) never trigger a re-solve directly either way — see §2's design note
for why that's deliberate. If a request can't be expressed by any tool in §5, say so
to the student rather than approximating it with the closest one.

## 2. 🟢 The optimizer service contract — what actually runs a solve

This section didn't exist in the first version of this document, which said "a
re-solve runs automatically" as if the machinery for that were real. It wasn't yet —
**it is now.** [`backend/optimizer/api.py`](backend/optimizer/api.py) is a real,
running FastAPI service implementing everything below (plus
[`api_models.py`](backend/optimizer/api_models.py) for the request/response shapes and
[`preferences_store.py`](backend/optimizer/preferences_store.py) for §4's
singleton/accumulating persistence). It's still test-data only — no live database, one
implicit student, in-memory state that resets on restart — so treat "🟢 implemented" as
"implemented and verified against `test-data/schedule_test_data.json`," not "wired to
production data." See `backend/optimizer/README.md` for how to run it and a full curl
walkthrough.

### 🟢 What's real: `build_and_solve()`

The entire optimizer is one Python function,
[`backend/optimizer/scheduler.py`](backend/optimizer/scheduler.py):

```python
def build_and_solve(
    data: ScheduleData,           # .courses: dict[str, Course], .tasks: list[Task]
    window_start: datetime,       # tz-aware; the rolling window's first moment
    window_days: int,             # 14 in every test run this project has done so far
    preferences: list[Preference] = (),      # {type, value, weight, source} — §5/§6
    personal_blocks: list[MeetingTime] = (), # gym/meals/etc — same shape as course meeting_times
    now_slot: int = 0,            # internal-only; always 0 today, not exposed over HTTP
    max_time_in_seconds: float = 15.0,
) -> SolveResult:
    ...
```

`api.py` calls this directly — for `POST /solve` it's a straight pass-through of the
request body; for the tools and `GET /plan` it's called with the one test
student's current `PreferenceStore` contents plus `ALWAYS_ON_DEFAULTS` (§6, now empty
-- see there for why). `api.py`'s course/task data now prefers the real Atlas cluster
(`data_loader.load_data_preferring_mongo()`), falling back to
`test-data/schedule_test_data.json` only if Mongo isn't reachable -- but `api.py`'s
own bare `PreferenceStore` (as opposed to `preference_pipeline.py`'s separate,
Mongo-backed one buddy/'s live demo actually uses) is still purely in-memory, and
that's still the entire "student" it knows
about.

### 🟢 The design decision this implies: who's allowed to trigger a solve

Not the model. A tool that says "now go solve it" would mean Gemini has to *remember*
to call it, and has to *know when* a re-solve is warranted — neither is Gemini's job.
The backend already knows the answer to "when": right after any write to
`preferences`, from *any* source (chat, onboarding, a manual edit, anything). Keeping
this a backend-owned side effect, not a tool, is both simpler and a stricter reading
of CLAUDE.md's rule that the AI only ever touches preferences — it doesn't even
indirectly touch the solve trigger.

Concretely, this means **two separate layers**, and this doc only specifies one of
them:

- **User-facing / Next.js** (already speced, elsewhere, not by me): `POST
  /optimizer/runs` → poll `GET /optimizer/runs/:id` for `{status, stage, progress}` →
  `GET /plan` once solved. This is `frontend/src/lib/endpoints.js` and
  `frontend/src/hooks/useOptimizerRun.js` — already built, including the loading
  screen. Whoever implements `/optimizer/runs` is responsible for the async/poll
  mechanics (job tracking, however that's done) and for calling the layer below.
- **Service-to-service / this doc, §2 below**: what Next.js actually calls internally
  to get a solve done. Synchronous — see why below.

### 🟢 `POST /solve` — implemented, matching the contract below exactly

The path itself is still a proposal as far as the eventual *production* service goes
(coordinate with whoever builds the Next.js side before treating `/solve` as final
there) — but `api.py`'s implementation matches every field below precisely, verified
by actually running requests against it, not just by reading the code.

**Synchronous, not async.** A solve takes 10-20 seconds (see
`backend/optimizer/README.md`'s "Round 4" for the actual measured numbers — this
isn't a guess). That's a bad shape for a browser request, which is exactly why
`/optimizer/runs` above exists as an async wrapper — but *this* endpoint is
service-to-service, called from a Next.js server that's already decided to make the
caller wait (or already isn't the browser). Duplicating the async/poll pattern at this
layer too would mean two job-tracking systems for one wait. If solves get meaningfully
slower later, this is the first thing to revisit — not before.

**Request body** — every field maps directly onto `build_and_solve()`'s real
parameters and the real dataclasses in `data_loader.py`/`decompose.py`:

```jsonc
{
  "window_start": "2026-09-12T00:00:00-04:00",  // ISO 8601, tz-aware, required
  "window_days": 14,                             // required
  "max_time_in_seconds": 15,                     // optional, default 15 — see the
                                                  // solve-time table in README.md
                                                  // before lowering this
  "courses": [
    {
      "id": "matrices",
      "name": "21241 Matrices",   // leading digits parsed into the "21-241" shown in
                                   // session titles (data_loader.format_course_code) —
                                   // a name that doesn't start with a course number
                                   // just means titles skip the code prefix, not an error
      "meeting_times": [
        { "days": ["Mon", "Wed", "Fri"], "start_time": "09:00", "end_time": "09:50", "location": "HOA-160" }
      ]
    }
  ],
  "tasks": [
    {
      "id": "mx-hw3",
      "course_id": "matrices",       // must match a courses[].id
      "title": "Weekly HW 3",
      "due_at": "2026-09-16T23:59:00-04:00",  // ISO 8601, tz-aware
      "est_duration_min": 120,
      "splittable": true,
      "status": "not_started"        // "not_started" | "in_progress" | "done" —
                                      // "done" tasks are skipped entirely, not solved around
    }
  ],
  "personal_blocks": [
    // same shape as courses[].meeting_times, no course attached. `location` doubles
    // as the block's display label (e.g. "Gym", "Dinner") -- a real quirk of the
    // current code, not a mistake in this spec.
    { "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start_time": "12:00", "end_time": "12:45", "location": "Lunch" }
  ],
  "preferences": [
    // exactly the objects §5's tools produce -- {type, value, weight, source}.
    // "source" is informational only (compile_all() never reads it); keep it for
    // traceability back to which chat message or onboarding answer produced this.
    { "type": "daily_load_cap", "value": { "minutes": 240 }, "weight": 15, "source": "onboarding" }
  ]
}
```

**Response body** — every field maps directly onto `SolveResult`/`PlacedBlock`:

```jsonc
{
  "status": "FEASIBLE",             // "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" --
                                     // OR-Tools' own status names, passed through as-is
  "objective_value": 349999972.0,
  "best_bound": 349999987.0,
  "gap_pct": 0.0000043,             // (best_bound - objective_value) / objective_value --
                                     // THIS DIRECTION MATTERS. It was implemented backwards
                                     // once already (see README.md's "Gap-percentage sign
                                     // bug") and silently showed >100% "optimized" on any
                                     // run that didn't finish OPTIMAL. Get this exactly
                                     // right, don't rederive it from memory.
  "solve_seconds": 10.24,
  "placed": [
    {
      "id": "fixed_matrices_2_09:00", "task_id": null, "course_id": "matrices",
      "title": "21241 Matrices", "kind": "fixed",
      "start": "2026-09-14T09:00:00-04:00", "end": "2026-09-14T09:50:00-04:00"
    },
    {
      "id": "mx-hw3__s1", "task_id": "mx-hw3", "course_id": "matrices",
      "title": "21-241 Work on Weekly HW 3", "kind": "flexible",
      "start": "2026-09-12T17:00:00-04:00", "end": "2026-09-12T19:00:00-04:00"
    }
  ],
  "unplaced": [
    {
      "id": "...", "task_id": "...", "course_id": "...", "title": "...",
      "kind": "out_of_window", "start": null, "end": null
    }
  ]
}
```

`kind` (on both `placed` and `unplaced` entries) is one of exactly five values —
this is the real, complete enum, not a subset:

| `kind` | Meaning |
|---|---|
| `fixed` | An immovable block — a class meeting or a personal-routine block. Never has a `task_id`. |
| `flexible` | Optimizer-placed work, tied to a real task. Only appears in `placed`. |
| `unplaced` | Was eligible to be scheduled this window and genuinely lost the space competition. A real signal worth surfacing to the student, not an error. |
| `out_of_window` | Its deadline is beyond `window_start + window_days` — never attempted, not a failure. |
| `infeasible_deadline` | In scope, but its deadline can't be met even starting immediately — flag this to the student plainly, per CLAUDE.md's "worth surfacing, not hiding." |

**What this response is *not*:** a `sessions` document per `SCHEMA.md`. It's missing
`action`, `intensity`, `locked`, and `completed` — those are UI/product concerns this
service has no opinion on. Whatever calls `/solve` needs to translate `placed`/
`unplaced` entries into real `sessions` documents; that translation isn't specified
here because it isn't this service's job.

### 🟢 The tools, `GET /plan`, and how they connect — all implemented

Every tool in §5 is a real endpoint, `POST /tools/<tool_name>` (e.g. `POST
/tools/set_daily_workload_limit`), body shaped exactly like `tool_schemas.json`'s
parameters. Each one: validates the request, maps `strength` → weight via §10's table
(never a caller-supplied number, per §3), applies §4's singleton/accumulating rule
through `PreferenceStore`, and — this is the "backend-owned side effect" from the
design decision above, made real — automatically re-solves and caches the result.
`remove_preference` is `POST /tools/remove_preference`; an ambiguous `match` returns
`409` with the candidate list (§7), no active entry of that type returns `404`.
`list_current_preferences` is `GET /tools/list_current_preferences`.

`GET /plan` returns the most recent solve for the one test student, re-solving once
against an empty preference set if nothing has run yet rather than erroring — a fresh
student with nothing set still has a real, plain schedule to show.

**Historical note, no longer live:** this implementation used to unconditionally
splice §6's then-always-on defaults (spread/urgency/min-gap) into `POST /solve` too,
not just tool-triggered solves — an interpretation of the original spec, confirmed as
intended at the time. Moot now that those three migrated onto the real tool surface
(§5, §6) — `POST /solve` takes exactly the `preferences` array its caller sends, same
as always; there's no longer a hidden always-on set to worry about applying
consistently.

Two endpoints exist only for manual testing and aren't part of this spec:
`POST /reset` (clears all state) and `GET /health`.

### 🔴 Not specified anywhere yet

- The actual orchestration inside `POST /optimizer/runs` (job tracking, how "stage"
  and "progress" get reported mid-solve — there's no progress-callback wired into
  `build_and_solve()` today, so those fields have nothing real to report from yet).
- Auth, rate limiting, multi-tenant request shaping — this doc assumes a single
  student's data arrives fully assembled; who assembles it and how they're
  authenticated is Next.js's problem, not specified here.

## 3. The rule that matters more than anything else here

**Every numeric "how much do I care about this" parameter below is a bounded
`strength` enum (`gentle` / `moderate` / `firm`), never a raw number you choose.**
This is not a style preference — it's a hard lesson from building this system, and
it's worth knowing why, because it explains every other design choice in this doc.

The solver's objective has three tiers, strictly ordered by scale so a lower tier can
never outrank a higher one:

1. **Schedule as much as possible** — worth 10,000,000 points per session placed.
   This always wins. Nothing below should ever be able to threaten it.
2. **Satisfy preferences** — the tools in this document. Each is worth a few points
   to a few thousand, depending on `strength`.
3. **A tiny tie-break** for genuine ties. Worth ~1-14 points, never meant to drive
   behavior on its own.

That ordering was violated twice during development, both times because a numeric
weight — chosen by a human with the full source code in front of them — turned out to
be large enough that tier 2 started overriding tier 1. Concretely: a preference term
scaled by a session's exact time slot (a number that can run into the hundreds or
thousands) multiplied by even a modest-looking weight produced a value bigger than
10,000,000, and the solver responded exactly as told — it started leaving unrelated
sessions completely unscheduled just to satisfy that one preference a little better.
Both times this looked like a normal, sensible weight choice right up until it wasn't.

**The fix that makes this safe by construction**, and the reason every tool below
takes `strength` instead of a number: the actual internal weights are pre-chosen,
tested values that stay reliably inside tier 2 no matter what. You are never in a
position to pick a number large enough to cause this — the enum physically cannot
select one. If you ever find yourself wanting a "stronger than firm" option, don't
invent one; that instinct is exactly the failure mode above.

## 4. How a preference persists across a conversation

Every preference type is either:

- **Singleton** — there is only ever one active entry. Calling the tool again
  *replaces* it outright. (`set_preferred_work_hours`, `set_break_habits`.)
- **Accumulating** — multiple entries can be active at once, distinguished by a
  *scope* (which days, which time window). Calling the tool again with a **different**
  scope adds a new, additional entry; calling it again with the **same** scope
  replaces that one entry. (`set_daily_workload_limit`, `protect_time_block`.)

`remove_preference` deletes a specific entry outright. For a singleton type there's
never any ambiguity about which one. For an accumulating type with more than one
active entry, pass enough of the original parameters back (in `match`) to identify
which one — if that's still ambiguous, the call fails with the list of current
candidates rather than guessing (see §7).

Use `list_current_preferences` whenever you're not certain what's already active —
before a `remove_preference` call, or when the student asks what's currently shaping
their schedule.

## 5. Tools

Every tool in this section is implemented and tested against real data. §9 covers
what's designed but not wired up yet — don't call those; they exist in the catalog
below intentionally and only these ten do.

### `set_preferred_work_hours`
**Singleton.** Sets the one daily window flexible work is rewarded for landing in.

Call it for a general daily-rhythm statement: *"I like working in the evenings,"*
*"mornings are my best time,"* *"I don't want to study before noon."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `start_time` | `"HH:MM"`, 24-hour | yes | e.g. `"17:00"` |
| `end_time` | `"HH:MM"`, 24-hour | yes | must be later than `start_time` |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `moderate` is the tested default |

**Example** — *"Honestly I do my best thinking after dinner, before that I'm useless"*
→ `set_preferred_work_hours(start_time="18:30", end_time="23:00")`
→ effect: sessions starting in that window are now worth more to the solver; nothing
outside it is forbidden, just less preferred when a choice exists.

### `set_daily_workload_limit`
**Accumulating**, scope = the `days` set (or "every day" if `days` is omitted).

Call it when the student talks about feeling overloaded on specific days, wanting a
lighter day, or wanting a genuine rest day: *"Sundays should be light,"* *"don't pack
more than a few hours into one day,"* *"I'm burning out."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `minutes_per_day` | integer, 30-900 | yes | 240 (4h) is a sane general default; 60-120 for an explicit rest day |
| `days` | array of weekday strings | no | omit for "every day"; don't pass all seven explicitly |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `firm` is right for an explicit rest day |

**Example** — *"Sundays need to actually be a day off"*
→ `set_daily_workload_limit(minutes_per_day=90, days=["Sun"], strength="firm")`
→ this **adds to**, doesn't replace, a general cap already set for every day — both
stay active, Sunday just gets its own, stricter number.

### `protect_time_block`
**Accumulating**, scope = the exact `days` + `start_time`/`end_time` combination.
**Hard** — total protection, no `strength` parameter, because there isn't a "softer"
version of this yet (see §9 if one ever needs to exist).

Call it for anything that must never have schoolwork scheduled over it: social plans,
sports, religious observance, family time. *"Don't touch my Friday nights,"* *"I have
church Sunday mornings,"* *"keep game night free."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `days` | array of weekday strings | yes, ≥1 | |
| `start_time` | `"HH:MM"`, 24-hour | yes | |
| `end_time` | `"HH:MM"`, 24-hour, or `"24:00"` | yes | use `"24:00"` for midnight, not `"00:00"` |

**Example** — *"Friday and Saturday nights are sacred, don't even think about it"*
→ `protect_time_block(days=["Fri","Sat"], start_time="19:00", end_time="24:00")`

### `set_break_habits`
**Singleton.** A *soft* goal — minimizes the single longest unbroken stretch of
flexible work, it does not forbid exceeding some fixed number. An absolute cutoff was
tried and rejected on purpose: it could only ever satisfy itself by dropping a session
outright when a genuinely urgent deadline needed a long push, which is worse than
occasionally allowing one.

Call it when the student talks about needing breaks or working too long without
stopping: *"I need a real break every couple hours,"* *"don't let me grind for four
hours straight."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `break_minutes` | integer, 15-120 | no, default 45 | how long a gap must be to count as a real break |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | see warning below |

**`strength` here is not symmetric with the other tools — read this before choosing
`firm`.** Empirically: `gentle` barely moves anything (it loses every tradeoff against
finishing urgent work early). `moderate` is the tested, recommended default — it
noticeably shortens the worst stretch with *zero* cost to how early urgent work gets
finished. `firm` measurably starts trading against that — urgent work gets pushed
closer to its actual deadline instead of comfortably ahead of it. Only choose `firm`
if the student has explicitly said breaks matter more to them than finishing things
early.

**Example** — *"I need an actual break every couple hours, I don't care if it makes
stuff less optimal"*
→ `set_break_habits(break_minutes=45, strength="firm")` — the "I don't care" is what
licenses `firm` here; without it, default to `moderate`.

### `set_task_spacing`
**Singleton.** Controls how strongly the solver avoids putting multiple sessions of
the *same* assignment on the same day (spreading a large task's chunks out instead of
clustering them). Until recently this was permanently on, unadjustable, and not a tool
at all — see §6 for why, and why it's safe now.

Call it when the student talks about wanting an assignment's sessions spread out more,
or the opposite — wanting to power through a task in one sitting once started:
*"spread my project work out more,"* *"don't put three problem-set sessions on the same
day,"* *"I'd rather just knock a task out in one go."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `moderate` is the tested default — this schedule's setting before it was ever adjustable |

**Example** — *"Please don't cram every session of my project onto one day"*
→ `set_task_spacing(strength="firm")`

### `set_urgency_emphasis`
**Singleton.** Controls how strongly soon-due work gets pulled earlier in the window
relative to work due later. Same history as `set_task_spacing` — see §6.

Call it when the student wants urgent deadlines handled sooner, or is pushing back on
the schedule always front-loading whatever's due next: *"get urgent stuff done as
early as possible,"* *"stop always rushing me toward the next deadline."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `moderate` is the tested default — this schedule's setting before it was ever adjustable |

**Example** — *"Whatever's due soonest, just get it done as early as you can"*
→ `set_urgency_emphasis(strength="firm")`

### `set_minimum_gap`
**Singleton. Hard** — the solver will never place two flexible sessions closer
together than this; no `strength` parameter, same reasoning as `protect_time_block`.

Call it when the student explicitly wants more or less real-world buffer between
back-to-back study blocks: *"give me at least half an hour between study sessions,"*
*"5 minutes is plenty, I don't need much of a gap."* **Different setting from
`set_break_habits`** — that one is about how long a single unbroken work *stretch* can
run before it needs a break; this one is the gap between two already-separate
sessions.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `minutes` | integer, 0-60 | no, default 15 | 15 is the tested default — this schedule's setting before it was ever adjustable |

**Example** — *"Give me at least 30 minutes between study sessions"*
→ `set_minimum_gap(minutes=30)`

### `set_meal_window`
**Accumulating**, scope = `meal` (breakfast/lunch/dinner each have exactly one
active window; setting lunch never touches breakfast or dinner). **Hard** — the
window is a real bound, not a soft preference; no `strength` parameter, same
reasoning as `protect_time_block`/`set_minimum_gap`.

This is NOT an exact time. Meals used to be fixed, immovable blocks (like a
lecture); now the solver places each one freely anywhere inside the window,
`duration_minutes` long, wherever fits best around the rest of the day — a
different length or time on different days is expected, not a bug.

Call it when the student wants to change when they eat: *"I want breakfast
earlier, like 6 to 8,"* *"lunch should be between 11 and 1:30,"* *"push dinner
later, after 7."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `meal` | `breakfast`\|`lunch`\|`dinner` | yes | |
| `start_time` | `"HH:MM"`, 24-hour | yes | earliest the meal can start |
| `end_time` | `"HH:MM"`, 24-hour | yes | latest the meal can end — must leave room for `duration_minutes` |
| `duration_minutes` | integer, 15-90 | no, default 45 | 45 is the tested default — this schedule's setting before it was ever adjustable |

**Example** — *"Lunch should be between 11:30 and 2"*
→ `set_meal_window(meal="lunch", start_time="11:30", end_time="14:00")`
→ replaces lunch's previous window; breakfast and dinner are untouched.

### `remove_preference`
Deletes one active preference. See §4 for the persistence model this depends on.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `preference_type` | one of `preferred_work_hours`, `daily_workload_limit`, `protected_time_block`, `break_habits`, `task_spacing`, `urgency_emphasis`, `minimum_session_gap`, `meal_window` | yes | |
| `match` | object | only if >1 entry of that type is active — normal for `meal_window`, since breakfast/lunch/dinner are three separate entries | repeat enough of the original parameters to identify which one, e.g. `{"days": ["Fri","Sat"]}` for a protected block, or `{"meal": "lunch"}` |

**Example** — *"Actually never mind the Sunday thing, I'll manage"*, with both a
general daily cap and a Sunday-specific one active
→ `remove_preference(preference_type="daily_workload_limit", match={"days": ["Sun"]})`

### `list_current_preferences`
No parameters. Returns every active preference. Call before an ambiguous
`remove_preference`, or when asked "what have I told you so far."

## 6. What's always on, and why you don't control it

This used to list four things: spreading a big task's sessions out, urgency-aware
prioritization, a minimum buffer between sessions, and review-session generation —
all permanently on, none of them tools. The first three moved onto the real tool
surface (`set_task_spacing`, `set_urgency_emphasis`, `set_minimum_gap` — §5): they
were never *fundamentally* different from `set_preferred_work_hours` or
`set_break_habits`, they just hadn't been given a tool yet. Each still ships with the
exact same tested default it always ran at (`seed_mongo.py`'s
`seed_default_preferences()`), so a student who never mentions any of them gets
identical behavior to before — the only change is that now they *can* ask to adjust
one, and you have a real way to say yes.

One thing is still genuinely, permanently not a tool:

- **A short "review your notes" session generated after every lecture** — not tied to
  any assignment, just a standing study habit. (A way to turn this off per-student is
  designed but not built yet — see §9.)

If a student's request conflicts with that (e.g. *"stop adding those review
sessions"*), say plainly that the system doesn't support turning it off yet rather
than trying to approximate it by misusing one of the tools in §5.

## 7. Validation and error handling

- **Unknown tool, missing required parameter, or a value outside its declared
  range**: rejected before touching the schedule. You'll get a structured error
  describing exactly what was wrong — fix the call and retry in the same turn rather
  than telling the student something went wrong.
- **`remove_preference` with an ambiguous `match`** (or none, when multiple entries of
  that type exist): rejected with the list of current candidates for that type. Call
  `list_current_preferences` or ask the student, don't guess.
- **A `protect_time_block` call that would remove nearly all remaining working
  hours** (in combination with what's already protected): still accepted — it's the
  student's real request — but the response includes a warning you should relay to
  them, since the schedule may come back with far less placed than expected.
- **Nothing here ever silently no-ops.** If a call succeeds, something real changed
  and a re-solve has been triggered. If you don't get confirmation, don't tell the
  student it worked.
- **`POST /solve` (§2) itself**: a malformed request (a task referencing a
  `course_id` not present in `courses`, an unparseable datetime, `window_days <= 0`)
  should be rejected with a 4xx and a specific field-level message before any solving
  starts — this endpoint has no business returning a 500 for bad input.

## 8. A full worked exchange

> **Student:** "I've got practice every weeknight so I can't work after 7pm on
> weekdays, but weekends are totally free."
> → `protect_time_block(days=["Mon","Tue","Wed","Thu","Fri"], start_time="19:00", end_time="24:00")`

> **Student:** "Also I'm way more productive at night when I do have time."
> → `set_preferred_work_hours(start_time="20:00", end_time="23:30")`
>
> *(Note the tension: the protected block above already blocks weeknight evenings —
> this preferred window mostly ends up applying to weekend nights, and that's fine;
> the two tools don't need to be reconciled by hand, the solver just optimizes against
> both as given.)*

> **Student:** "Sundays are for family, keep it completely clear."
> → `protect_time_block(days=["Sun"], start_time="00:00", end_time="24:00")` — a
> **second**, separate protected block; the weeknight one from turn 1 is untouched.

> **Student:** "Actually practice got cancelled for the season, I have my evenings
> back."
> → `remove_preference(preference_type="protected_time_block", match={"days": ["Mon","Tue","Wed","Thu","Fri"]})`
> — removes only that block; Sunday stays protected, the preferred-hours setting from
> turn 2 is untouched.

> **Student:** "What's actually set right now?"
> → `list_current_preferences()` → report back in plain language: preferred hours
> 8pm-11:30pm, Sundays fully protected. (The weeknight block is gone — it was removed
> last turn.)

## 9. Planned, not available yet — do not call these

Two things came up repeatedly in design discussion and map cleanly onto real user
requests, but nothing in the backend consumes them as a per-student parameter yet —
today they're fixed constants in `backend/optimizer/decompose.py`, the same for every
user. Calling a tool for either would silently do nothing, so none exists in the
catalog above. Noted here so whoever wires this next knows exactly what's missing:

- **Focus-session length** ("I like short 30-minute bursts" / "I do better in long
  2-hour blocks"). `decompose.py`'s `MAX_SESSION_MIN` (currently a flat 60, "never
  work on one subject for more than an hour") would need to become a per-user input
  to the task→session splitting step instead of a module constant.
- **Turning off the after-class review sessions** ("I take good notes already, I
  don't need a review block after every lecture"). `generate_review_sessions()`
  currently runs unconditionally for every course; it would need a per-student flag.

## 10. For whoever implements the wiring

| Tool | Internal `Preference.type` | Compiler | `strength` → weight |
|---|---|---|---|
| `set_preferred_work_hours` | `preferred_hours` | `_compile_preferred_hours` | gentle=10, moderate=20\*, firm=30 |
| `set_daily_workload_limit` | `daily_load_cap` | `_compile_daily_load_cap` | gentle=8, moderate=15\*, firm=25\* |
| `protect_time_block` | `avoid_block` | `_compile_avoid_block` | hard, no weight |
| `set_break_habits` | `max_continuous_work` | `_compile_max_continuous_work` | gentle=500, moderate=1000\*, firm=2000 |
| `set_task_spacing` | `spread_multi_session_tasks` | `_compile_spread_multi_session` | gentle=15, moderate=25\*, firm=35 |
| `set_urgency_emphasis` | `urgency_priority` | `_compile_urgency_priority` | gentle=4, moderate=8\*, firm=16 |
| `set_minimum_gap` | `min_gap_between_sessions` | `_compile_min_gap` | hard, no weight (`minutes`, tested default 15) |
| `set_meal_window` | `meal_window` | *(none — see below)* | hard, no weight (`start`/`end`/`duration_minutes`, tested default 45-minute meals) |

\* = the exact value empirically tested this session (see `backend/optimizer/README.md`,
"Round 4" for `max_continuous_work`'s tuning history in particular — the others are
principled interpolations around one tested point, not independently verified across
the full range; `set_task_spacing`/`set_urgency_emphasis`'s `moderate` are the values
these two ran at unconditionally, for every solve, before they were tools at all — see
§6). Six of the seven compilers live in `backend/optimizer/preferences.py`, dispatched
by `REGISTRY` at the bottom of that file. `meal_window` is the exception — it's handled
directly in `backend/optimizer/scheduler.py`, not the registry, because unlike every
other type its solved placement has to be extracted back out after the solve (to render
as a real calendar block), which the registry's `(weight, expr)` objective-term contract
has no way to carry. Still a real, hand-written, deterministic piece of code turning one
`(type, value)` preference into CP-SAT variables — nothing about the "AI never touches
solver code" boundary is different, just where the code lives.

Weights above were tuned against a 14-day rolling window
(`backend/optimizer/run_prototype.py`'s default), not the 7-day horizon the frontend
currently assumes (`frontend/src/lib/preferenceCatalog.js`'s `HORIZON_DAYS`) — that
mismatch needs resolving before this goes live (see the chat history from this
session for the full list of frontend/backend drift found). The `-day`-based scaling
used throughout §3 means these specific weights should carry over safely to a shorter
window without re-tuning — day-based terms only get smaller as the window shrinks —
but that's an expectation, not something re-verified at 7 days yet.

`remove_preference` and `list_current_preferences` aren't preference *types* — their
own small API surface (find/delete by type+scope, list by student) lives in
`preferences_store.py`'s `PreferenceStore`, not `compile_all()`.

`POST /solve`, all ten tools under `/tools/`, and `GET /plan` are implemented in
`backend/optimizer/api.py` (models in `api_models.py`, persistence in
`preferences_store.py`) and verified end-to-end against real requests — including the
error paths (`409` ambiguous removal, `404` nothing to remove, `422` validation). Still
missing: the Next.js-facing `/optimizer/runs` async wrapper (§2's other layer), auth,
and any connection to a real database — this is still one in-memory test student.
