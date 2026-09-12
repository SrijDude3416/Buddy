"""
Glue script: load test data -> decompose -> solve -> print a report + eval,
and dump a JSON file the calendar visualization reads.

Usage: python3 run_prototype.py [window_days] [profile]
  profile is a key into PROFILES below. Default: "tuned".
"""
from __future__ import annotations

import json
import sys
import time as _time
from datetime import datetime, timedelta

from data_loader import load_data, MeetingTime
from scheduler import build_and_solve
from preferences import Preference
from eval import evaluate, print_eval

NOW = datetime.fromisoformat("2026-09-12T00:00:00-04:00")  # start of window == start of day

# Personal routine, hand-authored from Carlos's own real (human-tuned) week --
# see the calendar screenshot this was reverse-engineered from, in chat. Not
# `courses.meeting_times`: this is what CLAUDE.md's onboarding "outside
# commitments" question is meant to eventually produce. MeetingTime is reused
# here rather than a new dataclass; its `location` field doubles as the
# block's display label since personal blocks don't have a real location.
ROUTINE: list[MeetingTime] = [
    MeetingTime(["Mon", "Tue", "Wed", "Thu", "Fri"], "06:30", "07:45", "Gym"),
    MeetingTime(["Mon", "Tue", "Wed", "Thu", "Fri"], "07:45", "08:30", "Breakfast & Shower"),
    MeetingTime(["Sat", "Sun"], "09:30", "10:15", "Breakfast & Shower"),
    MeetingTime(["Mon", "Tue", "Wed", "Thu", "Fri"], "12:00", "12:45", "Lunch"),
    MeetingTime(["Sat", "Sun"], "13:00", "13:45", "Lunch"),
    MeetingTime(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "18:00", "18:45", "Dinner"),
]

# Hand-authored stand-ins for what onboarding/chat would eventually produce
# (CLAUDE.md: preferences are always typed objects the compiler registry
# turns into constraints/objective terms -- these are no different in kind
# from an AI-written one, just written by hand for now). See README.md for
# what each profile was for and what changed between them.
PROFILES: dict[str, list[Preference]] = {
    "none": [],
    "v1_evening_and_cap": [
        Preference("daily_load_cap", {"minutes": 240}, weight=15),
        Preference("preferred_hours", {"start": "17:00", "end": "23:00"}, weight=20),
    ],
    "v2_gaps_and_spread": [
        Preference("daily_load_cap", {"minutes": 240}, weight=15),
        Preference("preferred_hours", {"start": "17:00", "end": "23:00"}, weight=20),
        Preference("min_gap_between_sessions", {"minutes": 15}, weight=0),  # hard; weight unused
        Preference("spread_multi_session_tasks", {}, weight=25),
    ],
    "tuned": [
        Preference("daily_load_cap", {"minutes": 240}, weight=15),
        Preference("daily_load_cap", {"minutes": 90, "days": ["Sun"]}, weight=25),  # protect a real rest day
        Preference("preferred_hours", {"start": "17:00", "end": "23:00"}, weight=20),
        Preference("min_gap_between_sessions", {"minutes": 15}, weight=0),  # hard; weight unused
        Preference("spread_multi_session_tasks", {}, weight=25),
        Preference("avoid_block", {"days": ["Fri", "Sat"], "start": "19:00", "end": "24:00"}, weight=0),  # hard
        Preference("after_class_bonus", {"minutes": 90}, weight=15),
    ],
}


def hours_owed_beyond_window(data, window_end) -> dict:
    """Placeholder for CLAUDE.md's 'hours still owed' lookahead -- not a real
    capacity reservation yet, just a report of what's outside the window."""
    owed_by_course: dict[str, float] = {}
    for t in data.tasks:
        if t.is_done or t.due_at <= window_end:
            continue
        owed_by_course[t.course_id] = owed_by_course.get(t.course_id, 0) + t.est_duration_min / 60
    return owed_by_course


def main():
    window_days = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    profile_name = sys.argv[2] if len(sys.argv) > 2 else "tuned"
    window_end = NOW + timedelta(days=window_days)

    data = load_data()
    t0 = _time.perf_counter()
    result = build_and_solve(
        data,
        window_start=NOW,
        window_days=window_days,
        preferences=PROFILES[profile_name],
        personal_blocks=ROUTINE,
    )
    solve_seconds = _time.perf_counter() - t0

    print(f"window: {NOW.date()} .. {window_end.date()} ({window_days} days)   profile: {profile_name}")
    print(f"status: {result.status_name}   solved in {solve_seconds:.2f}s")
    if result.objective_value is not None:
        # For a maximization problem the bound is >= the best solution found
        # until proven optimal, so the gap is (bound - objective), not the
        # other way around -- get this backwards and an unfinished FEASIBLE
        # solve reports a negative gap (>100% "optimized"), which is exactly
        # the number CLAUDE.md promised users would never see.
        gap = (
            (result.best_bound - result.objective_value) / result.objective_value
            if result.objective_value
            else 0
        )
        print(f"objective: {result.objective_value:.0f}  bound: {result.best_bound:.0f}  gap: {gap:.4%}")

    placed_flex = [p for p in result.placed if p.kind == "flexible"]
    print(f"\nplaced: {len(placed_flex)} flexible sessions, {len(result.placed) - len(placed_flex)} fixed blocks")
    for p in sorted(result.placed, key=lambda p: p.start):
        tag = "FIXED" if p.kind == "fixed" else "flex "
        print(f"  [{tag}] {p.start:%a %m-%d %H:%M}-{p.end:%H:%M}  {p.title}")

    genuinely_unplaced = [u for u in result.unplaced if u.kind == "unplaced"]
    infeasible = [u for u in result.unplaced if u.kind == "infeasible_deadline"]
    out_of_window = [u for u in result.unplaced if u.kind == "out_of_window"]

    if genuinely_unplaced:
        print(f"\ncompeted for space and lost ({len(genuinely_unplaced)}) -- a real scheduling squeeze:")
        for u in genuinely_unplaced:
            print(f"  {u.title}")
    if infeasible:
        print(f"\ncan't meet deadline even starting now ({len(infeasible)}):")
        for u in infeasible:
            print(f"  {u.title}")
    if out_of_window:
        print(f"\nout of scope this window, due later ({len(out_of_window)}):")
        for u in out_of_window:
            print(f"  {u.title}")

    owed = hours_owed_beyond_window(data, window_end)
    if owed:
        print(f"\nhours owed beyond this window (not yet a real capacity reservation):")
        for course_id, hrs in owed.items():
            print(f"  {data.courses[course_id].name}: {hrs:.1f}h")

    metrics = evaluate(result, NOW, window_days)
    print_eval(profile_name, metrics)

    # Dump for the calendar renderer.
    out = {
        "window_start": NOW.isoformat(),
        "window_days": window_days,
        "profile": profile_name,
        "status": result.status_name,
        "solve_seconds": solve_seconds,
        "objective": result.objective_value,
        "best_bound": result.best_bound,
        "metrics": metrics,
        "blocks": [
            {
                "id": p.id,
                "title": p.title,
                "kind": p.kind,
                "course_id": p.course_id,
                "start": p.start.isoformat(),
                "end": p.end.isoformat(),
            }
            for p in result.placed
        ],
        "unplaced": [{"title": u.title, "reason": u.kind} for u in result.unplaced],
    }
    out_path = f"output_{window_days}d_{profile_name}.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
