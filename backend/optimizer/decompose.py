"""
Stage 1 of the two-stage pipeline (CLAUDE.md: "Task -> session decomposition").

Heuristic, not solved: given a task's total duration and whether it's
splittable, decide how many sessions it becomes and how long each one is.
Real version should take the user's "how do you like to work" onboarding
preference as an input; there's no such preference yet, so this uses fixed
defaults. Treat those constants as placeholders, not decisions.
"""
from __future__ import annotations

from dataclasses import dataclass

from data_loader import Task

SLOT_MINUTES = 15
MAX_SESSION_MIN = 90   # don't ask for one continuous sitting longer than this
MIN_SESSION_MIN = 30   # don't produce slivers shorter than this


@dataclass
class Session:
    id: str
    task_id: str
    course_id: str
    title: str
    duration_min: int
    due_at: object  # datetime, kept loose to avoid circular import noise


def _round_to_slot(minutes: int) -> int:
    return max(SLOT_MINUTES, round(minutes / SLOT_MINUTES) * SLOT_MINUTES)


def decompose_task(task: Task) -> list[Session]:
    """One task -> one or more Sessions, each a multiple of SLOT_MINUTES."""
    duration = task.est_duration_min

    if not task.splittable or duration <= MAX_SESSION_MIN:
        return [
            Session(
                id=f"{task.id}__s1",
                task_id=task.id,
                course_id=task.course_id,
                title=task.title,
                duration_min=_round_to_slot(duration),
                due_at=task.due_at,
            )
        ]

    # Split into the fewest sessions that keep each one <= MAX_SESSION_MIN,
    # then divide the work evenly rather than front/back-loading a remainder.
    num_sessions = -(-duration // MAX_SESSION_MIN)  # ceil division
    per_session = _round_to_slot(duration / num_sessions)

    # If even splitting would drop below MIN_SESSION_MIN, use fewer, longer
    # sessions instead (a sliver nobody would actually sit down for).
    while per_session < MIN_SESSION_MIN and num_sessions > 1:
        num_sessions -= 1
        per_session = _round_to_slot(duration / num_sessions)

    sessions = []
    remaining = duration
    for i in range(num_sessions):
        is_last = i == num_sessions - 1
        this_len = remaining if is_last else per_session
        this_len = _round_to_slot(this_len)
        remaining -= this_len
        sessions.append(
            Session(
                id=f"{task.id}__s{i + 1}",
                task_id=task.id,
                course_id=task.course_id,
                title=f"{task.title} (part {i + 1}/{num_sessions})",
                duration_min=this_len,
                due_at=task.due_at,
            )
        )
    return sessions


def decompose_all(tasks: list[Task]) -> list[Session]:
    sessions: list[Session] = []
    for t in tasks:
        if t.is_done:
            continue
        sessions.extend(decompose_task(t))
    return sessions


if __name__ == "__main__":
    from data_loader import load_data

    data = load_data()
    for t in data.tasks:
        if t.is_done:
            continue
        parts = decompose_task(t)
        if len(parts) > 1:
            print(f"{t.title} ({t.est_duration_min}m) -> {len(parts)} sessions:")
            for p in parts:
                print(f"    {p.title}: {p.duration_min}m")
