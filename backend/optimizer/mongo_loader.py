"""
Reads `courses` + `tasks` out of the real Atlas cluster (SCHEMA.md shapes),
as an alternative to data_loader.load_data()'s test-data.json read.

Credentials: `backend/.env.local` (one directory up from this file) -- the
same file backend/'s Next.js app already uses (`MONGODB_URI`, `MONGODB_DB`).
Not backend/optimizer/.env -- there's exactly one Atlas connection string for
this project, and duplicating it into a second .env file is how it silently
drifts out of sync with the real one. If a real environment variable is
already set (a deploy host, a shell export), that wins over the file --
load_dotenv's default `override=False` gets this for free.

Field mapping, SCHEMA.md -> data_loader's dataclasses:
  - `courses._id` / `tasks.course_id` are ObjectIds; converted to str() so
    they behave exactly like test-data.json's plain string ids everywhere
    else in this codebase (scheduler.py, preferences.py never parse an id,
    only compare/key on it).
  - `meeting_times[].days` is "an array of weekday ints" (SCHEMA.md) --
    confirmed against backend/lib/planEngine.js's own `date.getDay()` use,
    i.e. JS convention: 0=Sun ... 6=Sat. data_loader.MeetingTime.days wants
    the "Mon".."Sun" abbreviations everything else here already uses
    (WEEKDAY_ABBR, decompose.py, preferences.py) -- converted below, once.
  - `tasks.display_title` (falls back to `source_assignment`) -> `Task.title`,
    same fallback SCHEMA.md itself documents for a task with no AI-generated
    title yet.
  - `Task.est_duration_is_guess` and `.notes` have no Mongo column (the
    former is provenance-only and already unused past data_loader per
    api.py's own /solve conversion; the latter is test-data.json-specific)
    -- both default rather than erroring.

This module intentionally seeds/queries a single fixed demo user
(DEMO_USER_ID) -- buddy/'s whole demo is one implicit user with no login
(root README.md: "No MongoDB, auth ... required"), so there's no real
user_id to key off yet. `seed_mongo.py` writes under the same id.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

import data_loader

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ENV_FILE = REPO_ROOT / "backend" / ".env.local"

# Tags every document this project's Python side ever writes/reads, so a
# Mongo query here never accidentally pulls in backend/lib/catalog.js's own
# unrelated synthetic course catalog (same cluster, same `courses`
# collection, seeded independently by the Next.js app) or vice versa.
SEED_SOURCE = "carlos_test_data"
DEMO_USER_ID = "demo-carlos"

JS_WEEKDAY_TO_ABBR = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
ABBR_TO_JS_WEEKDAY = {v: k for k, v in JS_WEEKDAY_TO_ABBR.items()}


def load_env() -> None:
    """Loads backend/.env.local into os.environ if MONGODB_URI isn't already
    set. Safe to call more than once (load_dotenv is idempotent here since
    override=False and the vars are already present the second time)."""
    if "MONGODB_URI" not in os.environ and BACKEND_ENV_FILE.exists():
        load_dotenv(BACKEND_ENV_FILE)


def get_db():
    """Raises clearly (not a bare pymongo traceback) when Mongo isn't
    configured or unreachable -- callers decide whether that's fatal or a
    fall-back-to-file signal (see data_loader.load_data_preferring_mongo)."""
    load_env()
    uri = os.environ.get("MONGODB_URI")
    db_name = os.environ.get("MONGODB_DB")
    if not uri or not db_name:
        raise RuntimeError(
            f"MONGODB_URI/MONGODB_DB not set and not found in {BACKEND_ENV_FILE}"
        )
    from pymongo import MongoClient

    # tz_aware=True: PyMongo's default decodes BSON datetimes as *naive* UTC.
    # Everything downstream of data_loader (WINDOW_START in run_prototype.py,
    # every datetime arithmetic in scheduler.py/decompose.py) is tz-aware --
    # mixing the two raises "can't subtract offset-naive and offset-aware
    # datetimes" the first time a Mongo-sourced due_at meets WINDOW_START.
    client = MongoClient(uri, serverSelectionTimeoutMS=8000, tz_aware=True)
    client.admin.command("ping")  # fail fast and clearly, not on the first real query
    return client[db_name]


def _meeting_time_from_doc(doc: dict) -> data_loader.MeetingTime:
    return data_loader.MeetingTime(
        days=[JS_WEEKDAY_TO_ABBR[d] for d in doc["days"]],
        start_time=doc["start_time"],
        end_time=doc["end_time"],
        location=doc.get("location"),
    )


def load_data(user_id: str = DEMO_USER_ID) -> data_loader.ScheduleData:
    """Mongo-backed equivalent of data_loader.load_data(). Reads exactly the
    two collections CLAUDE.md says the optimizer is allowed to touch
    (`tasks`, plus `courses` for meeting_times -- courses themselves are
    read-only reference data the optimizer needs but doesn't own, same as
    the file-based loader already treats test-data.json's `courses` array)."""
    db = get_db()

    course_docs = list(db.courses.find({"seed_source": SEED_SOURCE}))
    courses = {
        str(c["_id"]): data_loader.Course(
            id=str(c["_id"]),
            name=c["name"],
            meeting_times=[_meeting_time_from_doc(mt) for mt in c.get("meeting_times", [])],
        )
        for c in course_docs
    }

    task_docs = list(db.tasks.find({"user_id": user_id, "seed_source": SEED_SOURCE}))
    tasks = [
        data_loader.Task(
            id=str(t["_id"]),
            course_id=str(t["course_id"]),
            title=t.get("display_title") or t["source_assignment"],
            due_at=t["due_at"] if isinstance(t["due_at"], datetime) else datetime.fromisoformat(t["due_at"]),
            est_duration_min=t["est_duration_min"],
            est_duration_is_guess=False,  # provenance-only; see module docstring
            splittable=t["splittable"],
            status=t["status"],
            notes="",
            # Only chat-added tasks (mongo_state.save_new_tasks) ever set
            # this; every seed_mongo.py-imported task has no such key, and
            # .get() defaulting to None reproduces the same "let
            # decompose.py's own heuristic decide" behavior they've always had.
            session_plan=t.get("session_plan"),
        )
        for t in task_docs
    ]

    if not courses or not tasks:
        raise RuntimeError(
            f"Mongo has {len(courses)} seeded courses / {len(tasks)} seeded tasks for "
            f"user_id={user_id!r}, seed_source={SEED_SOURCE!r} -- run seed_mongo.py first."
        )

    return data_loader.ScheduleData(generated_at=datetime.now().astimezone(), courses=courses, tasks=tasks)


if __name__ == "__main__":
    data = load_data()
    print(f"Loaded from Mongo: {len(data.courses)} courses, {len(data.tasks)} tasks")
