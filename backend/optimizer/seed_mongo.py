"""
One-time (idempotent) load of test-data/schedule_test_data.json into the real
Atlas cluster, in SCHEMA.md's actual `courses`/`tasks` shape -- so
mongo_loader.py has something real to read. Run it after backend/.env.local
has working MONGODB_URI/MONGODB_DB (and this machine's IP is in Atlas's
Network Access list -- see backend/README.md's "MongoDB Atlas" step):

    source .venv/bin/activate
    python seed_mongo.py

Safe to re-run: every write is an upsert keyed on the id test-data.json
already gives each course/task, so re-running after editing the source file
updates in place rather than duplicating. Every document written here is
tagged `seed_source: "carlos_test_data"` and every task additionally tagged
`user_id: "demo-carlos"` (mongo_loader.SEED_SOURCE / DEMO_USER_ID) --
that tag is what keeps this from colliding with backend/lib/catalog.js's own
unrelated synthetic course catalog living in the same `courses` collection,
and it's how this script cleans up after itself (see --wipe below).

This intentionally does NOT touch `preferences`, `sessions`, `syllabus_data`,
`users`, or `enrollments` -- CLAUDE.md's boundary is "the optimizer only ever
reads tasks/preferences/sessions"; courses/tasks are the only two collections
this project's Python side needs to originate data into. Preferences already
persist for the lifetime of a running process (preferences_store.py) and are
round-tripped by the browser between requests in the current buddy/ pipeline
(preference_pipeline.py) -- a separate, deliberate design worth its own
conversation before folding into this, not assumed here.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from mongo_loader import DEMO_USER_ID, SEED_SOURCE, ABBR_TO_JS_WEEKDAY, get_db

REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_DATA_PATH = REPO_ROOT / "test-data" / "schedule_test_data.json"


def _meeting_time_to_doc(mt: dict) -> dict:
    return {
        # SCHEMA.md's courses.meeting_times has a `type` (lecture/recitation/lab)
        # test-data.json never recorded per-block -- "lecture" is the honest
        # default, not a guess at which of Carlos's blocks were recitations.
        "type": "lecture",
        "days": [ABBR_TO_JS_WEEKDAY[d] for d in mt["days"]],
        "start_time": mt["start_time"],
        "end_time": mt["end_time"],
        "location": mt.get("location"),
    }


def seed(wipe: bool = False) -> None:
    db = get_db()
    raw = json.loads(TEST_DATA_PATH.read_text())

    if wipe:
        rc = db.courses.delete_many({"seed_source": SEED_SOURCE})
        rt = db.tasks.delete_many({"seed_source": SEED_SOURCE})
        print(f"Wiped {rc.deleted_count} courses, {rt.deleted_count} tasks (seed_source={SEED_SOURCE!r})")

    course_ops = 0
    for c in raw["courses"]:
        db.courses.update_one(
            {"_id": c["id"]},
            {
                "$set": {
                    "seed_source": SEED_SOURCE,
                    "name": c["name"],
                    "code": "",  # data_loader.format_course_code() derives this from `name` at read time
                    "term": "F25",
                    "meeting_times": [_meeting_time_to_doc(mt) for mt in c["meeting_times"]],
                }
            },
            upsert=True,
        )
        course_ops += 1

    task_ops = 0
    for t in raw["tasks"]:
        due_at = datetime.fromisoformat(t["due_at"])
        db.tasks.update_one(
            {"_id": t["id"]},
            {
                "$set": {
                    "seed_source": SEED_SOURCE,
                    "user_id": DEMO_USER_ID,
                    "course_id": t["course_id"],
                    "source_assignment": t["title"],
                    "display_title": None,  # SCHEMA.md: falls back to source_assignment until AI-generated
                    "due_at": due_at,
                    "est_duration_min": t["est_duration_min"],
                    "splittable": t["splittable"],
                    "status": t["status"],
                    "priority_weight": 1.0,
                    "actual_time_logged_min": None,
                }
            },
            upsert=True,
        )
        task_ops += 1

    print(f"Seeded {course_ops} courses, {task_ops} tasks into {db.name!r} "
          f"(seed_source={SEED_SOURCE!r}, user_id={DEMO_USER_ID!r})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wipe", action="store_true", help="Delete existing seed_source docs first")
    args = parser.parse_args()
    seed(wipe=args.wipe)
