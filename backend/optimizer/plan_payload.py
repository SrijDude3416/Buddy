"""Translate a real SolveResult into the existing React calendar contract."""
from datetime import timedelta

from decompose import generate_review_sessions
from data_loader import format_course_code


def to_plan_payload(result, data, window_start, window_days, preferences, solve_seconds):
    def wall(dt):
        return dt.replace(tzinfo=None).isoformat(timespec="seconds")

    # meeting_times travels with the plan so a caller that supplied a course
    # (preference_pipeline.CourseOverride -- a student's own lecture section) can
    # hand the same course back on the next solve. Without it, a re-solve driven
    # by chat would send a course id this service never loaded at startup and be
    # told "Unknown course ID", silently losing the class blocks.
    courses = [{"_id": c.id, "code": format_course_code(c.name) or c.id, "name": c.name,
                "meeting_times": [{"days": mt.days, "start_time": mt.start_time,
                                   "end_time": mt.end_time, "location": mt.location}
                                  for mt in c.meeting_times]}
               for c in data.courses.values()]
    tasks = [{"_id": t.id, "course_id": t.course_id, "display_title": t.title,
              "source_assignment": t.title, "status": t.status, "due_at": wall(t.due_at),
              "priority_weight": 1, "est_duration_min": t.est_duration_min}
             for t in data.tasks if not t.is_done]
    reviews = {r.id: r for r in generate_review_sessions(data.courses, window_start, window_days)}
    # Meal sessions (scheduler.py's meal-window handling) share ONE synthetic
    # task per meal type across all `window_days` occurrences ("meal_lunch",
    # not one task per day) -- so this needs de-duplication reviews.get()
    # above doesn't: each review's own task_id is already unique to its one
    # occurrence, but 14 lunch sessions all point at the same "meal_lunch".
    meal_task_ids_seen: set[str] = set()
    MEAL_TITLES = {"meal_breakfast": "Breakfast & Shower", "meal_lunch": "Lunch", "meal_dinner": "Dinner"}
    # Windowed commitments (scheduler.py's commitment handling, mode ==
    # "windowed") are the general-purpose version of the same problem meals
    # already solved -- same fix, same reason: frontend/src/lib/adapters.js
    # drops any `type: "flexible"` session with no task_id from every view.
    # A LOCKED commitment never reaches here at all (it's kind="fixed",
    # task_id=None, and renders the same way a class already does -- no
    # synthetic task needed). b.title already holds the real display name
    # (set in scheduler.py's extraction), unlike meals' fixed MEAL_TITLES
    # lookup -- a commitment's name is free text the user chose, not one of
    # three known values.
    commitment_task_ids_seen: set[str] = set()
    sessions = []
    for b in result.placed:
        if b.start is None or b.end is None:
            continue
        fixed = b.kind == "fixed"
        review = reviews.get(b.task_id)
        if review:
            tasks.append({"_id": review.task_id, "course_id": review.course_id,
                          "display_title": review.title, "source_assignment": review.title,
                          "status": "not_started", "due_at": wall(review.due_at),
                          "priority_weight": 1, "est_duration_min": review.duration_min})
        elif b.task_id in MEAL_TITLES and b.task_id not in meal_task_ids_seen:
            meal_task_ids_seen.add(b.task_id)
            title = MEAL_TITLES[b.task_id]
            # No real deadline -- a meal is a standing routine, not something
            # "due." Nominally due at the end of the window so it sorts like
            # any other task without implying a countdown that isn't real.
            tasks.append({"_id": b.task_id, "course_id": None, "display_title": title,
                          "source_assignment": title, "status": "not_started",
                          "due_at": wall(window_start + timedelta(days=window_days)),
                          "priority_weight": 1, "est_duration_min": round((b.end-b.start).total_seconds()/60)})
        elif (b.task_id and b.task_id.startswith("commitment_")
              and b.task_id not in commitment_task_ids_seen):
            commitment_task_ids_seen.add(b.task_id)
            tasks.append({"_id": b.task_id, "course_id": None, "display_title": b.title,
                          "source_assignment": b.title, "status": "not_started",
                          "due_at": wall(window_start + timedelta(days=window_days)),
                          "priority_weight": 1, "est_duration_min": round((b.end-b.start).total_seconds()/60)})
        # locked: true for a real fixed block, same as always, OR for a
        # flexible session that came in via locked_sessions (SCHEMA.md's own
        # sense of "locked" -- frozen from re-solves -- already matches what
        # a preserved-past session is; result.locked_ids is how
        # build_and_solve reports which ids those were this solve).
        sessions.append({"_id": b.id, "task_id": b.task_id, "course_id": b.course_id,
                         "type": "fixed" if fixed else "flexible", "action": b.title,
                         "intensity": "moderate", "duration_min": round((b.end-b.start).total_seconds()/60),
                         "locked": fixed or b.id in result.locked_ids, "completed": False,
                         "start": wall(b.start), "end": wall(b.end)})
    gap = None
    if result.objective_value is not None and result.best_bound is not None and result.objective_value != 0:
        gap = max(0, result.best_bound-result.objective_value) / abs(result.objective_value)
    return {"courses": courses, "tasks": tasks, "sessions": sessions,
            "windowStart": wall(window_start), "windowDays": window_days,
            "preferences": preferences,
            "run": {"status": "solved", "engine": "CP-SAT", "solverStatus": result.status_name,
                    "objective_value": result.objective_value, "best_bound": result.best_bound,
                    "gap": gap, "solve_seconds": solve_seconds},
            "unplaced": [{"id": b.id, "title": b.title, "kind": b.kind} for b in result.unplaced]}
