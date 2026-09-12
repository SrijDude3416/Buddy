# CLAUDE.md — Buddy

This file is the shared context for anyone (human or Claude Code) working on any part
of this project. Read it before touching frontend, backend, schema, or the optimizer —
the sections under **Non-negotiable principles** exist because it's easy to build a
locally-reasonable piece of this system that quietly undermines the whole premise.

## What Buddy is

Buddy is a suite of optimization tools for school/college. The core thesis: **LLMs are
uniquely positioned to bridge the gap between math (optimality) and personalization
(human idiosyncrasy)** — the same pattern Amazon uses at scale (invisible optimization
math running under a personalized surface), applied to a student's semester.

Concretely: **the AI is not optimizing for the user — it's optimizing the math for the
user, shaped by their personality.** The user stays the decision-maker; the AI translates
goals and personal patterns into the mathematical structure of an optimal schedule.
Language and math are both just representations, and an LLM is good at abstracting one
into the other — that abstraction is the product's actual differentiator, not the
scheduling UI on top of it.

Three layers, top to bottom:
1. **Study Buddy** — the personalized assistant the user actually sees: assignments,
   grade prediction, calendar/plan, quiz prep, homework help.
2. **Data hub** — per-class data pulled from FCEs, Canvas, and syllabi. Scraped once per
   semester via a Canvas REST API, parsed cheaply since it's a recurring per-semester job.
3. **AI/human/optimality interaction** — the actual differentiator. The AI bridges
   humans and optimality (something humans are structurally bad at alone) without ever
   making the decision itself.

## Non-negotiable principles

These came up repeatedly while building the MVP and schema. Treat any change that
violates one of these as a regression, not a simplification, even if it looks cleaner:

- **The LLM never touches solver code or the schedule directly.** It only ever emits
  typed, validated preference objects (`type`, `value`, `weight`) from a fixed,
  enumerable catalog. A separate, deterministic Python compiler registry — never the
  model — decides how each type becomes a CP-SAT constraint or objective term. This is
  what makes "AI optimizes the math for you" literally true instead of a slogan.
- **Time's fundamental unit is a session, not an event.** A session carries a task, a
  goal, an effort estimate, flexibility, and intensity — not just a name/time/color
  triple. Don't let anything in the codebase quietly reintroduce bare calendar events.
- **Tasks can be multiple sessions, and each session carries a concrete action.** The
  backend tells the user exactly what to do in a given session ("work through 10
  practice problems from the study guide"), not just when to sit down. This is the
  fatigue-reduction feature — don't flatten it back into a bare title + checkbox.
- **Never brand the product as a calendar.** The word "calendar" shouldn't appear as a
  nav label or primary framing anywhere in the UI. Time structure (locked blocks,
  relative deadlines, load-by-day) is communicated without presenting the app as a
  calendar product. The main hub tab is called **Plan**, not Calendar.
- **The task page leads with why, not a due-date form.** No priority dropdowns, no
  manual due-date fields, no checkbox-first layout. Rescheduling happens by talking to
  Buddy, not by editing a field. A task page that becomes a generic checklist (Todoist,
  Notion, Google Tasks) directly undermines the "AI translates, you decide" pitch — see
  the design notes in the MVP file for the specific failure modes this guards against.
- **Fixed blocks (class/recitation times) and flexible sessions share one timeline.**
  A lecture is immovable because it's a plain interval with no decision variables, sitting
  in the same conflict-detection pool as everything else — not because of special-case
  logic scattered through the app.
- **The optimizer only ever reads `tasks`, `preferences`, and `sessions`.** Syllabus
  internals (`courses`, `syllabus_data`) never reach it directly — see `SCHEMA.md`.

## Architecture

### Tech stack

| Layer | Tech |
|---|---|
| Frontend | React, Tailwind |
| Backend | Vercel, Next.js, MongoDB |
| Data scraping | Canvas REST API |
| Data parsing | Low-cost recurring per-semester parsing of Canvas data |
| Scheduling engine | Python, CP-SAT (Google OR-Tools) |
| Conversational AI | Gemini — bridges math, human, and the optimal schedule |

### Repo layout (target — not all of this exists yet)

```
/frontend            React + Tailwind app (see "Frontend" below)
/backend
  /api                Next.js API routes
  /optimizer          CP-SAT model + preference compiler registry (Python) — deployed
                      as its own standalone service, not a Vercel function; see
                      "Scheduling engine (CP-SAT)" below
  /pipeline           Canvas scraping + syllabus parsing (per-semester job)
/test-data           Sample tasks/courses data (see test-data/README.md) — lives at
                     root, not under /frontend or /backend, so every branch can read
                     it without depending on another branch's directory
SCHEMA.md            MongoDB schema — source of truth for collection shapes
CLAUDE.md            this file
```

What exists today, produced during MVP/design work and worth using as a reference
implementation (none of it is wired to a real backend yet):

- **Frontend MVP** (`buddy-mvp.jsx`) — full React/Tailwind prototype: onboarding, the
  post-onboarding "first look" (three interchangeable views of one generated plan),
  the main Plan/Classes hub, task detail, and the chat sidebar. Runs entirely on mock
  in-memory data; every place a real API call belongs is marked with a
  `// In production: ...` comment.
- **`SCHEMA.md`** — MongoDB schema, v2, feature-aligned with the MVP.
- **`backend/optimizer/`** — a real, running CP-SAT prototype against
  `test-data/schedule_test_data.json`: the preference-compiler-registry pattern
  (`preferences.py`, with a correctly bidirectional `reify_window`), placement
  (`scheduler.py`), and an eval harness (`eval.py`) that turns a solve into concrete
  numbers instead of an eyeballed calendar. See `backend/optimizer/README.md` for what
  a preference-tuning pass actually found (a duration-rounding bug, an objective-scaling
  bug, and a real modeling gap around fixed-time exams — still open, see below).

## Frontend

### UI flow

1. **Onboarding** — exactly 5 questions, chat-bubble UI, but every answer is
   multiple-choice/dropdown, never free text. Current questions: which classes, when
   you're most focused, outside commitments, how you like to work (session length),
   and what's weighing on you most right now (drives the tone/framing of the first
   generated task, not just its content).
2. **First look** — immediately after generation, the *same* generated plan is shown
   through three switchable views, not a single table:
   - **Radial** — a real 24-hour dial (actual times mapped to angles), fixed blocks
     and sessions as colored arcs.
   - **Goals** — a swimlane per class/goal, sessions placed across a day-by-day grid.
   - **List** — flat cards, one per task's next session, with a thumbs-down to nudge
     just that one.
   A single feedback box under the switcher works regardless of which view is active.
   This page is deliberately visually continuous with the main hub (same pill-tab
   styling, same cards, same palette) but functionally stripped down — no Classes tab,
   no persistent sidebar, no task drill-down — so a brand-new user isn't dropped into
   the full app's surface area on day one.
3. **Main hub** — two tabs, **Plan** and **Classes**, plus a chat icon that toggles a
   slide-in sidebar (closed by default, never auto-opens).
   - **Plan**: *Today* — fixed blocks and flexible sessions merged into one
     chronologically-sorted list (real time parsing, not type-based ordering). Fixed
     blocks render as dark, non-interactive, lock-icon chips. *This week* — a lightweight
     load-by-day strip, not an hour grid. *Coming up* — goals/deadlines expressed with
     relative time ("Midterm in 12 days"), not absolute dates.
   - **Classes** (auxiliary feature): pick a class, see a month-by-month unit/topic
     breakdown. Each topic has a "Resources" action that opens the chat sidebar seeded
     with a request for that specific topic.
   - **Chat sidebar**: shared across Plan/Classes/task detail. Opens on request only,
     always seeded with context (which task, which topic) rather than a bare message,
     so the backend can resolve intent without parsing free text.
4. **Task detail** — a task is a list of ordered sessions, each with a concrete action
   and its own intensity indicator. No due-date field, no priority dropdown. The only
   action beyond marking a session done is "Ask Buddy about this," which opens the
   sidebar seeded with the task's name.

### Design system

Deliberately avoided the common AI-generated-page tells (cream background + terracotta
accent, tracked-out eyebrow labels, spaced-em-dash chrome, generic identical-rounded-card
kit). Palette: **stone** (neutral surfaces/text), **emerald** (goals/growth/primary
actions), **amber** (intensity/focus signal) — all core Tailwind utilities only, no
arbitrary-value classes, since there's no JIT compiler in the artifact runtime this was
prototyped in. Typography: `font-serif` for headings, `font-sans` (default) for body/UI,
sentence case throughout, no all-caps labels.

### Known simplifications in the MVP worth revisiting for real data

- The "this week" load strip currently counts fixed blocks and flexible sessions
  together for the same load indicator — slightly understates how "locked-in" a
  heavy class day feels versus a heavy self-directed day. A two-tone bar split is a
  quick fix if the demo narrative needs it.
- Radial view currently only renders *today*. Extending it to any day is a small
  addition, not a redesign, but wasn't required for the hackathon demo.

## Data model

Full field-level detail lives in `SCHEMA.md` — this is the condensed map.

| Collection | Scope | Purpose |
|---|---|---|
| `courses` | shared/static | Course-section catalog + `meeting_times` (recurring lecture/recitation pattern — the source for locked blocks) |
| `syllabus_data` | shared/static | Extracted syllabus content per course; loosely-typed `topics` for robustness, plus a normalized `unit_breakdown` specifically for the Classes page |
| `users` | per-user | Profile only — nothing here is an optimizer input |
| `enrollments` | per-user | Join between a user and the course catalog |
| `tasks` | per-user | The optimizer's task-level input, seeded from `syllabus_data.assignments`; carries `display_title` (one AI-generated friendly title, computed once so all three plan views render the same string) |
| `preferences` | per-user | The optimizer's constraint/weight input. Seeded from onboarding **and** appended to by chat feedback — both are just entries here, distinguished by `source`. `source_message_id` traces a chat-driven entry back to the message that produced it. **This is the only schema the AI ever writes into — never solver code.** |
| `sessions` | per-user | The optimizer's output. `type: "flexible"` (has a `task_id`, optimizer-placed) or `type: "fixed"` (no `task_id`, materialized from `courses.meeting_times`, always `locked`). Carries `action` (the concrete instruction), `intensity` (drives focus-window placement), `duration_min`, and `completed` (separate from `locked` — one tracks "can the solver touch this," the other tracks "did the user actually do it"). |
| `chat_messages` | per-user | Persistent sidebar transcript, with a `context` object (task/session/course/topic) so requests don't need to be resolved by parsing free text. Deliberately separate from `preferences` — not every message is a scheduling constraint (a resource request never should be). |
| `optimizer_runs` | per-user | One entry per solve: `inputs_snapshot`, `objective_value`, `best_bound`, `gap` — the durable "why" log, and the source of the "% optimized" stat. |

Key invariant carried through the whole schema: **there's exactly one place the
optimizer reads preference data from** (`preferences`), and exactly one place it reads
placeable/placed time from (`tasks` + `sessions`). Nothing about a user's raw onboarding
answers or chat history needs a second copy — `preferences` entries with `source:
"onboarding"` already are the durable, structured record.

## Scheduling engine (CP-SAT)

**Deployment**: the optimizer is not a Vercel Python serverless function. OR-Tools' CP-SAT
binary is heavy enough (native wheel size, cold start) and a solve can occasionally run long
enough that it's a poor fit for serverless size/timeout limits — and a serverless function
can't hold any state between calls anyway. It runs as its own always-on FastAPI service
(Railway/Render/Fly.io-class host, not Vercel), called over plain HTTP by the Next.js
backend, same as any other third-party API.

**Time horizon**: solves run on a rolling weekly window in 15-minute slots, not the whole
semester up front. This falls directly out of the feedback loop being the core UX
(chat feedback → new `preferences` entry → re-solve): a semester-wide solve is slower to
re-run on every message and, worse, could reshuffle sessions far outside the window the
feedback was even about — including ones already `completed` or `locked`. Deadlines beyond
the current window still constrain the solve, but only as a rough "hours still owed to this
task/course" capacity reservation, not slot-level placement — the slot-level plan for a
future week doesn't exist until that week's own solve runs.

Two-stage pipeline, deliberately kept separate:

1. **Task → session decomposition** (heuristic, not solved). Given a task's total
   estimated duration and the user's "how do you like to work" preference, decide how
   many sessions it splits into and how long each is. This happens *before* CP-SAT and
   is not the solver's job — keeping it separate is what keeps the actual solve a clean
   classic placement problem instead of a much harder joint splitting-and-placement
   problem, which matters for keeping re-solves fast enough to run on every chat message.
2. **Placement** (CP-SAT). Given already-sized sessions, immovable fixed blocks, and a
   set of preferences, decide start times within the current week's window.

Core mechanics (see `backend/optimizer/scheduler.py` and `preferences.py` for the
actual, running code — no longer just a sketch):

- Every session — fixed or flexible — is an `IntervalVar` in one shared list, and
  `AddNoOverlap` over that list is the *only* mechanism needed for "class times are
  immovable." No special-casing elsewhere. This now also covers personal routine
  blocks (gym, meals — CLAUDE.md's onboarding "outside commitments" question feeds
  this), materialized exactly like `courses.meeting_times`, not just class times.
- **Working hours (e.g. 8am–11pm) bound *flexible* sessions directly, never as a
  shared blackout interval.** An early version modeled "off-hours" as a mandatory
  interval everything had to avoid overlapping — reasonable until a real fixed
  commitment (gym at 6:30am) existed outside that window, at which point two
  mandatory, always-overlapping intervals made the *entire* model infeasible, not
  just one session. The fix: constrain each flexible session's own start/end
  directly; fixed/personal/course blocks are restricted only by not overlapping
  other intervals, never by time-of-day. General lesson: a mandatory mutual-exclusion
  interval is only safe when nothing legitimately fixed can ever sit inside it.
- A flexible session's start variable is domain-bounded by its deadline
  (`latest_start = deadline_slot - duration_slots`, slots = 15 minutes) — infeasibility
  here means "this genuinely can't be scheduled in time," which is worth surfacing, not
  hiding.
- **Preference compiler registry**: each preference `type` has exactly one
  hand-written, unit-testable compiler function that turns `(value, weight)` into
  either a hard constraint or a list of bounded `(coefficient, BoolVar)` objective
  terms. This is the entire surface area where LLM-derived input enters the solver.
- **Reification direction matters and is easy to get quietly wrong.** A one-directional
  boolean implication is safe for a reward term but silently broken for a penalty term
  (the solver can dodge the penalty for free). `reify_window` fully reifies both
  directions once so every compiler that needs a window-membership boolean is safe by
  construction — write unit tests per compiler (tiny synthetic problems) rather than
  trusting this by inspection.
- **Weights need normalization.** A boolean-indicator term naturally lives in
  `[0, weight]`; something like slack minutes lives in `[0, ~672]`. Mixing them
  unnormalized means whichever preference type produces bigger raw numbers dominates
  the objective regardless of its actual weight. Normalize before combining.
- **CP-SAT's objective is integer-only.** Float preference weights get scaled once at
  assembly time (`WEIGHT_SCALE`), not inside each compiler.
- **`objective_value` / `best_bound` / `gap` is a real, honest "% optimized" stat** —
  CP-SAT reports a provable upper bound even when it can't prove optimality within the
  time limit, so `gap` is a legitimate claim to show the user, not a fudged number.

**Open decision, not yet made**: preferences currently blend into one weighted sum,
so a strong `avoid_block` penalty and a weak `preferred_hours` reward can trade off in
ways that might surprise a user ("why did it ignore my 'no work after 9pm' just this
once"). CP-SAT supports strict priority tiers instead (solve top tier, fix its
objective value as a constraint, optimize the next tier) if that's the story you want
to tell instead of pure blending. Decide before relying on this in a demo.

**Open decision, not yet made**: `tasks.est_duration_min` is now a rollup of its
sessions' `duration_min` rather than ground truth. Once `actual_time_logged_min`
feedback exists, decide whether refinement writes back into individual
`sessions.duration_min` values or only adjusts the task-level rollup — that decision
changes who's allowed to touch a not-yet-`locked` session document.

**Open gap, found while preference-tuning against real data, not yet fixed**: an exam
(`splittable: false`, a `due_at`) is still just a flexible task to the optimizer —
`splittable: false` only affects how many sessions `decompose.py` produces, it says
nothing about whether the *time itself* is a decision. Result: a real prototype run
placed "Midterm 1" at 8pm four days before the actual exam, which is meaningless — an
exam happens at one specific, non-negotiable time, the same way a lecture does. This
needs a schema answer, not a new preference: most likely, exam-type tasks should
materialize as locked blocks the same way `courses.meeting_times` do (see `SCHEMA.md`),
rather than ever entering the optimizer as a `tasks` document at all. See
`backend/optimizer/README.md` for the specific run this showed up in.

## Hackathon pitch (for whoever demos this)

- Open with the Amazon analogy: "Amazon doesn't ask what you want — it does math on
  what you've done and hands you something personalized. We're doing that for your
  semester." Judges get the mental model without an AI lecture, and it separates the
  pitch from every other "AI chatbot for students" in the room.
- Preempt "isn't this just ChatGPT with a calendar?" directly: ChatGPT has no data hub
  (no FCE history, no syllabus structure, no past-student performance) and gives
  everyone the same kind of answer. Buddy's bet is that optimization only works if it's
  shaped by the individual — "AI as translator, not decision-maker."
- Make the three-layer architecture visible in the demo, not just narrated: show the
  Study Buddy UI, then the data feeding it, then the math underneath.
- The single most convincing demo move: run two different student profiles through the
  same course and show visibly different schedules. Proves personalization is real,
  not marketing language.
- Mention the scraping/parsing pipeline is deliberately low-cost and automated to
  re-run every semester — signals a sustainable product, not a one-off hack.
- One-line answer ready for "why trust an AI with your grades/schedule": the AI never
  makes the decision, it only does the math translation the student can't do alone.
- Close on scale: every class, every semester, every school — the data hub compounds
  as more history feeds in.

## Glossary

- **Session, not event** — the atomic unit of scheduled time. Carries a task, a goal,
  an effort estimate, flexibility, and intensity, not just a name/time/color.
- **Task** — a unit of work that may span multiple sessions, each with its own
  concrete action.
- **Goal** (frontend term) — a course. There is no `goals` collection; progress bars
  and deadlines are computed over `tasks`/`sessions` grouped by `course_id`.
- **Fixed vs. flexible** — a `sessions.type`. Fixed = immovable, materialized from
  `courses.meeting_times`, no `task_id`. Flexible = optimizer-placed, has a `task_id`.
- **Locked vs. completed** — two independent `sessions` booleans. Locked = frozen from
  re-solves. Completed = the user actually did it. A session can be locked and pending,
  or (less commonly) need to stay editable after completion.