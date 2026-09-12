# optimizer

Prototype for the CP-SAT scheduling engine described in `CLAUDE.md`. Working
against `test-data/schedule_test_data.json` (Carlos's own Notion + Calendar
export) rather than real Mongo data, so the pieces here are dependency-free
(no pydantic/FastAPI yet) and easy to read.

**If you're building the AI-facing or FastAPI layer on top of this, start at
[`PREFERENCE_API.md`](../../PREFERENCE_API.md) (repo root), not here.** It's the
self-contained spec for every tool an LLM calls, the exact weight each one maps to
and why, and what's deliberately not exposed. `tool_schemas.json` in this directory
is its paste-ready JSON-Schema companion.

## Setup

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

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
