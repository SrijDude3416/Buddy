"""
Stage 2 of the two-stage pipeline: placement, via CP-SAT.

Core mechanics, matching CLAUDE.md's "Scheduling engine (CP-SAT)" section:
  - Everything (class blocks, off-hours, flexible sessions) is one shared list
    of intervals; AddNoOverlap over that list is the only overlap rule.
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

from dataclasses import dataclass
from datetime import datetime, timedelta, time

from ortools.sat.python import cp_model

from data_loader import ScheduleData, WEEKDAY_ABBR
from decompose import Session, decompose_all, SLOT_MINUTES
from preferences import Preference, SessionCtx, compile_all

DAY_START = time(8, 0)   # earliest an hour is ever "available" for anything
DAY_END = time(23, 0)    # latest

SLOTS_PER_DAY = 24 * 60 // SLOT_MINUTES  # 96 at 15-min resolution

PRESENCE_WEIGHT = 10_000_000  # dominates every preference term; see module docstring
PREF_SCALE = 100  # margin of safety so tier 2 reliably dominates tier 3's tie-break


def _time_to_slot_of_day(t: time) -> int:
    return (t.hour * 60 + t.minute) // SLOT_MINUTES


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


def build_and_solve(
    data: ScheduleData,
    window_start: datetime,
    window_days: int,
    preferences: list[Preference] = (),
    now_slot: int = 0,
    max_time_in_seconds: float = 10.0,
) -> SolveResult:
    total_slots = window_days * SLOTS_PER_DAY
    window_end = window_start + timedelta(days=window_days)

    def slot_of(dt: datetime) -> int:
        return int((dt - window_start).total_seconds() // (SLOT_MINUTES * 60))

    model = cp_model.CpModel()
    all_intervals: list[cp_model.IntervalVar] = []

    # --- Off-hours blackout, per day: two immovable blocks (00:00-08:00,
    # 23:00-24:00) rather than one spanning midnight -- simpler indexing,
    # and back-to-back blocks across days give the same effect.
    day_start_slot = _time_to_slot_of_day(DAY_START)
    day_end_slot = _time_to_slot_of_day(DAY_END)
    for day in range(window_days):
        base = day * SLOTS_PER_DAY
        morning = model.NewIntervalVar(base, day_start_slot, base + day_start_slot, f"night_am_{day}")
        evening = model.NewIntervalVar(
            base + day_end_slot, SLOTS_PER_DAY - day_end_slot, base + SLOTS_PER_DAY, f"night_pm_{day}"
        )
        all_intervals += [morning, evening]

    # --- Fixed course blocks, materialized from courses.meeting_times for
    # every date in the window that matches. No task_id: these aren't tasks.
    placed_fixed: list[PlacedBlock] = []
    for day in range(window_days):
        date = (window_start + timedelta(days=day)).date()
        weekday_abbr = WEEKDAY_ABBR[date.weekday()]
        for course in data.courses.values():
            for mt in course.meeting_times:
                if weekday_abbr not in mt.days:
                    continue
                start_dt = datetime.combine(date, time.fromisoformat(mt.start_time), tzinfo=window_start.tzinfo)
                end_dt = datetime.combine(date, time.fromisoformat(mt.end_time), tzinfo=window_start.tzinfo)
                s, e = slot_of(start_dt), slot_of(end_dt)
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

    # --- Flexible sessions, decomposed from not-done tasks. Optional so an
    # individual session can come back "unplaced" instead of the whole solve
    # failing.
    sessions = decompose_all(data.tasks)
    session_vars: dict[str, tuple[cp_model.IntervalVar, cp_model.IntVar, Session]] = {}
    session_ctxs: list[SessionCtx] = []
    out_of_window: list[Session] = []
    infeasible_deadline: list[Session] = []

    for sess in sessions:
        duration_slots = sess.duration_min // SLOT_MINUTES
        deadline_slot = slot_of(sess.due_at)
        latest_start = deadline_slot - duration_slots

        if sess.due_at > window_end:
            # Out of this window's scope entirely -- CLAUDE.md's "hours
            # still owed" lookahead is meant to cover this; not implemented
            # yet, see run_prototype.py's report. Not a scheduling failure.
            out_of_window.append(sess)
            continue

        if latest_start < now_slot:
            # In scope, but the deadline can't be met even starting right
            # now -- a genuine "this can't be scheduled in time" case,
            # distinct from "wasn't attempted."
            infeasible_deadline.append(sess)
            continue

        presence = model.NewBoolVar(f"present_{sess.id}")
        start = model.NewIntVar(now_slot, latest_start, f"start_{sess.id}")
        end = model.NewIntVar(now_slot, total_slots, f"end_{sess.id}")
        interval = model.NewOptionalIntervalVar(start, duration_slots, end, presence, f"iv_{sess.id}")
        all_intervals.append(interval)
        session_vars[sess.id] = (interval, presence, start)
        model.Add(end == start + duration_slots)

        day = model.NewIntVar(0, window_days - 1, f"day_{sess.id}")
        model.AddDivisionEquality(day, start, SLOTS_PER_DAY)
        minute_of_day = model.NewIntVar(0, SLOTS_PER_DAY - 1, f"mod_{sess.id}")
        model.AddModuloEquality(minute_of_day, start, SLOTS_PER_DAY)
        session_ctxs.append(SessionCtx(sess.id, sess.task_id, presence, start, duration_slots, day, minute_of_day))

    model.AddNoOverlap(all_intervals)

    # --- Preferences: everything the AI layer would eventually write into
    # `preferences` (CLAUDE.md) goes through the same compiler registry here.
    pref_ctx = {
        "slot_minutes": SLOT_MINUTES,
        "window_days": window_days,
        "total_slots": total_slots,
        "extra_no_overlap_groups": [],
    }
    preference_terms = compile_all(model, list(preferences), session_ctxs, pref_ctx)
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
    solver.parameters.num_search_workers = 8
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
                unplaced.append(block)
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

    return SolveResult(status_name, obj, bound, placed, unplaced)
