# MongoDB Schema — Study Buddy (v2, feature-aligned)

Same two groups as before — **shared/static** (Canvas/PDF pipeline, read-only after
processing) and **per-user** (created at onboarding, changes at runtime) — and the same
core invariant: **the optimizer only ever touches `tasks`, `preferences`, and `sessions`.**
This revision doesn't break that boundary. It extends the shape of those three
collections, plus two smaller additions, so the schema actually matches what the
frontend MVP renders: three interchangeable views of the same plan (radial day / goal
swimlanes / flat list), locked class blocks living on the same timeline as flexible
work, tasks that split into multiple sessions where each session carries a concrete
instruction rather than just a time slot, and a persistent, context-aware chat sidebar.

## What changed, at a glance

| Collection | Change | Frontend feature that drove it |
|---|---|---|
| `courses` | **+ `meeting_times`** | Locked lecture/recitation blocks need a source — they were unmodeled in v1 |
| `syllabus_data` | **+ `unit_breakdown`** (structured, alongside the existing flexible `topics`) | Classes page's month → unit → topic breakdown |
| `tasks` | **+ `display_title`** | One consistent title across Radial / Goals / List, not recomputed three times |
| `sessions` | **renamed `goal` → `action`**; **+ `type`**; **+ `intensity`**; **+ `duration_min`**; **+ `completed`** | Per-session concrete instruction, fixed-vs-flexible blocks in one collection, focus-window personalization, per-session length, session-level done state |
| `preferences` | **+ `source_message_id`** | Trace a chat-driven adjustment back to the message that caused it |
| `chat_messages` | **new collection** | Persistent sidebar history; contextual resource/reschedule requests |

Everything below the field tables explains the "why" for each row — most of these map
1:1 to something we built in the MVP.

## Relationship map

```
courses ──────────┐
   │  (meeting_times)
   │               │
   │ (course_id)   │ (course_id)
   ▼               ▼
syllabus_data   enrollments ── (user_id) ── users
 (+ unit_          │
  breakdown)        │ seeds
                    ▼
                  tasks ── (user_id, task_id) ── sessions ── (task_id: null) ── fixed blocks
                    │                               │             (same collection, type: "fixed")
                    └── (user_id) ── preferences ───┘
                                       │      ▲
                                       │      └── (source_message_id)
                                (user_id)            │
                                       ▼              │
                               optimizer_runs    chat_messages ── (context.task_id / context.course_id)
```

---

## Shared / static

### `courses`

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `code` | string | | e.g. `"15-122"` |
| `section` | string | | e.g. `"A"` |
| `name` | string | | |
| `term` | string | | `"F25"` — hardcoded, no other terms |
| `canvas_course_id` | string | | for re-fetching/debugging against Canvas |
| `meeting_times` | array of `{ type, days, start_time, end_time, location }` | **new** | `type` is `"lecture"` / `"recitation"` / `"lab"`; `days` is an array of weekday ints. This is what "class times, recitation times" actually is — a recurring pattern, not a task. It didn't exist in v1 because nothing in v1 needed to represent an immovable block; the frontend does. |

### `syllabus_data`

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `course_id` | ObjectId | **FK** → `courses._id` | |
| `assignments` | array of `{ name, type, due_date, weight_in_grade }` | | source for seeding per-user `tasks`, unchanged |
| `topics` | array (flexible) | | **unchanged** — stays loosely typed on purpose, real syllabi vary too much to constrain this |
| `unit_breakdown` | array of `{ label, month, topics: [{ name }] }` | **new** | A normalized, LLM-derived *view* of `topics`, specifically for the Classes page's "Sep → Dec, unit by unit" display. This sits alongside `topics` rather than replacing it — raw extraction stays loose for robustness, the frontend gets a shape it can actually render without re-deriving it on every request. |
| `grading_breakdown` | object (flexible) | | unchanged |
| `raw_text_ref` | string | | unchanged |

---

## Per-user

### `users`

Unchanged. Profile info only.

### `enrollments`

Unchanged. Join between a user and the shared course catalog.

### `tasks` — the optimizer's main input

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `course_id` | ObjectId | **FK** → `courses._id` | |
| `source_assignment` | string | | unchanged — the raw syllabus name, e.g. `"Problem Set 4"` |
| `display_title` | string | **new** | The friendly, personalized title — e.g. `"Exam prep: ML Systems"` instead of the bare assignment name. Generated once (AI, at task-creation time) and stored, because Radial / Goals / List all need to show the identical string; computing it independently in three places invites drift. Falls back to `source_assignment` if not yet generated. |
| `due_at` | datetime | | unchanged |
| `est_duration_min` | int | | now read as the **aggregate** estimate (sum of its sessions' `duration_min`) rather than a single block's length, since a task can be many sessions of different sizes |
| `splittable` | bool | | unchanged |
| `status` | enum | | unchanged — `not_started` / `in_progress` / `done`, tracks the *task*, not any one session |
| `priority_weight` | float | | unchanged — this is the optimizer's urgency signal, distinct from a session's `intensity` below (urgency vs. cognitive load are different axes) |
| `actual_time_logged_min` | int / null | | unchanged |
| `session_plan` | array of int / null | **new** | An explicit, ordered list of session lengths in minutes (e.g. `[120, 120, 30]`), overriding `decompose.py`'s own equal-split guess for this one task. Null (every pre-existing task's value) means "let the default heuristic decide," unchanged from before this field existed. Set only by chat's `add_task` tool (PREFERENCE_API.md) when a student is explicit about session structure — never set for a syllabus-imported task. |
| `source` | enum / absent | **new** | `"chat"` when the task was added via `add_task`; absent (not set) for every task imported from a syllabus/Canvas. Distinguishes the two without needing a second collection — mirrors `preferences.source`'s `onboarding`/`chat` split, though tasks don't have that field's full onboarding-vs-chat range since there's no task-creation onboarding step. |

Note: there's no `goals` collection. "Goal" in the frontend refers to the *course* — the
thing a progress bar and a "Quiz in 3 days" line are about. That's just `course_id` +
an aggregation over `tasks`/`sessions`; no new entity needed. Progress % and days-to-deadline
are both computed at read time, not stored.

### `preferences` — the optimizer's constraint/weight input

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `type` | string | | unchanged — e.g. `"preferred_hours"`, `"avoid_block"`, `"weight_adjustment"` |
| `value` | object | | unchanged |
| `weight` | float | | unchanged |
| `source` | enum | | unchanged — `onboarding` / `chat` |
| `source_message_id` | ObjectId / null | **new**, **FK** → `chat_messages._id` | Set when `source: "chat"`. Lets a preference entry be traced back to (and, if needed, reverted from) the exact message that produced it — the MVP's per-session "undo that change" interactions imply this granularity is worth having. |

Still exactly one place the optimizer reads preference data from — `users` still has no
onboarding fields, and the typed `type`/`value` pairs here already double as the durable
record of what onboarding produced, so there's no need for a separate raw-answers dump.

### `sessions` — the optimizer's output

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `task_id` | ObjectId **or null** | **FK** → `tasks._id` | **now nullable.** Null exactly when `type: "fixed"` — a lecture block isn't seeded from a task, it's materialized from `courses.meeting_times` via `enrollments`. |
| `type` | enum | **new** | `"flexible"` (optimizer-placed, has a `task_id`) or `"fixed"` (locked class/recitation block, no `task_id`). Both live in the same collection on purpose: the optimizer already only reads `sessions`, so a hard-constraint block just needs to look like a session the solver can't move, rather than requiring a second collection and a second read path. |
| `start` / `end` | datetime | | unchanged, 15-min aligned |
| `action` | string | **renamed from `goal`** | The concrete instruction shown to the user — e.g. `"Work through 10 practice problems from the study guide"`. Renamed because the frontend already uses "goal" for the course-level target (the thing the progress bar tracks); keeping the old field name would mean two different things called "goal" in the same system. |
| `intensity` | enum | **new** | `"high"` / `"medium"` / `"low"` — per-session cognitive load. Lives on the *session*, not the task, because load isn't constant across a task's sessions (first pass on a problem set is harder than the review pass). This is the signal the optimizer uses to place high-intensity sessions in the user's stated peak-focus window from onboarding — it's not just a display color. |
| `duration_min` | int | **new** | Per-session length. `tasks.est_duration_min` is now the rollup of these, not a literal block length. |
| `locked` | bool | | unchanged meaning — frozen from re-solves. Every `type: "fixed"` session is `locked: true` by definition; a `flexible` session becomes `locked` once committed. |
| `completed` | bool | **new** | Whether the user actually did it. Deliberately separate from `locked` — they answer different questions ("should the solver leave this alone" vs. "did this happen"). A session can be locked and still pending; marking it done doesn't require it to have been locked first. |

### `optimizer_runs`

Unchanged.

### `chat_messages` — new

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `role` | enum | | `"user"` / `"bot"` |
| `text` | string | | |
| `timestamp` | datetime | | |
| `context` | object / null | | `{ task_id?, session_id?, course_id?, topic? }` — set when the message originated from a specific place, e.g. "Ask Buddy about this" on a task, or "Resources" on a topic in Classes. Lets the backend resolve *what* is being discussed without parsing the message text. |

Why a new collection instead of writing straight into `preferences`: not every message
is a scheduling constraint. A "find resources on X" request should never become a
`preferences` entry — it's not an optimizer input, it's a lookup. Keeping the raw
transcript here and the distilled, optimizer-facing takeaways in `preferences` preserves
the v1 rule ("exactly one place the optimizer reads preference data from") while still
giving the sidebar something to render when it's reopened.

---

## Design notes carried over from v1, still true

- Shared vs. per-user split, rolling weekly horizon with 15-minute slots, and the
  onboarding → CP-SAT → chat feedback → `preferences` update → re-solve loop are all
  unchanged. Nothing here touches solver internals — the AI still only ever writes into
  `preferences`.

## Open question worth deciding before this goes further

`tasks.est_duration_min` is now a rollup rather than a ground-truth field. If the
personalization loop wants to refine "how long does this really take" based on
`actual_time_logged_min`, decide whether that refinement writes back down into individual
`sessions.duration_min` values or just adjusts the task-level rollup — that changes who's
allowed to touch a `sessions` document that isn't `locked` yet.
