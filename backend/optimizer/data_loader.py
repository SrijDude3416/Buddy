"""
Loads test-data/schedule_test_data.json into plain Python objects.

This is a stand-in for what will eventually be a Mongo read (tasks + courses
per SCHEMA.md). Kept dependency-free (no pydantic yet) so it's easy to read
while we're still figuring out the model shape.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_PATH = REPO_ROOT / "test-data" / "schedule_test_data.json"

WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

_COURSE_CODE_RE = re.compile(r"^(\d{2})(\d+)")


def format_course_code(course_name: str) -> str:
    """"15151 Math Foundations" -> "15-151" -- Carlos's own real calendar
    always leads a task/block title with the course code, and asked for it
    here too ("it's good to put the class number so that it's more
    readable"). Returns "" if the name doesn't start with a course number,
    rather than guessing."""
    m = _COURSE_CODE_RE.match(course_name)
    return f"{m.group(1)}-{m.group(2)}" if m else ""


@dataclass
class MeetingTime:
    days: list[str]  # e.g. ["Mon", "Wed", "Fri"]
    start_time: str  # "HH:MM"
    end_time: str
    location: str | None = None


@dataclass
class Course:
    id: str
    name: str
    meeting_times: list[MeetingTime] = field(default_factory=list)


@dataclass
class Task:
    id: str
    course_id: str
    title: str
    due_at: datetime
    est_duration_min: int
    est_duration_is_guess: bool
    splittable: bool
    status: str  # not_started | in_progress | done
    notes: str = ""
    # An explicit, caller-authored session breakdown -- e.g. [120, 120, 30]
    # for "two 2-hour sessions then a 30-minute review". None (the default,
    # and the only value every pre-existing task has) means "let
    # decompose.py's own equal-split heuristic decide", unchanged from
    # before this field existed. Set by add_task (api_models.AddTaskIn) when
    # a chat message asks for a specific structure instead of the default
    # guess -- decompose.py is the only other place this is read.
    session_plan: list[int] | None = None

    @property
    def is_done(self) -> bool:
        return self.status == "done"


@dataclass
class ScheduleData:
    generated_at: datetime
    courses: dict[str, Course]
    tasks: list[Task]


def load_data(path: Path = DEFAULT_DATA_PATH) -> ScheduleData:
    raw = json.loads(path.read_text())

    courses = {
        c["id"]: Course(
            id=c["id"],
            name=c["name"],
            meeting_times=[MeetingTime(**mt) for mt in c["meeting_times"]],
        )
        for c in raw["courses"]
    }

    tasks = [
        Task(
            id=t["id"],
            course_id=t["course_id"],
            title=t["title"],
            due_at=datetime.fromisoformat(t["due_at"]),
            est_duration_min=t["est_duration_min"],
            est_duration_is_guess=t["est_duration_is_guess"],
            splittable=t["splittable"],
            status=t["status"],
            notes=t.get("notes", ""),
        )
        for t in raw["tasks"]
    ]

    return ScheduleData(
        generated_at=datetime.fromisoformat(raw["generated_at"]),
        courses=courses,
        tasks=tasks,
    )


def load_data_preferring_mongo(path: Path = DEFAULT_DATA_PATH) -> ScheduleData:
    """Tries the real Atlas cluster first (mongo_loader.py, seeded by
    seed_mongo.py from this same test-data.json), falls back to the static
    file read above if Mongo isn't configured, unreachable, or not yet
    seeded. Either way the choice is printed, never silent -- CLAUDE.md's
    "worth surfacing, not hiding" principle: a demo quietly running on stale
    static data when Mongo was actually intended is confusing, not a
    convenience. This is api.py's entry point now; load_data() above stays
    file-only and untouched for run_prototype.py, tests, and anything that
    wants a Mongo-independent read."""
    try:
        import mongo_loader

        data = mongo_loader.load_data()
        print(f"[data_loader] Loaded {len(data.courses)} courses / {len(data.tasks)} tasks from MongoDB "
              f"({mongo_loader.SEED_SOURCE!r}).")
        return data
    except Exception as exc:
        print(f"[data_loader] Mongo unavailable ({exc}); falling back to {path}.")
        return load_data(path)


if __name__ == "__main__":
    data = load_data()
    print(f"{len(data.courses)} courses, {len(data.tasks)} tasks")
    for t in data.tasks:
        print(f"  [{t.status:11s}] {t.due_at.date()}  {t.title}  ({t.est_duration_min}m)")
