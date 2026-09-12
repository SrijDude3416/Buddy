"""Translate a real SolveResult into the existing React calendar contract."""
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
