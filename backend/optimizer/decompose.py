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
from datetime import datetime, timedelta, time as dtime

from data_loader import Task, Course, WEEKDAY_ABBR, format_course_code

SLOT_MINUTES = 15
MAX_SESSION_MIN = 60   # never work on the same subject for more than an hour (Carlos's own rule)
MIN_SESSION_MIN = 30   # don't produce slivers shorter than this

REVIEW_DURATION_MIN = 30  # a quick post-lecture notes review, not a full study session
REVIEW_WINDOW_MIN = 45    # must start within this long after class or don't bother -- it's stale otherwise


@dataclass
class Session:
    id: str
    task_id: str
    course_id: str
    title: str
    duration_min: int
    due_at: object  # datetime, kept loose to avoid circular import noise
    not_before: object = None  # datetime | None -- earliest allowed start; None means "window start"


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


def decompose_task(task: Task, course_code: str = "") -> list[Session]:
    """One task -> one or more Sessions, each a multiple of SLOT_MINUTES.

    Every session of the same task shares one title, with no "(part i/N)"
    suffix -- position on the calendar already communicates it's ongoing
    multi-part work, and a real calendar (see backend/optimizer/README.md)
    just repeats the bare title across sessions. `course_code` (e.g.
    "15-151"), when given, is prefixed on -- Carlos's own calendar always
    leads with the class number, and asked for it here for the same reason:
    it's more readable at a glance than the activity alone.
    """
    duration = task.est_duration_min
    title = humanize_title(task.title)
    if course_code:
        title = f"{course_code} {title}"

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


def decompose_all(tasks: list[Task], courses: dict[str, Course] = None) -> list[Session]:
    courses = courses or {}
    sessions: list[Session] = []
    for t in tasks:
        if t.is_done:
            continue
        course = courses.get(t.course_id)
        code = format_course_code(course.name) if course else ""
        sessions.extend(decompose_task(t, code))
    return sessions


def generate_review_sessions(courses: dict[str, Course], window_start: datetime, window_days: int) -> list[Session]:
    """One short "review notes" session per lecture occurrence in the
    window -- not from any real task, just Carlos's own stated habit
    ("right after lectures it's good to have some time blocked out to
    revise your notes"). Its due_at is deliberately tight (must start within
    REVIEW_WINDOW_MIN of the lecture ending) rather than "sometime today" --
    a review that slips to that evening isn't the thing being asked for, so
    it should come back unplaced instead of landing somewhere misleading.
    Reuses the same optional-session machinery as real tasks: if it truly
    can't fit, it's dropped, not forced.
    """
    sessions: list[Session] = []
    for day in range(window_days):
        date = (window_start + timedelta(days=day)).date()
        weekday_abbr = WEEKDAY_ABBR[date.weekday()]
        for course in courses.values():
            code = format_course_code(course.name)
            for mt in course.meeting_times:
                if weekday_abbr not in mt.days:
                    continue
                end_dt = datetime.combine(date, dtime.fromisoformat(mt.end_time), tzinfo=window_start.tzinfo)
                sessions.append(
                    Session(
                        id=f"review_{course.id}_{day}_{mt.start_time}",
                        task_id=f"review_{course.id}_{day}_{mt.start_time}",
                        course_id=course.id,
                        title=f"{code} Review Notes".strip(),
                        duration_min=REVIEW_DURATION_MIN,
                        due_at=end_dt + timedelta(minutes=REVIEW_WINDOW_MIN),
                        not_before=end_dt,
                    )
                )
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
