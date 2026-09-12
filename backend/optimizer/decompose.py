"""
Stage 1 of the two-stage pipeline (CLAUDE.md: "Task -> session decomposition").

Heuristic, not solved: given a task's total duration and whether it's
splittable, decide how many sessions it becomes and how long each one is.
Real version should take the user's "how do you like to work" onboarding
preference as an input; there's no such preference yet, so this uses fixed
defaults. Treat those constants as placeholders, not decisions.
"""
from __future__ import annotations

import math
import re
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


def humanize_title(raw_title: str) -> str:
    """Turn a raw Notion/Canvas task name into an instruction, not a label --
    "Recitation Quiz 3" tells you what the assignment is called, not what to
    do about it. Real thing is SCHEMA.md's `display_title` (AI-generated
    once, cached); this is a template stand-in until that exists, so treat
    the specific mappings as illustrative, not exhaustive."""
    t = raw_title.strip()
    if m := re.match(r"^Recitation Quiz (\d+)$", t):
        return f"Study for Recitation {m.group(1)}"
    if m := re.match(r"^(Midterm|Exam) (\d+)$", t):
        return f"Study for {m.group(1)} {m.group(2)}"
    if m := re.match(r"^(.+?)\s*\(Checkin\)$", t):
        return f"Complete {m.group(1)} Checkin"
    if t.startswith("Section "):
        return f"Study {t}"
    if t.endswith(" Due"):
        return f"Work on {t[:-len(' Due')]}"
    if t.endswith(" Deadline"):
        return f"Work on {t[:-len(' Deadline')]}"
    return f"Work on {t}"


def _round_to_slot(minutes: float) -> int:
    # Round UP, never to nearest: a 50-minute exam rounding down to 45 would
    # silently give it 5 fewer minutes than it actually needs. Overestimating
    # is harmless slack; underestimating a fixed sitting is a real error.
    return max(SLOT_MINUTES, math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES)


def decompose_task(task: Task) -> list[Session]:
    """One task -> one or more Sessions, each a multiple of SLOT_MINUTES.

    Every session of the same task shares one title, with no "(part i/N)"
    suffix -- position on the calendar already communicates it's ongoing
    multi-part work, and a real calendar (see backend/optimizer/README.md)
    just repeats the bare title across sessions.
    """
    duration = task.est_duration_min
    title = humanize_title(task.title)

    if not task.splittable or duration <= MAX_SESSION_MIN:
        return [
            Session(
                id=f"{task.id}__s1",
                task_id=task.id,
                course_id=task.course_id,
                title=title,
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
                title=title,
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
