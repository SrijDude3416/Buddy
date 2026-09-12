# optimizer

CP-SAT scheduling engine described in `CLAUDE.md`, plus a real FastAPI service
(`api.py`) wrapping it. Both work against `test-data/schedule_test_data.json`
(Carlos's own Notion + Calendar export) rather than real Mongo data -- the solver
core (`data_loader.py` through `run_prototype.py`) stays dependency-free on
purpose; `api.py`/`api_models.py` are the one place this project takes on
FastAPI/pydantic, because that's what an HTTP boundary actually needs.

**Start at [`PREFERENCE_API.md`](../../PREFERENCE_API.md) (repo root) for the *why*
of every endpoint below** -- every tool an LLM calls, the exact weight each one maps
to and why, and what's deliberately not exposed. This file is the *how to run it*;
that one is the spec it's implementing. `tool_schemas.json` in this directory is the
spec's paste-ready JSON-Schema companion.

## Setup

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the API

```
source .venv/bin/activate
uvicorn api:app --reload --port 8000
```

Loads `test-data/schedule_test_data.json` once at startup (one implicit test
student, in-memory preferences, reset on restart -- see `PREFERENCE_API.md` §2 for
why this is deliberate, not a shortcut). `http://localhost:8000/docs` has the full
interactive Swagger UI. A curl walkthrough of the real tool-calling loop:

```bash
curl -X POST localhost:8000/reset   # clean slate

# Stack up a few preferences fast without waiting ~15s for a solve each time
# (resolve=false is a testing-only escape hatch, not part of the spec):
curl -X POST "localhost:8000/tools/set_daily_workload_limit?resolve=false" \
  -H "Content-Type: application/json" -d '{"minutes_per_day": 240}'
curl -X POST "localhost:8000/tools/protect_time_block?resolve=false" \
  -H "Content-Type: application/json" \
  -d '{"days": ["Fri", "Sat"], "start_time": "19:00", "end_time": "24:00"}'

curl localhost:8000/tools/list_current_preferences   # confirm both are active

# This one resolves for real (~15s) -- the response includes a solve summary:
curl -X POST localhost:8000/tools/set_break_habits \
  -H "Content-Type: application/json" -d '{"break_minutes": 45}'

curl localhost:8000/plan   # the full cached result: every placed/unplaced session
```

`POST /solve` is the other real endpoint -- stateless, takes a complete payload
(courses/tasks/preferences all inline, no reference to the test student), for
whoever's building the Next.js side to call directly. See `PREFERENCE_API.md` §2
for its exact request/response shape.

Every failure mode `PREFERENCE_API.md` §7 promises is real and was verified by
actually calling it, not just implemented and assumed correct: a bad `strength`
enum or malformed time string is a `422` with a field-level message, an ambiguous
`remove_preference` is a `409` with the candidate list, removing something that
isn't active is a `404`, and a `/solve` task referencing a nonexistent `course_id`
is a `422` before any solving starts.

## Files

- `data_loader.py` -- loads the test-data JSON into plain Python objects.
- `decompose.py` -- stage 1 of the two-stage pipeline: task -> sessions.
  Heuristic, not solved (see CLAUDE.md). No real "how do you like to work"
  preference exists yet, so this uses fixed constants -- treat as a
  placeholder, not a decision.
- `preferences.py` -- the preference compiler registry CLAUDE.md calls for:
  a `Preference(type, value, weight)` object plus `reify_window` (a correctly
  bidirectional window-membership helper -- CLAUDE.md specifically flags a
  one-directional version as unsafe for penalty terms) and one compiler
  function per preference type (`preferred_hours`, `daily_load_cap` -- now
  optionally weekday-scoped, `min_gap_between_sessions`, `avoid_block`,
  `spread_multi_session_tasks`, `after_class_bonus`, `max_continuous_work`).
  This is the entire surface area an AI layer would ever write into; nothing
  here knows or cares that every `Preference` in use right now is
  hand-authored rather than AI- or onboarding-produced.
- `scheduler.py` -- stage 2: the actual CP-SAT model (placement). Fixed
  course blocks + off-hours + flexible sessions all share one `AddNoOverlap`
  list, a flexible session is an *optional* interval so "couldn't fit"
  surfaces as an unplaced session instead of an infeasible whole-model
  solve, and the objective is three strictly-scaled tiers: (1) schedule as
  many sessions as possible, (2) satisfy preferences, (3) a tiny tie-break.
- `eval.py` -- turns a solve into a few concrete numbers (busiest day,
  evening-hours adherence, back-to-back gap violations, multi-session tasks
  crammed onto one day) so comparing two preference profiles is a diff
  between two dicts, not eyeballing a calendar.
- `run_prototype.py` -- glue script. `python3 run_prototype.py [window_days]
  [profile]` (defaults: 14, `tuned`) prints a report + eval and writes
  `output_<days>d_<profile>.json`. `PROFILES` holds the hand-authored
  preference sets described below.
- `schedule_preview.html` -- calendar visualization, published as a Claude
  artifact, toggling between the `none` and `tuned` profiles below. Has
  those two runs baked in as static JSON rather than reading `output_*.json`
  live -- re-embed the `<script type="application/json">` blocks by hand if
  the model or test data changes and the preview needs to reflect it.
- `api.py` -- the FastAPI service implementing `PREFERENCE_API.md`: `POST /solve`
  (stateless), the six `/tools/*` endpoints, and `GET /plan`, all against the one
  test student loaded at startup by `data_loader.load_data_preferring_mongo()`
  (Mongo when reachable, `test-data/schedule_test_data.json` as a loud, printed
  fallback otherwise). See "Running the API" above.
- `mongo_loader.py` / `seed_mongo.py` -- the Mongo side of that: `mongo_loader.py`
  reads `courses`/`tasks` out of the real Atlas cluster in SCHEMA.md's actual
  shape (credentials from `backend/.env.local`, not a second `.env` file --
  there's exactly one connection string for this project); `seed_mongo.py` is
  the idempotent, one-time upsert of `test-data/schedule_test_data.json` into
  that shape. Both tag every document `seed_source: "carlos_test_data"` /
  `user_id: "demo-carlos"` so they never collide with `backend/lib/catalog.js`'s
  own unrelated synthetic course catalog living in the same `courses` collection.
- `mongo_state.py` -- the per-user *runtime* state half of the same cluster:
  `save_preferences`/`load_preferences` (the `preferences` collection) and
  `log_optimizer_run` (the `optimizer_runs` "why" log CLAUDE.md describes).
  Deliberately a separate module from `mongo_loader.py` -- read/write, per-user
  state vs. read-only, shared/static catalog. Every call here is a durability
  side-effect wrapped in `preference_pipeline.py`'s `_try()`: it can never turn
  a working chat request into a failed one, only degrade "this survives a
  restart" back to "it doesn't," printed either way.
- `preference_pipeline.py` -- batches the existing `/tools/*` handlers against
  an isolated `PreferenceStore` per request (buddy/'s actual demo entry point:
  `POST /preferences/operations`, `GET /preferences/defaults`) and runs one
  real CP-SAT solve. Persists to Mongo (`mongo_state.py`) only *after* a
  request has already succeeded -- nothing about persistence is part of the
  isolation guarantee that makes a cancelled/errored request leave no
  half-applied preference behind. `GET /preferences/defaults` prefers whatever
  was last saved over the hardcoded 8am-5pm default, so a fresh server start
  or a brand-new browser tab picks up where the last session left off.
- `plan_payload.py` -- translates a real `SolveResult` into the exact
  calendar shape `buddy/`'s React frontend already renders.
- `api_models.py` -- every request/response pydantic model, one file separate
  from the endpoint wiring on purpose (same one-concern-per-file split as the
  rest of this package). Validation here is what produces `PREFERENCE_API.md`
  §7's `422`s -- enum/pattern/range checks plus the one cross-field check
  (`SolveRequest`: every task's `course_id` has to match a real course) that
  pydantic's per-field validators can't express alone.
- `preferences_store.py` -- the first real implementation of `PREFERENCE_API.md`
  §4's persistence model: `WEIGHT_MAP` (§10's strength -> weight table, verbatim),
  the tool-facing-name <-> internal-`Preference.type` mapping, and
  `PreferenceStore`, which knows which types are singletons vs. accumulate-by-scope
  and raises a typed, catchable error (`AmbiguousRemoval`, listing candidates) when
  a removal can't be disambiguated rather than guessing.
- `tool_schemas.json` -- `PREFERENCE_API.md`'s paste-ready JSON-Schema companion
  (Gemini/OpenAI/Claude-compatible function declarations). Not read by `api.py` --
  it's for whatever calls this API with a tool-using model, not for this service
  itself.

## What the preference feedback loop found

Ran `none` (no preferences -- just "schedule everything, prefer earlier")
against the denser Sept-12-to-25 crunch data, then added preferences one
group at a time, re-running and checking `eval.py`'s numbers each time.

**Baseline (`none`) was bad in an extreme, useful way**: it crammed all 900
of a day's available minutes (8am-11pm, zero gaps) into Saturday, spilled
into Sunday, and left the following ten days completely untouched. Only 37%
of work landed in the evening, 28 pairs of sessions butted up against each
other with no gap, and one multi-part task had both its sessions on the same
day. This isn't a demo-friendly failure -- it's what "prefer earlier" alone
always produces once there's more than a day's worth of slack.

**Found and fixed a real bug before trusting any of this**: `decompose.py`
was rounding session durations to the *nearest* 15-minute slot, not up. A
50-minute exam was silently becoming 45 minutes. Fixed to always round up --
overestimating a fixed sitting's time is harmless slack, underestimating one
is a real error.

**Found and fixed a scaling bug that made the first preference profile look
like it did nothing**: the "tiny" tie-break term (`-start`, in 15-minute
slots) was not tiny relative to the preference weights -- it directly fought
an evening-hours preference (a 5pm start scores far worse than 8am on that
term alone) and nearly canceled a daily-load penalty. Rewrote the tie-break
to prefer an earlier *day* (range ~14) instead of the earliest *slot* (range
~1300), which both shrinks its influence by ~90x and removes the perverse
fight with hour-of-day preferences entirely. Worth remembering generally:
a hand-wavy "small" tie-break term needs its actual numeric range checked
against whatever it's supposed to be smaller than, not just eyeballed.

**Four preferences, added together (`tuned` profile), fixed the baseline
completely**, without sacrificing "everything gets scheduled":
- `daily_load_cap` (soft, 240 min/day, weight 15) -- penalizes flexible-work
  minutes over the cap on any single day.
- `preferred_hours` (soft, 17:00-23:00, weight 20) -- rewards sessions whose
  start time falls in the window.
- `min_gap_between_sessions` (hard, 15 min) -- implemented as padded shadow
  intervals used only for the no-overlap constraint; the real
  start/duration/end used for deadlines and output is untouched.
- `spread_multi_session_tasks` (soft, weight 25) -- penalizes two sessions of
  the *same* task landing on the same calendar day.

Result: busiest day dropped from 900 min to 270 min (4.5h), evening
adherence rose from 37% to 90%, back-to-back violations went from 28 to 0,
and same-day-crammed multi-session tasks went from 1 to 0 -- while still
placing all 35 in-scope sessions, same as the baseline. See
`schedule_preview.html` to look at both runs directly.

**A real modeling gap this surfaced, not yet fixed**: `mf-midterm1` and
`mx-exam1` are `splittable: false` tasks with a `due_at`, so the optimizer
treats them exactly like any other short flexible task -- free to move
anywhere before the deadline. In the `tuned` run, "Midterm 1" got scheduled
for 8:15pm on a Sunday four days before the exam, which is meaningless: a
real exam happens at one specific, non-negotiable time, the same way a
lecture does. `splittable: false` only controls session count in
`decompose.py`; it says nothing about whether the *time itself* is a
decision. Fixing this needs a schema answer, not a new preference --
probably: exam-type tasks materialize as locked blocks the same way
`courses.meeting_times` do, rather than entering the optimizer as tasks at
all.

**Gap-percentage sign bug**: also fixed a `(objective - bound) / objective`
formula that's backwards for a maximization problem (the bound is >= the
best solution found until proven optimal, so the gap is `(bound -
objective)`). It only ever looked right before because every prior run
solved to exact `OPTIMAL` (bound == objective); the denser data's `FEASIBLE`
runs would have shown a negative "gap" -- i.e. over 100% optimized -- had
this not been caught.

## Round 2: reverse-engineering a real, human-tuned week

Carlos shared a screenshot of his own actual (long-hand-tuned) weekly
calendar and asked what preferences would be needed to get CP-SAT output
resembling it. Reverse-engineered structure, built it, re-ran.

**What the real calendar showed that the model didn't have:**
- Recurring personal commitments (gym, breakfast/shower, lunch, dinner) that
  aren't tasks at all -- they just sit on the calendar like a locked class.
- Friday and Saturday night are completely off-limits to work, no exceptions.
- Sunday is a real rest day -- much lighter than the daily_load_cap that
  applies every other day, not just "lighter by feel."
- A strong "review shortly after this exact class" pattern -- e.g. Matrices
  lecture at 9am, Matrices note-revision at 10am, same day, every time.
- Titles are instructions ("Study for Recitation 3"), and repeated titles for
  a multi-part task carry no part-count suffix.

**Built to match:**
- `personal_blocks` -- a new `build_and_solve` parameter, hand-authored in
  `run_prototype.py`'s `ROUTINE` list, materialized exactly like
  `courses.meeting_times` (reuses the `MeetingTime` dataclass; its `location`
  field doubles as the block's label).
- `avoid_block` (hard) -- total protection for a weekday-scoped window, used
  for Fri/Sat 7pm-midnight.
- `daily_load_cap` extended with an optional `value["days"]` filter, so a
  much lower Sunday-only cap can stack alongside the normal one.
- `after_class_bonus` -- rewards a session starting within N minutes after
  its *own course's* lecture ends that same day, using `reify_window` against
  each occurrence of that course's meeting time in the window.
- `humanize_title()` in `decompose.py` -- a small template layer ("Recitation
  Quiz 3" -> "Study for Recitation 3", "X Due" -> "Work on X", etc.) standing
  in for SCHEMA.md's real `display_title`. The `(part i/N)` suffix is gone;
  every session of a task now shares one title.

**A real infeasibility this caused, and the actual bug underneath it**:
adding personal blocks made the *whole model* infeasible, not just some
sessions. Root cause: the working-hours boundary (8am-11pm) had been built as
a mandatory blackout *interval* that everything -- not just flexible work --
had to avoid overlapping. That was never wrong before because every fixed
thing so far (classes) happened to fall inside 8am-11pm. Gym at 6:30am broke
that assumption immediately: two mandatory, always-overlapping intervals
(gym vs. the 00:00-08:00 blackout) can never satisfy `AddNoOverlap`. Fixed by
removing the blackout interval entirely and instead putting a direct hard
bound on each *flexible* session's own start/end -- fixed/personal/course
blocks are no longer restricted by time-of-day at all, only by not
overlapping each other or flexible work, which is what "fixed" should have
meant from the start. The `avoid_block` compiler had an identical version of
the same bug (its blackout window reached into the same already-mandatory
territory) and needed the same category of fix.

**Result** (`tuned`, 14-day window, routine blocks present in both runs now
so the baseline comparison is apples-to-apples): busiest day 765min ->
375min, evening adherence 37% -> 63% (lower than the earlier all-evening
run on purpose -- a good chunk of work now happens right after class instead,
which is more realistic, not worse), 0 back-to-back violations, 0 same-day-
crammed tasks, all 35 sessions still placed. See `schedule_preview.html`.

**Compute time** (the other thing asked about this round): tested budgets
from 1s to 20s against this exact model. Quality is already within noise of
final at **1 second** -- objective, sessions placed, busiest-day, and evening
adherence all land in the same range regardless of budget. CP-SAT never
reports strict `OPTIMAL` for a model this size in any of these budgets (it's
always `FEASIBLE`), but the gap stays under 0.01% the entire time, so that's
not a real limitation in practice. The default `max_time_in_seconds=10` in
`scheduler.py` has a lot of headroom in it -- 2-3s would very likely be
indistinguishable for the "re-solve after one chat message" loop CLAUDE.md
describes, though not benchmarked against a harder problem instance yet.

*Follow-up from Round 3, below: that last caveat mattered.* A harder problem
instance did show up (the `max_continuous_work` rule), and headroom
disappeared fast -- the naive version of that one constraint alone pushed a
10s solve out to 60s+. "Not benchmarked against a harder instance yet" was
doing a lot of work in that sentence; don't extrapolate solve-time margin
from one easy model to the next feature added.

## Round 3: two personal rules, review sessions, and course-coded titles

Carlos asked for three more things: class numbers in titles, a dedicated
post-lecture notes-review block, and two firm personal rules -- never work on
one subject for more than an hour, and never go more than two hours without a
real break.

**Titles**: `format_course_code()` (`data_loader.py`) turns `"15151 Math
Foundations"` into `"15-151"`; `decompose_task()` now prefixes every session
title with it, e.g. `"21-241 Study for Recitation 3"`.

**"Never work on one subject for more than an hour"** turned out to already
be exactly what `decompose.py`'s `MAX_SESSION_MIN` controls -- no new
mechanism needed, just changed the constant from 90 to 60. Each single
sitting on one task is already capped there; nothing about switching to a
*different* subject with no gap is restricted by this rule, which matches a
literal reading of "the same subject."

**"Never work without a break for more than two hours"** is a materially
different, harder problem: it's about *any* consecutive run of flexible
work, chained by gaps under 30 minutes, regardless of subject -- a genuine
cumulative/chain constraint, not a per-session cap. New `max_continuous_work`
compiler: for each session, a `streak` variable is the true (uncapped)
cumulative work-minutes ending at it -- either just its own duration, or
whichever other present session chains directly into it (streak + this
session's duration) -- capped by a hard `streak <= 120min` once presence is
accounted for. Deliberately *not* capping the streak variable's own domain to
120: doing that would silently clamp a real violation down to a value that
then passes the check instead of forbidding it, which is the whole point of
the rule.

**A dedicated review session after every lecture**, not just when a real
assignment happens to need one: `generate_review_sessions()` produces a
30-minute "Review Notes" session per lecture occurrence, generated
independently of any real task, with a due time 45 minutes after the lecture
ends -- if it can't land there, it should come back unplaced, not slide to
that evening (see `Session.not_before` below).

**Performance got genuinely bad before it got good, and the fix mattered
more than the feature.** At ~100 candidate sessions (68 real + 32 review),
`max_continuous_work`'s O(n^2) pairwise streak dependency made the model
unable to find even a first feasible solution in 10 seconds (`UNKNOWN`).
Linearizing `_and()`'s AND (three `Add()` calls instead of
`AddMultiplicationEquality`) helped some. The fix that actually mattered:
excluding the 32 review sessions from this specific check -- they're a
light, class-anchored activity, not the grinding work the rule protects
against -- cut candidate pairs enough to get back under 10 seconds with the
*correct* answer (76 of 76 in-scope sessions placed), instead of a fast wrong
one. Lesson for next time a hard constraint is added: **check whether it
found the right answer, not just whether it returned `FEASIBLE` quickly** --
see the next two bugs, both of which were only visible once this constraint
made the model hard enough to expose them.

**Two real bugs found while sanity-checking the result, neither related to
the constraint itself:**
1. When `presence` came back `False`, the `PlacedBlock`'s `kind` field was
   never updated from `"flexible"` to `"unplaced"` before being appended to
   the unplaced list. Every report and `eval.py` filters on
   `kind == "unplaced"`, so a genuinely-lost session just vanished from every
   view instead of showing up as "competed and lost" -- exactly the failure
   mode CLAUDE.md's "worth surfacing, not hiding" principle is about. Never
   caught before because every prior run happened to place everything it
   attempted; this round's harder model finally produced real losses to hide.
2. A review session's earliest-start bound (`not_before`, new field on
   `Session`) was converted to a slot index with the same `slot_of()` used
   for deadlines -- which *floors*. A lecture ending at 20:20 floors to the
   20:15 slot, so the review session could start 5 real minutes before the
   lecture it was reviewing had even ended. Needed a separate `slot_of_ceil()`
   for earliest-start bounds specifically -- the mirror image of why
   durations round up (`decompose.py`) rather than to nearest: flooring a
   deadline is conservative (never allows running late), but flooring an
   earliest-start bound is not (it allows starting early). Verified by
   checking all 26 placed review sessions actually start at or after their
   own lecture's end.

**Result** (`tuned`, 14-day window): 70 of 76 in-scope sessions placed (6
review sessions lost the squeeze -- an honest, expected outcome now that the
kind-mislabeling bug is fixed, not a hidden one), busiest day 765min ->
390min, 0 back-to-back violations, and both new hard rules verified against
the actual output at zero violations. See `schedule_preview.html`.

## Round 4: urgency, and the two-hour rule going soft

Carlos flagged two things after looking at Round 3's output: same-course
tasks getting worked back-to-back regardless of how urgent they actually
were, and -- concretely -- a huge, imminent assignment (HW3, 10.75 hours,
due inside a week) getting interleaved with unrelated reading due a week
later instead of getting knocked out first. He also asked to replace the
hard two-hour-without-a-break rule with something softer: minimize the
longest unbroken stretch, rather than forbid exceeding a fixed number.

**`urgency_priority`, a new preference**: rewards a session starting earlier
in proportion to its own task's *real* urgency -- remaining work (minutes)
per hour of runway until the deadline, a "critical ratio"-style score
computed once in Python (`scheduler.py`, from the actual `Task` list, not
per-session) and looked up per session in the compiler. HW3's score comes
out roughly 30x a typical distant reading's, so it isn't just "prefer
earlier" applied to everything -- it's a real gradient by actual stakes.

**First attempt reintroduced the exact bug this journal already has a name
for.** The initial version rewarded earliness via `-start` (the session's
absolute 15-minute slot), same mistake as the original day-one-cramming
tie-break two rounds ago, just in a new preference. Consequence this time
was worse than cosmetic: a single urgent session's reward could exceed
`PRESENCE_WEIGHT` itself, meaning the solver would rather leave some
*unrelated* session completely unplaced than accept a slightly-later start
for an urgent one -- a genuinely broken tier order (tier 2 overriding tier
1). Sessions placed dropped from 70 to 61 before this was caught. Fixed the
same way as before: reward `-day` (range ~14) instead of `-start` (range
~1300), which keeps even a very large urgency score safely inside tier 2.
**General lesson, now proven true twice:** any objective term built from a
session's own `start`/`minute_of_day` needs its actual numeric range sanity
checked against `PRESENCE_WEIGHT`, every single time, not just the first.

**`max_continuous_work` rewritten from a hard cap to a soft minimize.** Same
streak-chain machinery as before (still excluding review sessions for
cost), but instead of `streak[i] <= cap` as a hard constraint, `max_streak =
max(all streaks)` becomes an objective term the solver minimizes -- default
break threshold raised to 45 minutes per Carlos's suggestion. This is a
better fit for what's actually wanted: an absolute cap can only ever satisfy
itself by refusing to place a session outright when a big deadline
genuinely needs a long push, which is worse than occasionally allowing one.

**The weight needed real tuning, not a guess.** Tried 20, 60, 120: the worst
streak stayed around 210-240 minutes regardless -- urgency and the
after-class bonus simply won every tradeoff against a soft goal that weak.
500 brought it to 120; 1000 to 90-150 (run-to-run variance -- see below)
with *zero* cost to sessions placed or to urgency's own job (HW3 still
finished a day-plus early). 3000 started measurably costing something real:
HW3's last session got pushed to right before its own deadline instead of
comfortably ahead of it. Landed on 1000 -- inside the range that has real
teeth without eating the thing it's trading off against.

**A genuine, not-fully-resolved finding: solve-time variance got worse.**
Nine preferences deep, the exact same weights produced meaningfully
different results a few seconds apart -- a 210-minute worst streak at one
budget, 90 minutes at another, CP-SAT's own gap sitting around 0.1-0.3%
rather than the near-zero this prototype saw with fewer preferences active.
Bumped the default `max_time_in_seconds` from 10 to 15, which helps but
doesn't eliminate this. Don't treat any single run's exact numbers (busiest
day, worst streak) as precise -- they're representative, not deterministic,
at the current preference count and time budget.

**Still open**: the same-course-adjacency complaint may be partly explained
by legitimate urgency (a course with its own imminent deadline pressure
naturally producing several of its own sessions close together is arguably
correct, not a bug), but it hasn't been re-examined carefully against the
urgency fix yet -- worth another look at the actual output before deciding
whether a dedicated same-course-spacing preference is still needed on top.

## Round 5: what happens off this machine

Prompted by "would this look bad hosted somewhere, not run locally" --
`scheduler.py` hardcoded `solver.parameters.num_search_workers = 8`, which
happens to be exactly this dev machine's core count (an Apple M2, checked via
`sysctl`), not a number anyone actually chose. CP-SAT's parallel search only
gets real speedup from workers that map to real cores; a typical cheap cloud
tier doesn't have 8. Rather than guess what that means, measured it directly
-- `num_search_workers` is now a real parameter (`None` -> `os.cpu_count()`)
instead of a hardcoded 8, and here's what the same `tuned` profile / same
test data produces at 1 and 2 workers, standing in for "a cheap shared vCPU
tier" and "a modest 2-vCPU tier":

| workers | budget | status | placed | gap |
|---|---|---|---|---|
| 8 (this machine) | 15s | FEASIBLE | 70 | 0.18% |
| 2 | 10s | FEASIBLE | 69 | 1.81% |
| 2 | 15s | FEASIBLE | 70 | 0.25% |
| 1 | 15s | FEASIBLE | 66 | 6.42% |
| 1 | 30s / 45s / 60s | FEASIBLE | 66 (all three) | 6.35% (all three) |

Two real findings, not one:

- **2 workers is nearly indistinguishable from 8** at the same 15s budget --
  0.25% gap vs. 0.18%, both placing all 70 sessions. A modest 2-vCPU host
  costs almost nothing here.
- **1 worker is a genuinely different, worse regime -- and more time does not
  fix it.** 30s, 45s, and 60s all produced the *identical* result (66 placed,
  6.35% gap) as 15s did. This isn't "slower," it's stuck: single-threaded
  CP-SAT search settled into a local optimum that parallel portfolio search
  (even just 2 workers trying different strategies) escapes and pure serial
  search doesn't, no matter how long it runs. 4 fewer sessions placed is a
  real, visible quality regression a demo audience would actually notice, not
  a rounding difference.
- This test's "1 worker" is also a best-case stand-in for "1 core" -- it had
  one full, uncontended CPU core the whole time. Several free-tier hosts
  (Render's free web service is 0.1 CPU) give a *fraction* of a core, not a
  whole one; that would plausibly be worse than the 6.35%/66-placed number
  above, not the same.

**Practical takeaway**: deployment doesn't need to be expensive, but it does
need to specifically guarantee at least 2 real vCPUs -- check that explicitly
when picking a plan/tier rather than taking whatever a free default gives.
That's a cheap, common tier on Railway/Render/Fly.io, not a premium one.

## Round 6: warm-starting, symmetry, and stopping when it's proven good enough

Prompted by "make the optimizer run WAY faster" -- three changes, all in
`scheduler.py`, none touching what a solve can *decide*, only how it searches
for it and when it's allowed to stop:

**1. Hint the previous solution.** `CLAUDE.md`'s own core loop is chat
feedback -> new preference -> re-solve, and every re-solve after the first is
almost always a small perturbation of a schedule that already exists. Every
solve used to start cold anyway. `build_and_solve` now takes
`hint_placements: list[PlacedBlock]`, and calls `model.AddHint` on each
flexible session's `start`/`presence` (and the meal-window/windowed-commitment
`start` vars) wherever a previous placement is still inside that session's
current bounds -- not a constraint, just an incumbent CP-SAT is free to move.
`preference_pipeline.py`'s `apply_and_solve` builds this from the exact same
`mongo_state.load_plan_cache()` read that already feeds `locked_sessions` for
past-preservation, just without that loop's `start < now` filter -- the
already-past sessions get excluded from this solve's own decomposition
anyway, so re-hinting them is harmless, not wasted effort. A hint that no
longer fits (a new preference shrank the window it used to sit in) is dropped
outright rather than clamped -- CP-SAT rejects an invalid hint wholesale, so
handing it a bogus one is worse than handing it none.

Measured directly: an identical cold-vs-hinted re-solve of the same 14-day
window went from ~11.05s to ~6.87s; a perturbed re-solve (a new preference
added on top) went from ~11.76s cold to ~7.22s hinted, both landing OPTIMAL at
essentially the same objective value. Through the real live path
(`/preferences/operations`, Mongo-backed, the one `buddy/`'s chat demo
actually calls), once a cached plan exists a re-solve after a real tool call
(`set_task_spacing`) came back in **0.07s** with a 0.017% gap -- not the
15-second budget every chat message used to pay.

**2. Break same-task symmetry.** `decompose.py` splits a task into fully
interchangeable equal-length chunks (`hw3__s1..s8`: same title, same
duration, same due date). Nothing in the model distinguished chunk 3 from
chunk 6 except its label, so the search space included every one of the 8!
ways to assign them to the same slots as if they were meaningfully different
candidates. Two adjacent-pair constraints per task, added right after the
flexible-session loop -- keep whichever chunks are present in `decompose.py`'s
own index order, and require front-to-back fill (a later chunk's presence
implies the one before it is present) -- collapse that whole permutation group
down to one. Neither constraint says anything about *where* a chunk lands,
only which one counts as "first," so it composes with
`spread_multi_session_tasks` instead of contradicting it.

**3. Stop at a provable gap, not always the full budget.**
`solver.parameters.relative_gap_limit` was never set, so every solve ran the
complete `max_time_in_seconds` even after finding (and being able to prove)
a near-optimal answer early. Now set to 0.005 (0.5%, overridable via
`BUDDY_SOLVE_GAP`) -- Round 5's own table above already showed real 15s runs
landing 0.18-0.25% gaps on this data, so 0.5% is a real, frequently-hit
stopping point, not a number that never fires. A genuinely hard week that
can't prove under 0.5% in time still runs the full budget exactly as before --
this only ever makes an *easy* solve faster, it never trades away quality on
a hard one. It's also the philosophically honest choice for a product whose
whole pitch is showing a real "% optimized" number (`CLAUDE.md`): stopping at
a provable bound is a legitimate claim, not a fudged early exit.

Measured directly (same 14-day window, same `tuned` profile, cold, no hints):
before this change, 15.24s, status FEASIBLE, gap ~0.09%. After: 9.84s, status
OPTIMAL (i.e. within the 0.5% target), same 74 flexible sessions placed / 26
unplaced -- no change in what got scheduled, just how long it took to become
confident enough to stop looking for something marginally better.

**A real, unrelated bug found while load-testing this, not fixed here**:
adding an `avoid_block` preference whose span fully covers a day's
`meal_window` (e.g. protecting Friday 17:00-20:00 on top of the default
17:30-20:00 dinner window) makes the *entire* solve INFEASIBLE, not just that
one meal -- the same "two mandatory intervals overlap" trap `CLAUDE.md`
already documents for course-vs-routine blocks, just not yet handled for
avoid_block vs. meal_window/commitment. Reproduced with a cold solve, no
hints involved, so this is pre-existing and orthogonal to the changes above.
Flagged as a follow-up task, not fixed in this round.

## Known gaps, not yet built

- Exam/fixed-time tasks aren't materialized as locked blocks (see above) --
  the single biggest correctness gap found across both rounds.
- The "hours still owed beyond this window" figure (see `CLAUDE.md`) is only
  a printed report right now, not an actual capacity-reservation constraint
  in the model.
- The `tuned` preferences (now nine, including the personal-block routine)
  are hand-authored stand-ins, not onboarding/chat output -- reasonable
  starting weights and a real reverse-engineered routine, but not validated
  against a second real week or against what Carlos would pick if actually
  asked the onboarding questions.
- `max_continuous_work` is O(sessions^2). Fine at ~68 sessions with review
  sessions excluded, but will need an actual algorithmic fix (not another
  ad hoc exclusion) before this scales to a real semester's worth of tasks
  per user, or to running this check across multiple preferences that each
  want their own O(n^2) pass.
- `ROUTINE` (gym/meals) is a single hardcoded list for one person -- the real
  version is per-user data from CLAUDE.md's "outside commitments" onboarding
  question, not a constant in `run_prototype.py`.
- Not wrapped as the FastAPI service `CLAUDE.md` calls for; this is still a
  script you run locally.
