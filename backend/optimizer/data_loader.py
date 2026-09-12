"""
Loads test-data/schedule_test_data.json into plain Python objects.

This is a stand-in for what will eventually be a Mongo read (tasks + courses
per SCHEMA.md). Kept dependency-free (no pydantic yet) so it's easy to read
while we're still figuring out the model shape.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_PATH = REPO_ROOT / "test-data" / "schedule_test_data.json"

WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


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


if __name__ == "__main__":
    data = load_data()
    print(f"{len(data.courses)} courses, {len(data.tasks)} tasks")
    for t in data.tasks:
        print(f"  [{t.status:11s}] {t.due_at.date()}  {t.title}  ({t.est_duration_min}m)")
