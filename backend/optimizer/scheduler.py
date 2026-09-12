"""
Stage 2 of the two-stage pipeline: placement, via CP-SAT.

Core mechanics, matching CLAUDE.md's "Scheduling engine (CP-SAT)" section:
  - Everything (class blocks, off-hours, flexible sessions, and any
    `locked_sessions` a caller wants preserved verbatim from a prior solve)
    is one shared list of intervals; AddNoOverlap over that list is the only
    overlap rule. This is why `locked_sessions` exists as a parameter here
    rather than a Python-side merge after two separate solves: CP-SAT's own
    no-overlap guarantee only ever covers the intervals actually IN one
    model. Two independently-solved session sets, concatenated afterward,
    have no such guarantee against each other -- found the hard way (see
    preference_pipeline.py's git history for the bug this replaced).
  - A flexible session's start is domain-bounded by its own deadline.
  - Flexible sessions are OPTIONAL intervals (a presence bool each) rather
    than mandatory, so "can't fit everything" surfaces as a small set of
    unplaced sessions in the result instead of an all-or-nothing infeasible
    solve -- CLAUDE.md's "worth surfacing, not hiding" applies to individual
    sessions, not the whole run.
  - The objective has three tiers, in strictly descending scale so a lower
    tier can never outweigh a higher one: (1) PRESENCE_WEIGHT * sessions
    scheduled -- always place as much as possible first; (2) preferences,
    compiled via preferences.py's registry, each an honest CLAUDE.md-style
    typed (type, value, weight) preference; (3) a tiny -start term, just to
    keep solves deterministic when preferences leave genuine ties, not to
    drive behavior on its own (that was tier 2's old job before real
    preferences existed -- see git history for what that looked like and
    why it produced a bad schedule).
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, time

from ortools.sat.python import cp_model

from data_loader import ScheduleData, WEEKDAY_ABBR, MeetingTime
from decompose import Session, decompose_all, generate_review_sessions, SLOT_MINUTES
from preferences import Preference, SessionCtx, compile_all

DAY_START = time(8, 0)   # earliest an hour is ever "available" for anything
DAY_END = time(23, 0)    # latest

SLOTS_PER_DAY = 24 * 60 // SLOT_MINUTES  # 96 at 15-min resolution

PRESENCE_WEIGHT = 10_000_000  # dominates every preference term; see module docstring
PREF_SCALE = 100  # margin of safety so tier 2 reliably dominates tier 3's tie-break


def _time_to_slot_of_day(t: time) -> int:
    return (t.hour * 60 + t.minute) // SLOT_MINUTES


def _time_to_slot_of_day_ceil(t: time) -> int:
    # Mirrors slot_of_ceil() below, in time-of-day terms rather than
    # absolute datetime. Needed for a LOCKED commitment's end time -- it
    # becomes a real, mandatory no-overlap interval (like a fixed course
    # block), and flooring its end under-reserves it the same way CLAUDE.md
    # already documents happened once with class end times: a locked
    # commitment ending at, say, 19:50 must reserve through slot 80 (20:00),
    # not slot 79 (19:45), or a freshly-placed session could legally start
    # in the 10 real minutes the floored version would leave uncovered.
    return math.ceil((t.hour * 60 + t.minute) / SLOT_MINUTES)


def _slugify(name: str) -> str:
    """User-provided commitment name -> a safe id fragment. Lowercased and
    collapsed so "Club Meeting" and "club   meeting" produce the same id
    (matters for locked_sessions matching across solves -- see the
    windowed-commitment loop)."""
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_") or "commitment"


@dataclass
class PlacedBlock:
    id: str
    task_id: str | None
    course_id: str | None
    title: str
    kind: str  # "fixed" | "flexible" | "unplaced"
    start: datetime | None
    end: datetime | None


@dataclass
class SolveResult:
    status_name: str
    objective_value: float | None
    best_bound: float | None
    placed: list[PlacedBlock]
    unplaced: list[PlacedBlock]
    locked_ids: frozenset[str] = frozenset()  # which of `placed` came in via locked_sessions, not this solve


def build_and_solve(
    data: ScheduleData,
    window_start: datetime,
    window_days: int,
    preferences: list[Preference] = (),
    personal_blocks: list[MeetingTime] = (),
    locked_sessions: list[PlacedBlock] = (),
    hint_placements: list[PlacedBlock] = (),
    now_slot: int = 0,
    max_time_in_seconds: float = 15.0,  # bumped from 10 -- see README.md's "Round 4" on solve-time variance
    relative_gap_limit: float = 0.005,  # stop as soon as CP-SAT can PROVE it's within 0.5% of optimal; see the solver-setup comment below
    num_search_workers: int | None = None,  # None -> os.cpu_count(); see README.md's "Round 5" before hardcoding this
) -> SolveResult:
    total_slots = window_days * SLOTS_PER_DAY
    window_end = window_start + timedelta(days=window_days)

    def slot_of(dt: datetime) -> int:
        return int((dt - window_start).total_seconds() // (SLOT_MINUTES * 60))

    def slot_of_ceil(dt: datetime) -> int:
        # For an EARLIEST-start bound, flooring is unsafe: a lecture ending
        # at 20:20 floors to the 20:15 slot, letting a "not before" session
        # start 5 real minutes before the lecture is actually over. Ceiling
        # is the conservative direction here, the mirror of why durations
        # round up elsewhere (decompose.py) rather than to nearest.
        return math.ceil((dt - window_start).total_seconds() / (SLOT_MINUTES * 60))

    model = cp_model.CpModel()
    all_intervals: list[cp_model.IntervalVar] = []

    # NOTE: "working hours" (day_start_slot/day_end_slot below) used to be a
    # mandatory blackout INTERVAL that everything had to avoid overlapping.
    # That's wrong: a real fixed commitment (gym at 6:30am, dinner at 6pm)
    # can legitimately sit outside 8am-11pm -- it's only FLEXIBLE work that
    # should be confined there. Two mandatory intervals that overlap (gym
    # vs. the old 00:00-08:00 blackout) made the whole model infeasible the
    # moment a routine block existed outside the window. Fixed below: each
    # flexible session gets a direct hard bound on its own start/end instead
    # (see the flexible-session loop), and fixed/personal/course blocks are
    # never restricted by time-of-day at all -- only by AddNoOverlap against
    # each other and against flexible sessions.
    day_start_slot = _time_to_slot_of_day(DAY_START)
    day_end_slot = _time_to_slot_of_day(DAY_END)

    # --- Fixed course blocks, materialized from courses.meeting_times for
    # every date in the window that matches. No task_id: these aren't tasks.
    # Also tracks each course's lecture end times, so a preference can later
    # reward flexible work landing shortly after its own class.
    placed_fixed: list[PlacedBlock] = []
    course_lecture_ends: dict[str, list[int]] = {}
    for day in range(window_days):
        date = (window_start + timedelta(days=day)).date()
        weekday_abbr = WEEKDAY_ABBR[date.weekday()]
        for course in data.courses.values():
            for mt in course.meeting_times:
                if weekday_abbr not in mt.days:
                    continue
                start_dt = datetime.combine(date, time.fromisoformat(mt.start_time), tzinfo=window_start.tzinfo)
                end_dt = datetime.combine(date, time.fromisoformat(mt.end_time), tzinfo=window_start.tzinfo)
                # End rounds UP (slot_of_ceil), not down: a 50-minute class
                # (15151 Math Foundations, e.g. 17:00-17:50) doesn't divide
                # evenly into 15-minute slots, and flooring the end -- as
                # this line did until it was caught -- silently reserves
                # only 45 of those 50 real minutes in the no-overlap slot
                # grid. Nothing exposed the gap until something else could
                # legally start at exactly that floored boundary (a meal
                # window landing at 17:45, 5 real minutes before the class
                # in this room actually let out) -- same mirror-image lesson
                # already applied to a review session's not_before bound
                # (CLAUDE.md), just never applied to a mandatory block's own
                # end before now. Start still floors -- floor is the safe
                # direction there (reserves at-or-before the true start,
                # never after it).
                s, e = slot_of(start_dt), slot_of_ceil(end_dt)
                iv = model.NewIntervalVar(s, e - s, e, f"fixed_{course.id}_{day}_{mt.start_time}")
                all_intervals.append(iv)
                placed_fixed.append(
                    PlacedBlock(
                        id=f"fixed_{course.id}_{day}_{mt.start_time}",
                        task_id=None,
                        course_id=course.id,
                        title=course.name,
                        kind="fixed",
                        start=start_dt,
                        end=end_dt,
                    )
                )
                course_lecture_ends.setdefault(course.id, []).append(e)

    # Course blocks are already materialized above, and both they and the
    # routine blocks below are CONSTANT intervals. AddNoOverlap over two
    # constants that overlap doesn't shift one out of the way -- it makes the
    # entire model infeasible, exactly the trap this file's NOTE above
    # describes for the old working-hours blackout. That stayed invisible while
    # courses came from test-data (hand-chosen never to clash with the routine)
    # and became reachable the moment real catalog class times arrived: a
    # 12:00-13:20 lecture against a 12:00-12:45 lunch lost the whole schedule,
    # not the lunch. A class is the genuinely immovable one of the pair, so the
    # routine block yields to it.
    course_spans = [(b.start, b.end) for b in placed_fixed]

    def clashes_with_class(start_dt, end_dt) -> bool:
        return any(start_dt < c_end and c_start < end_dt for c_start, c_end in course_spans)

    # --- Personal routine blocks (gym, ...): immovable the same way a class
    # is, just not tied to a course. Not a `courses.meeting_times` -- this is
    # what CLAUDE.md's onboarding "outside commitments" question is meant to
    # feed, hand-authored here since that flow doesn't exist yet. Meals used
    # to be here too; they're `meal_window` preferences now (see below),
    # genuinely movable within a bounded range instead of an exact time.
    for day in range(window_days):
        date = (window_start + timedelta(days=day)).date()
        weekday_abbr = WEEKDAY_ABBR[date.weekday()]
        for i, block in enumerate(personal_blocks):
            if weekday_abbr not in block.days:
                continue
            start_dt = datetime.combine(date, time.fromisoformat(block.start_time), tzinfo=window_start.tzinfo)
            end_dt = datetime.combine(date, time.fromisoformat(block.end_time), tzinfo=window_start.tzinfo)
            if clashes_with_class(start_dt, end_dt):
                continue  # you can't be at the gym while you're in a lecture
            s, e = slot_of(start_dt), slot_of_ceil(end_dt)  # end rounds up -- see the fixed-course-block loop's comment above
            iv = model.NewIntervalVar(s, e - s, e, f"routine_{i}_{day}")
            all_intervals.append(iv)
            placed_fixed.append(
                PlacedBlock(
                    id=f"routine_{i}_{day}",
                    task_id=None,
                    course_id=None,
                    title=block.location or "Personal",  # location field reused as the label
                    kind="fixed",
                    start=start_dt,
                    end=end_dt,
                )
            )

    # --- Locked commitments: a user-named, day-scoped personal commitment
    # (gym, club meetings, ...) pinned to an EXACT time -- read directly from
    # `preferences` (type == "commitment", mode == "locked"), same reason
    # meal_window/windowed commitments are (see below): handled outside
    # compile_all()'s registry. Otherwise identical in kind to a personal
    # routine block above -- immovable, no decision variable -- except it's
    # genuinely data-driven (a real preference someone set via chat) rather
    # than a hardcoded MeetingTime, and deliberately does NOT get
    # clashes_with_class's silent skip: a user who explicitly locked
    # something meant it as a hard commitment, the same as protect_time_block
    # already is: a real conflict should surface as INFEASIBLE, not vanish
    # without telling anyone.
    for pref in preferences:
        if pref.type != "commitment" or pref.value.get("mode") != "locked":
            continue
        name = pref.value["name"]
        days_wanted = set(pref.value.get("days") or WEEKDAY_ABBR)
        lo = _time_to_slot_of_day(time.fromisoformat(pref.value["start"]))
        hi = _time_to_slot_of_day_ceil(time.fromisoformat(pref.value["end"]))
        if hi <= lo:
            continue
        slug = _slugify(name)
        for day in range(window_days):
            date = (window_start + timedelta(days=day)).date()
            weekday_abbr = WEEKDAY_ABBR[date.weekday()]
            if weekday_abbr not in days_wanted:
                continue
            base = day * SLOTS_PER_DAY
            block_id = f"commitment_{slug}_{day}"
            iv = model.NewIntervalVar(base + lo, hi - lo, base + hi, block_id)
            all_intervals.append(iv)
            placed_fixed.append(
                PlacedBlock(
                    id=block_id, task_id=None, course_id=None, title=name, kind="fixed",
                    start=window_start + timedelta(minutes=(base + lo) * SLOT_MINUTES),
                    end=window_start + timedelta(minutes=(base + hi) * SLOT_MINUTES),
                )
            )

    # --- Locked sessions: prior placements (typically "already in the past
    # by now") a caller wants preserved verbatim -- treated exactly like a
    # fixed course block, a mandatory interval in the SAME AddNoOverlap pool,
    # so CP-SAT itself guarantees no freshly-placed session can ever collide
    # with one. Kind is preserved as given (a locked "flexible" session still
    # reports kind="flexible" -- it renders like any other study session, it
    # just isn't up for renegotiation this solve) -- only the id is tracked
    # separately, so callers can tell "was this actually decided this solve."
    locked_ids: set[str] = set()
    for b in locked_sessions:
        if b.start is None or b.end is None:
            continue
        if not (window_start <= b.start < window_end):
            continue  # outside this window entirely; not this solve's concern
        s, e = slot_of(b.start), slot_of(b.end)
        if e <= s:
            continue
        iv = model.NewIntervalVar(s, e - s, e, f"locked_{b.id}")
        all_intervals.append(iv)
        placed_fixed.append(
            PlacedBlock(id=b.id, task_id=b.task_id, course_id=b.course_id,
                        title=b.title, kind=b.kind, start=b.start, end=b.end)
        )
        locked_ids.add(b.id)

    # --- Solution hints: warm-start CP-SAT from wherever the PREVIOUS solve
    # (typically still-in-the-future sessions from the cached plan a chat
    # message is about to nudge) put things, via model.AddHint. This is
    # different from locked_sessions above -- a hint is not a constraint,
    # CP-SAT is free to move a hinted session anywhere the model actually
    # prefers; it just gets to START its search from a near-feasible,
    # near-optimal incumbent instead of from nothing. CLAUDE.md's core loop
    # is chat feedback -> new preference -> re-solve, and each re-solve is
    # almost always a small perturbation of a schedule that already exists
    # -- re-deriving the whole week from scratch every message wastes the
    # solve-time budget on rediscovering structure it already found last
    # time. Keyed by the same placed-block id every other id-based lookup in
    # this file uses (session id / meal_{meal}_{day} / commitment_{slug}_{day}),
    # so it lines up with session_vars/meal_vars/commitment_vars without any
    # extra bookkeeping. A hint whose id doesn't exist in this solve (task
    # completed, preference removed the window it lived in, etc.) is simply
    # never looked up -- AddHint is only ever called for a var that actually
    # gets created below, and a stale/out-of-bounds hint is dropped rather
    # than passed to CP-SAT (see each call site) -- an invalid hint is worse
    # than no hint, since CP-SAT spends time validating and discarding it.
    hint_by_id: dict[str, PlacedBlock] = {b.id: b for b in hint_placements if b.start is not None}

    # --- Meal windows: a `meal_window` preference (value: {meal, start, end,
    # duration_minutes}) is genuinely different from every other preference
    # type here -- not a SessionCtx-scoped reward/penalty term compiled via
    # preferences.py's registry, but a mandatory interval whose SOLVED start
    # time needs extracting back out after the solve to render as a real
    # calendar block. The registry's compile_all() contract (a list of
    # (weight, expr) objective terms) has no way to hand that back, so this
    # is handled directly here instead -- still a real, hand-written,
    # deterministic piece of code turning one (type, value) preference into
    # CP-SAT variables, same boundary CLAUDE.md's "AI never touches solver
    # code" describes, just not routed through compile_all().
    #
    # Meals used to be exact-time ROUTINE entries (immovable, same as a
    # lecture). Now they're a mandatory interval free to land ANYWHERE
    # within [start, end) each day, `duration_minutes` long -- a decision
    # variable, not a fixed time nobody actually chose. One window applies
    # to every day in the range; a weekday-vs-weekend split (meals used to
    # have one) isn't modeled -- a deliberate simplification, not an oversight.
    MEAL_LABELS = {"breakfast": "Breakfast & Shower", "lunch": "Lunch", "dinner": "Dinner"}
    meal_vars: dict[str, tuple[cp_model.IntVar, cp_model.IntVar]] = {}
    for pref in preferences:
        if pref.type != "meal_window":
            continue
        meal = pref.value["meal"]
        lo = _time_to_slot_of_day(time.fromisoformat(pref.value["start"]))
        hi = _time_to_slot_of_day(time.fromisoformat(pref.value["end"]))
        duration_slots = pref.value["duration_minutes"] // SLOT_MINUTES
        if hi - lo < duration_slots:
            continue  # window too narrow for its own duration -- nothing sane to place
        for day in range(window_days):
            block_id = f"meal_{meal}_{day}"
            if block_id in locked_ids:
                continue  # already decided by a prior solve; see the locked_sessions loop above
            base = day * SLOTS_PER_DAY
            start_lo, start_hi = base + lo, base + hi - duration_slots
            start = model.NewIntVar(start_lo, start_hi, f"mealstart_{meal}_{day}")
            end = model.NewIntVar(base + lo + duration_slots, base + hi, f"mealend_{meal}_{day}")
            iv = model.NewIntervalVar(start, duration_slots, end, block_id)
            all_intervals.append(iv)
            meal_vars[block_id] = (start, end)
            if hint := hint_by_id.get(block_id):
                hint_start = slot_of(hint.start)
                if start_lo <= hint_start <= start_hi:
                    model.AddHint(start, hint_start)

    # --- Windowed commitments: the other half of `commitment` preferences
    # (mode == "windowed") -- day-scoped, same mandatory-but-movable
    # treatment as meal windows just above (mirrors that block closely on
    # purpose; not refactored into one shared helper, matching this file's
    # own existing precedent of fixed-course-blocks vs personal-routine-
    # blocks staying two similar-but-separate loops rather than one merged
    # abstraction). `name` is free text, not a fixed enum like `meal` --
    # `_slugify` turns it into a safe, stable id fragment so the same
    # commitment gets the same ids across solves (needed for locked_ids to
    # correctly recognize "this exact occurrence was already decided").
    commitment_vars: dict[str, tuple[cp_model.IntVar, cp_model.IntVar]] = {}
    commitment_titles: dict[str, str] = {}
    for pref in preferences:
        if pref.type != "commitment" or pref.value.get("mode") != "windowed":
            continue
        name = pref.value["name"]
        slug = _slugify(name)
        days_wanted = set(pref.value.get("days") or WEEKDAY_ABBR)
        lo = _time_to_slot_of_day(time.fromisoformat(pref.value["start"]))
        hi = _time_to_slot_of_day(time.fromisoformat(pref.value["end"]))
        duration_slots = pref.value.get("duration_minutes", 60) // SLOT_MINUTES
        if hi - lo < duration_slots:
            continue  # window too narrow for its own duration -- nothing sane to place
        commitment_titles[f"commitment_{slug}"] = name
        for day in range(window_days):
            date = (window_start + timedelta(days=day)).date()
            weekday_abbr = WEEKDAY_ABBR[date.weekday()]
            if weekday_abbr not in days_wanted:
                continue
            block_id = f"commitment_{slug}_{day}"
            if block_id in locked_ids:
                continue  # already decided by a prior solve; see the locked_sessions loop above
            base = day * SLOTS_PER_DAY
            start_lo, start_hi = base + lo, base + hi - duration_slots
            start = model.NewIntVar(start_lo, start_hi, f"commitstart_{slug}_{day}")
            end = model.NewIntVar(base + lo + duration_slots, base + hi, f"commitend_{slug}_{day}")
            iv = model.NewIntervalVar(start, duration_slots, end, block_id)
            all_intervals.append(iv)
            commitment_vars[block_id] = (start, end)
            if hint := hint_by_id.get(block_id):
                hint_start = slot_of(hint.start)
                if start_lo <= hint_start <= start_hi:
                    model.AddHint(start, hint_start)

    # --- Flexible sessions, decomposed from not-done tasks. Optional so an
    # individual session can come back "unplaced" instead of the whole solve
    # failing. decompose_all/generate_review_sessions are pure functions of
    # the task/course data, not of any prior solve -- they'd happily
    # regenerate a session whose id is already locked above. Excluded here,
    # not given a fresh CP-SAT variable: it's already decided.
    sessions = [
        s for s in decompose_all(data.tasks, data.courses)
        + generate_review_sessions(data.courses, window_start, window_days)
        if s.id not in locked_ids
    ]

    # Urgency per task ("critical ratio"-style): remaining work per hour of
    # runway until due. A task's sessions all share one due_at, so summing
    # over every session with this task_id (in-window or not -- a task is
    # never split across both) gives its true total remaining work. Review
    # sessions are excluded; their own not_before/due_at already pin them
    # tightly to right-after-class, they don't need urgency weighting too.
    task_total_minutes: dict[str, int] = {}
    task_due_at: dict[str, datetime] = {}
    for sess in sessions:
        if sess.task_id.startswith("review_"):
            continue
        task_total_minutes[sess.task_id] = task_total_minutes.get(sess.task_id, 0) + sess.duration_min
        task_due_at[sess.task_id] = sess.due_at
    task_urgency = {
        task_id: round(10 * total_min / max(1.0, (task_due_at[task_id] - window_start).total_seconds() / 3600))
        for task_id, total_min in task_total_minutes.items()
    }

    session_vars: dict[str, tuple[cp_model.IntervalVar, cp_model.IntVar, Session]] = {}
    session_ctxs: list[SessionCtx] = []
    out_of_window: list[Session] = []
    infeasible_deadline: list[Session] = []

    for sess in sessions:
        duration_slots = sess.duration_min // SLOT_MINUTES
        deadline_slot = slot_of(sess.due_at)
        latest_start = deadline_slot - duration_slots
        # A review session's `not_before` (its own lecture's end time) is an
        # earliest-start bound, not just a deadline -- without this, nothing
        # stops it from being scheduled hours *before* the lecture it's
        # meant to review even happens, which technically satisfies "due
        # shortly after class" while completely missing the point.
        earliest_start = max(now_slot, slot_of_ceil(sess.not_before)) if sess.not_before else now_slot

        if sess.due_at > window_end:
            # Out of this window's scope entirely -- CLAUDE.md's "hours
            # still owed" lookahead is meant to cover this; not implemented
            # yet, see run_prototype.py's report. Not a scheduling failure.
            out_of_window.append(sess)
            continue

        if latest_start < earliest_start:
            # In scope, but the deadline can't be met even starting at the
            # earliest allowed moment -- a genuine "this can't be scheduled
            # in time" case, distinct from "wasn't attempted."
            infeasible_deadline.append(sess)
            continue

        presence = model.NewBoolVar(f"present_{sess.id}")
        start = model.NewIntVar(earliest_start, latest_start, f"start_{sess.id}")
        end = model.NewIntVar(now_slot, total_slots, f"end_{sess.id}")
        interval = model.NewOptionalIntervalVar(start, duration_slots, end, presence, f"iv_{sess.id}")
        all_intervals.append(interval)
        session_vars[sess.id] = (interval, presence, start)
        model.Add(end == start + duration_slots)
        if hint := hint_by_id.get(sess.id):
            # A previous placement is only a valid hint if it still fits this
            # solve's own bounds -- a preference change (a new protected
            # block, a tighter deadline) can shrink [earliest_start,
            # latest_start] out from under where the session used to sit, and
            # handing CP-SAT a hint outside the variable's own domain is
            # worse than no hint at all (rejected wholesale, not clamped).
            hint_start = slot_of(hint.start)
            if earliest_start <= hint_start <= latest_start:
                model.AddHint(start, hint_start)
                model.AddHint(presence, 1)

        day = model.NewIntVar(0, window_days - 1, f"day_{sess.id}")
        model.AddDivisionEquality(day, start, SLOTS_PER_DAY)
        minute_of_day = model.NewIntVar(0, SLOTS_PER_DAY - 1, f"mod_{sess.id}")
        model.AddModuloEquality(minute_of_day, start, SLOTS_PER_DAY)

        # Flexible work only happens in working hours (8am-11pm) -- a direct
        # bound on this session's own start/end, not a shared blackout
        # interval (see the NOTE above for why that broke once real fixed
        # commitments existed outside this window).
        model.Add(minute_of_day >= day_start_slot)
        model.Add(minute_of_day + duration_slots <= day_end_slot)
        session_ctxs.append(
            SessionCtx(sess.id, sess.task_id, sess.course_id, presence, start, duration_slots, day, minute_of_day)
        )

    # --- Same-task symmetry breaking: decompose.py splits one task's total
    # duration into fully-interchangeable equal-length chunks (hw3__s1..s8,
    # same title, same duration, same due_at) -- nothing distinguishes chunk
    # 3 from chunk 6 except the label, so without ordering, CP-SAT's search
    # treats every one of the 8! ways to assign them to the same 8 slots as a
    # DIFFERENT candidate solution worth comparing, even though they all
    # score identically. Two adjacent-pair constraints per task collapse that
    # entire permutation group down to the one decompose.py already
    # generated: keep chunks in their original index order whenever more
    # than one of a task's chunks is present, and require them to fill
    # front-to-back (a later chunk can't be present unless the one before it
    # is too, so presence never "skips" an earlier chunk while placing a
    # later one). Neither constraint says anything about WHERE a chunk
    # lands, only which one is "first" among however many end up scheduled
    # -- composes cleanly with spread_multi_session_tasks instead of fighting
    # it. Grouped by iterating `sessions` (decompose.py's own s1..sN order,
    # already the case since decompose_all appends one task's chunks
    # contiguously) rather than re-sorting by id, so a locked/dropped middle
    # chunk (already filtered out of `sessions` above) just leaves a shorter,
    # still-correctly-ordered remainder instead of breaking the grouping.
    # Review sessions pass through this loop too but are unaffected: each
    # occurrence's task_id is unique to that occurrence, so every review
    # "group" has exactly one member and the zip below is empty for it.
    task_groups: dict[str, list[str]] = {}
    for sess in sessions:
        if sess.id in session_vars:
            task_groups.setdefault(sess.task_id, []).append(sess.id)
    for group_ids in task_groups.values():
        for a_id, b_id in zip(group_ids, group_ids[1:]):
            _, a_presence, a_start = session_vars[a_id]
            _, b_presence, b_start = session_vars[b_id]
            model.Add(a_start < b_start).OnlyEnforceIf([a_presence, b_presence])
            model.AddImplication(b_presence, a_presence)

    # --- Preferences: everything the AI layer would eventually write into
    # `preferences` (CLAUDE.md) goes through the same compiler registry here.
    # Compiled BEFORE the main AddNoOverlap call, not after: a compiler like
    # `avoid_block` needs to add its own blackout intervals into the same
    # `all_intervals` pool off-hours uses, and that only works if nothing has
    # locked the list into a no-overlap constraint yet.
    pref_ctx = {
        "slot_minutes": SLOT_MINUTES,
        "window_days": window_days,
        "total_slots": total_slots,
        "day0_weekday": window_start.weekday(),  # 0=Mon..6=Sun, for weekday-scoped preferences
        "course_lecture_ends": course_lecture_ends,
        "task_urgency": task_urgency,
        "all_intervals": all_intervals,  # compilers may append (e.g. avoid_block)
        "extra_no_overlap_groups": [],
    }
    # meal_window and commitment are deliberately NOT in preferences.py's
    # REGISTRY -- both handled directly above, before this point, because
    # unlike every other type they need their solved values extracted back
    # out afterward (see the meal-window/windowed-commitment loops' own
    # comments; a LOCKED commitment doesn't need this -- it's a plain
    # mandatory interval already appended to placed_fixed, same as a fixed
    # course block). compile_all() raises on an unregistered type on purpose
    # (a real safety net against a typo'd or forgotten compiler); these two
    # have to be filtered out here rather than registered with a no-op, or
    # that safety net would have a permanent, silent hole in it.
    preference_terms = compile_all(
        model, [p for p in preferences if p.type not in ("meal_window", "commitment")], session_ctxs, pref_ctx
    )

    model.AddNoOverlap(all_intervals)
    for group in pref_ctx["extra_no_overlap_groups"]:
        model.AddNoOverlap(group)

    # --- Three-tier objective; see module docstring for why the tiers are
    # scaled the way they are. Tier 3 used to be `-start` in 15-minute slots,
    # which is NOT tiny relative to tier 2 -- it directly fights an evening
    # preference (a 5pm start scores far worse than an 8am one on this term
    # alone) and nearly cancels a daily-load penalty. Tie-breaking on the
    # *day* instead of the exact slot shrinks its total possible swing by
    # ~90x (window_days per session instead of total_slots) and removes the
    # perverse fight with hour-of-day preferences entirely -- "prefer an
    # earlier day, all else equal" is a much more defensible tie-break than
    # "prefer the earliest minute of the day" was.
    presence_terms = [PRESENCE_WEIGHT * presence for _, (interval, presence, start) in session_vars.items()]
    weighted_pref_terms = [PREF_SCALE * w * expr for w, expr in preference_terms]
    tiebreak_terms = []
    for ctx in session_ctxs:
        active_day = model.NewIntVar(0, window_days - 1, f"tiebreak_day_{ctx.session_id}")
        model.AddMultiplicationEquality(active_day, [ctx.day, ctx.presence])
        tiebreak_terms.append(-active_day)
    model.Maximize(sum(presence_terms) + sum(weighted_pref_terms) + sum(tiebreak_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_in_seconds
    # Used to always burn the full time budget -- CP-SAT keeps searching for
    # a BETTER solution right up to max_time_in_seconds even after it can
    # already prove the current one is close enough, which on an easy week
    # (few tasks, few active preferences) means paying the full 15s for a
    # result that was actually settled in under one. relative_gap_limit=0.5%
    # tells the solver to stop the moment (best_bound - objective) / |objective|
    # drops under that -- i.e. the moment it can PROVE no solution is more
    # than 0.5% better than what it already has, not just that it hasn't
    # found one yet. README.md's own "Round 5" table shows real 15s runs
    # landing a 0.18-0.25% gap at 2-8 workers on this test data, so 0.5% is a
    # real stopping point on a genuinely easy solve, not a number that never
    # fires; a hard week that can't get under 0.5% in time still runs the
    # full budget exactly as before, gap and all -- this only ever makes an
    # EASY solve faster, never trades away quality on a hard one. Also the
    # philosophically honest choice for a product whose whole pitch is
    # showing the user a real "% optimized" number (CLAUDE.md): stopping at
    # a provable bound is a legitimate claim, not an early exit dressed up
    # as one.
    solver.parameters.relative_gap_limit = relative_gap_limit
    # Was hardcoded to 8 -- which happens to be exactly this dev machine's
    # core count, not a considered choice for wherever this actually runs.
    # CP-SAT's parallel search only gets real speedup from workers that map
    # to real cores; asking for more workers than a host actually has means
    # they time-slice one CPU instead of running in parallel, which is not
    # the same as "8 workers" in any solve-quality sense. Auto-detect by
    # default; a caller on genuinely constrained hardware (a small container)
    # should pass the real number, not trust os.cpu_count() to reflect a
    # cgroup quota -- it doesn't.
    solver.parameters.num_search_workers = num_search_workers or os.cpu_count() or 1
    status = solver.Solve(model)

    placed: list[PlacedBlock] = list(placed_fixed)
    unplaced: list[PlacedBlock] = [
        PlacedBlock(s.id, s.task_id, s.course_id, s.title, "out_of_window", None, None) for s in out_of_window
    ] + [
        PlacedBlock(s.id, s.task_id, s.course_id, s.title, "infeasible_deadline", None, None)
        for s in infeasible_deadline
    ]

    status_name = solver.StatusName(status)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for sess in sessions:
            if sess.id not in session_vars:
                continue  # already accounted for above (out_of_window / infeasible_deadline)
            _, presence, start = session_vars[sess.id]
            block = PlacedBlock(
                id=sess.id,
                task_id=sess.task_id,
                course_id=sess.course_id,
                title=sess.title,
                kind="flexible",
                start=None,
                end=None,
            )
            if solver.Value(presence):
                s = solver.Value(start)
                block.start = window_start + timedelta(minutes=s * SLOT_MINUTES)
                block.end = block.start + timedelta(minutes=sess.duration_min)
                placed.append(block)
            else:
                # kind was "flexible" from construction above -- has to be
                # relabeled or every report/eval filter keyed on kind=="unplaced"
                # (run_prototype.py, eval.py) silently finds nothing here and
                # this session just vanishes from view instead of surfacing.
                block.kind = "unplaced"
                unplaced.append(block)
        # Meals are mandatory (not optional -- see the meal-window loop
        # above), so a FEASIBLE/OPTIMAL status means every one of them got a
        # real placement; nothing to check for "did it place" the way a
        # flexible session's presence bool needs checking.
        for block_id, (start_v, end_v) in meal_vars.items():
            meal = block_id.split("_")[1]
            s, e = solver.Value(start_v), solver.Value(end_v)
            placed.append(PlacedBlock(
                # task_id groups all 14 days' worth of one meal under a
                # single synthetic task ("meal_lunch", not "meal_lunch_2") --
                # the frontend's own adapter (frontend/src/lib/adapters.js)
                # silently drops any `type: "flexible"` session with no
                # task_id from EVERY view (calendar included), the same
                # pattern already used for review sessions
                # (plan_payload.py's `reviews` dict). Without this, meals
                # solve and persist correctly but never render anywhere --
                # found by looking at the actual rendered page, not by
                # reading this file in isolation.
                id=block_id, task_id=f"meal_{meal}", course_id=None,
                title=MEAL_LABELS.get(meal, meal.capitalize()), kind="flexible",
                start=window_start + timedelta(minutes=s * SLOT_MINUTES),
                end=window_start + timedelta(minutes=e * SLOT_MINUTES),
            ))
        # Windowed commitments: mandatory the same way meals are (see above)
        # -- always placed on a FEASIBLE/OPTIMAL solve. task_id strips only
        # the trailing `_{day}` (rsplit, not split-on-"_"[1] the way meals'
        # extraction does just above) because a user-provided name can
        # itself contain underscores once slugified ("Club Meeting" ->
        # "club_meeting") -- splitting on the first underscore would cut the
        # name in half instead of the day index.
        for block_id, (start_v, end_v) in commitment_vars.items():
            task_id = block_id.rsplit("_", 1)[0]
            s, e = solver.Value(start_v), solver.Value(end_v)
            placed.append(PlacedBlock(
                id=block_id, task_id=task_id, course_id=None,
                title=commitment_titles.get(task_id, task_id), kind="flexible",
                start=window_start + timedelta(minutes=s * SLOT_MINUTES),
                end=window_start + timedelta(minutes=e * SLOT_MINUTES),
            ))
        obj = solver.ObjectiveValue()
        bound = solver.BestObjectiveBound()
    else:
        obj = None
        bound = None
        unplaced += [
            PlacedBlock(sess.id, sess.task_id, sess.course_id, sess.title, "unplaced", None, None)
            for sess in sessions
            if sess.id in session_vars
        ]

    return SolveResult(status_name, obj, bound, placed, unplaced, frozenset(locked_ids))
