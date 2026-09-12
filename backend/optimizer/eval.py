"""
Turns a SolveResult into a few concrete numbers, so "did this preference
profile actually help" is a diff between two dicts instead of eyeballing a
calendar. Used by run_prototype.py's --profile comparisons.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import time

EVENING_START = time(17, 0)
EVENING_END = time(23, 0)
GAP_MINUTES = 15


def evaluate(result, window_start, window_days) -> dict:
    flex = sorted([p for p in result.placed if p.kind == "flexible"], key=lambda p: p.start)

    genuinely_unplaced = sum(1 for u in result.unplaced if u.kind == "unplaced")
    infeasible = sum(1 for u in result.unplaced if u.kind == "infeasible_deadline")

    # --- per-day flexible-minutes load
    load_by_day: dict[int, int] = defaultdict(int)
    for p in flex:
        day = (p.start.date() - window_start.date()).days
        load_by_day[day] += int((p.end - p.start).total_seconds() // 60)
    day_loads = [load_by_day.get(d, 0) for d in range(window_days)]

    # --- evening adherence, by minutes (not session count, so a long evening
    # session counts more than a short one)
    evening_minutes = 0
    total_minutes = 0
    for p in flex:
        dur = int((p.end - p.start).total_seconds() // 60)
        total_minutes += dur
        if EVENING_START <= p.start.time() < EVENING_END:
            evening_minutes += dur

    # --- back-to-back gap violations: consecutive flexible sessions on the
    # same day with less than GAP_MINUTES between them
    gap_violations = 0
    for a, b in zip(flex, flex[1:]):
        if a.end.date() != b.start.date():
            continue
        gap = (b.start - a.end).total_seconds() / 60
        if 0 <= gap < GAP_MINUTES:
            gap_violations += 1

    # --- multi-session tasks crammed onto a single day
    days_by_task: dict[str, set] = defaultdict(set)
    sessions_by_task: dict[str, int] = defaultdict(int)
    for p in flex:
        if p.task_id is None:
            continue
        days_by_task[p.task_id].add(p.start.date())
        sessions_by_task[p.task_id] += 1
    crammed_tasks = [
        task_id
        for task_id, n in sessions_by_task.items()
        if n > 1 and len(days_by_task[task_id]) == 1
    ]

    return {
        "sessions_placed": len(flex),
        "genuinely_unplaced": genuinely_unplaced,
        "infeasible_deadline": infeasible,
        "max_day_load_min": max(day_loads) if day_loads else 0,
        "day_loads_min": day_loads,
        "evening_adherence_pct": (100 * evening_minutes / total_minutes) if total_minutes else 0.0,
        "gap_violations": gap_violations,
        "multi_session_tasks": len(sessions_by_task),
        "crammed_onto_one_day": len(crammed_tasks),
        "crammed_task_ids": crammed_tasks,
    }


def print_eval(label: str, metrics: dict) -> None:
    print(f"\n--- eval: {label} ---")
    print(f"  placed: {metrics['sessions_placed']}   unplaced (real): {metrics['genuinely_unplaced']}   infeasible: {metrics['infeasible_deadline']}")
    print(f"  busiest day: {metrics['max_day_load_min']} min   per-day load: {metrics['day_loads_min']}")
    print(f"  evening-hours adherence: {metrics['evening_adherence_pct']:.0f}%")
    print(f"  back-to-back (<{GAP_MINUTES}min gap) pairs: {metrics['gap_violations']}")
    print(f"  multi-session tasks crammed onto one day: {metrics['crammed_onto_one_day']} / {metrics['multi_session_tasks']}  {metrics['crammed_task_ids']}")
