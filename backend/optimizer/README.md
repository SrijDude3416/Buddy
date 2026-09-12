# optimizer

Prototype for the CP-SAT scheduling engine described in `CLAUDE.md`. Working
against `test-data/schedule_test_data.json` (Carlos's own Notion + Calendar
export) rather than real Mongo data, so the pieces here are dependency-free
(no pydantic/FastAPI yet) and easy to read.

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
  function per preference type. This is the entire surface area an AI layer
  would ever write into; nothing here knows or cares that every `Preference`
  in use right now is hand-authored rather than AI- or onboarding-produced.
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

## Known gaps, not yet built

- Exam/fixed-time tasks aren't materialized as locked blocks (see above) --
  the single biggest correctness gap found this round.
- The "hours still owed beyond this window" figure (see `CLAUDE.md`) is only
  a printed report right now, not an actual capacity-reservation constraint
  in the model.
- The four preferences in `tuned` are hand-authored stand-ins, not
  onboarding/chat output -- reasonable starting weights, not validated
  against what Carlos would actually pick for himself.
- Not wrapped as the FastAPI service `CLAUDE.md` calls for; this is still a
  script you run locally.
