# MongoDB Schema — Study Buddy

Two groups of collections: **shared/static** (written once by the Canvas/PDF data pipeline, read-only after that) and **per-user** (created at onboarding/enrollment, changes at runtime). The optimizer service only ever touches `tasks`, `preferences`, and `sessions` — syllabus internals never reach it directly.

## Relationship map

```
courses ──────────┐
   │               │
   │ (course_id)   │ (course_id)
   ▼               ▼
syllabus_data   enrollments ── (user_id) ── users
                    │
                    │ seeds
                    ▼
                  tasks ── (user_id, task_id) ── sessions
                    │                               │
                    └── (user_id) ── preferences ───┘
                                       │
                                (user_id)
                                       ▼
                               optimizer_runs
```

---

## Shared / static

### `courses`
One document per course-section, for the semester (Fall 2025 scope only).

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `code` | string | | e.g. `"15-122"` |
| `section` | string | | e.g. `"A"` |
| `name` | string | | |
| `term` | string | | `"F25"` — hardcoded, no other terms |
| `canvas_course_id` | string | | for re-fetching/debugging against Canvas |

### `syllabus_data`
Extracted syllabus content per course. **Loosely typed on purpose** — real syllabi vary a lot in structure course to course, so don't over-constrain this one.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `course_id` | ObjectId | **FK** → `courses._id` | |
| `assignments` | array of `{ name, type, due_date, weight_in_grade }` | | source for seeding per-user `tasks` |
| `topics` | array (flexible) | | for quiz-prep later |
| `grading_breakdown` | object (flexible) | | |
| `raw_text_ref` | string | | pointer to extracted full text, not stored inline |

---

## Per-user

### `users`
Profile info only — anything that becomes an optimizer constraint lives in `preferences`, not here.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `email` | string | | |
| `year` / other profile fields | string | | plain metadata, not optimizer input |

### `enrollments`
Join between a user and the shared course catalog.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `course_id` | ObjectId | **FK** → `courses._id` | |

### `tasks` — the optimizer's main input
Seeded from `syllabus_data.assignments` at enrollment time, then tracked independently per user from there.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `course_id` | ObjectId | **FK** → `courses._id` | |
| `source_assignment` | string | | name of the syllabus assignment this was seeded from |
| `due_at` | datetime | | |
| `est_duration_min` | int | | starts from a heuristic, refined by the personalization loop |
| `splittable` | bool | | can this be broken across multiple sessions? |
| `status` | enum | | `not_started` / `in_progress` / `done` |
| `priority_weight` | float | | feeds the optimizer's objective |
| `actual_time_logged_min` | int / null | | filled in once the user logs time |

### `preferences` — the optimizer's constraint/weight input
Seeded from onboarding answers **and** appended to by AI-driven chat feedback — both are just entries here, distinguished by `source`. This is the schema the AI writes into instead of ever editing solver code directly.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `type` | string | | e.g. `"preferred_hours"`, `"avoid_block"`, `"weight_adjustment"` |
| `value` | object | | shape depends on `type` |
| `weight` | float | | how strongly this influences the objective |
| `source` | enum | | `onboarding` / `chat` |

### `sessions` — the optimizer's output
Replaces plain calendar "events" — carries a goal, not just a label + time block. 15-minute slot alignment, rolling weekly re-solve.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `task_id` | ObjectId | **FK** → `tasks._id` | |
| `start` / `end` | datetime | | 15-min aligned |
| `goal` | string | | e.g. `"Finish problems 1-3"` |
| `locked` | bool | | true once committed/completed — untouched by re-solves |

### `optimizer_runs` — the durable "why" log
One entry per solve, so every scheduling decision is traceable back to the inputs that produced it.

| field | type | key | notes |
|---|---|---|---|
| `_id` | ObjectId | **PK** | |
| `user_id` | ObjectId | **FK** → `users._id` | |
| `timestamp` | datetime | | |
| `inputs_snapshot` | object | | tasks + preferences active at solve time |
| `objective_value` / `best_bound` | float | | used to compute the "% optimized" stat |
| `gap` | float | | |

---

## Design notes (why it's shaped this way)

- **Shared vs. per-user split:** Canvas/PDF scraping runs once per semester, so `courses` and `syllabus_data` are a static catalog every user's `enrollments` point into — never duplicated per user.
- **Rolling weekly horizon, 15-min slots:** the optimizer re-solves one week at a time rather than the whole semester up front, so re-solves stay fast and don't reshuffle already-`locked` sessions. Deadlines further out are still respected via a capacity-reservation constraint, not by scheduling them in detail early.
- **Feedback loop:** onboarding preferences → CP-SAT builds a preliminary schedule → user gives chat feedback → AI writes/updates `preferences` entries (never raw solver code) → optimizer re-solves.
- **No `onboarding_preferences` field on `users`:** anything that's an actual optimizer constraint goes straight into `preferences` with `source: "onboarding"`, so there's exactly one place the optimizer reads preference data from.
