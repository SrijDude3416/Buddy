# test-data

Sample data for exercising the app against something realistically-shaped, before the
real Canvas/syllabus pipeline exists. Lives at the repo root (not under `/frontend` or
`/backend`) on purpose, so any branch — optimizer, frontend mocks, data-processing —
can read from it without depending on another branch's directory.

## `schedule_test_data.json`

Carlos's own Fall-semester Notion task tracker + Google Calendar class schedule,
pulled by a Claude session with Notion/Calendar access. **Not real pipeline output —
one real student's data, hand-exported, used only as a stand-in for `tasks` +
`courses.meeting_times` shape until the Canvas pipeline produces the real thing.**

Shape (flat JSON, not Mongo documents — no `ObjectId`s, string ids instead):

- `courses[]` — one per class, with a `meeting_times[]` recurring weekly pattern
  (`days`, `start_time`, `end_time`, `location`). Maps to `courses.meeting_times` in
  `SCHEMA.md`, and is exactly what materializes into locked `sessions.type: "fixed"`
  blocks.
- `tasks[]` — one per assignment/reading/quiz, matching the `tasks` collection fields
  (`due_at`, `est_duration_min`, `splittable`, `status`, `course_id` referencing
  `courses[].id`).

Known imperfections, intentional and left in rather than cleaned up:

- `est_duration_is_guess: true` marks tasks where Notion had no duration and one was
  estimated from the task's title/type — treat these as lower-confidence inputs, not
  ground truth, if a consumer wants to distinguish.
- Every task's `notes` field documents exactly what was pulled directly from Notion
  vs. guessed (due *time* especially — Notion often only had a due *date*, or a
  relative note like "before Lecture 9").
- A handful of tasks are already `status: "done"` (completed before this export was
  taken) — useful for exercising "already completed, don't schedule" logic, not just
  the pending-work path.

One deliberate exception to "left in rather than cleaned up": `mf-hw3-due`'s
`est_duration_min` was rescaled from Notion's raw 645 (10.75h, due in 5 days) down to
240. At the real value it single-handedly dominated the whole near-term window — every
*other* task due the same week totaled well under 4h combined — so the demo read as
"the optimizer just spams one assignment" rather than a normal multi-course load. See
that task's own `notes` field for the full before/after; `est_duration_is_guess` was
flipped to `true` on it for the same reason every other rescaled/estimated value in
this file carries that flag — this number no longer traces back to a real Notion pull.

This is throwaway/sample data, not a schema migration target — don't treat its exact
field set as more authoritative than `SCHEMA.md` itself.
