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
- `scheduler.py` -- stage 2: the actual CP-SAT model (placement). Fixed course
  blocks + off-hours + flexible sessions all share one `AddNoOverlap` list, a
  flexible session is an *optional* interval so "couldn't fit" surfaces as an
  unplaced session instead of an infeasible whole-model solve, and there's no
  real `preferences`-driven objective yet -- just a placeholder that maximizes
  sessions placed, tie-broken toward earlier starts.
- `run_prototype.py` -- glue script. `python3 run_prototype.py [window_days]`
  (default 7) prints a report and writes `output_<days>d.json`.
- `schedule_preview.html` -- calendar visualization of a solve, published as
  a Claude artifact. Currently has two solve runs (7-day and 14-day windows)
  baked in as static JSON rather than reading `output_*.json` live -- re-embed
  those `<script type="application/json">` blocks by hand if the model or
  test data changes and the preview needs to reflect it.

## What playing with this surfaced

Real near-term contention barely exists with this test data: only ~4-7 tasks
actually fall due within any single week, so a 7-day rolling window mostly
just shows this week's tasks with nothing else in the picture (correct
behavior, just a thin demo). Widening to 14 days for exploration surfaces a
real problem instead: with no `preferences` yet, the placeholder objective
("place everything, prefer earlier") crams nearly the whole window's work
into day one rather than spreading it out. That's not a solver bug -- it's
exactly what an objective with no real preference weights should do. It's a
concrete argument for building at least one "don't overload a single day"
preference before this goes in front of anyone, rather than treating
preferences as purely a nice-to-have on top of a working placement engine.

## Known gaps, not yet built

- The "hours still owed beyond this window" figure (see `CLAUDE.md`) is only
  a printed report right now, not an actual capacity-reservation constraint
  in the model.
- No preference compiler registry yet -- there's nothing for the AI layer to
  write into, because there's no onboarding/chat flow producing preferences
  for this test data.
- Not wrapped as the FastAPI service `CLAUDE.md` calls for; this is still a
  script you run locally.
