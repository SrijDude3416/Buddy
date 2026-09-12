"""
Demo-only bridge between PREFERENCE_API.md's real, tested contract (api.py)
and the Frontend branch's independently-designed REST contract
(frontend/src/lib/endpoints.js).

Why this file exists: the two sides were built in parallel against two
different, un-reconciled designs --

  - preference catalog: my 8 internal types (preferred_hours, avoid_block,
    daily_load_cap, ...) vs. Frontend's 4 (preferred_hours, avoid_block,
    weight_adjustment, session_length) -- two of the four overlap by name
    and are translated below; the other two have no compiler/decomposition
    hook on my side yet and are accepted-but-not-applied, not faked.
  - horizon: my window is 14 days (README.md's tuning was all done at 14);
    Frontend's preferenceCatalog.js assumes a 7-day rolling week. This
    bridge keeps my 14-day window -- the extra days just render as more
    calendar than Frontend's own week-view code currently expects to page
    through.
  - run shape: my /solve and /plan are synchronous, one-shot. Frontend
    expects POST /optimizer/runs -> poll GET .../:id -> terminal status ->
    GET /plan, matching a real async job. This file fakes that: the POST
    starts a real (blocking) CP-SAT solve on a background thread and
    returns immediately; the GET polls that thread's result. `stage` only
    ever reports "solving" then "finalizing" -- there's no per-constraint
    progress callback in scheduler.py to report finer stages from, so the
    frontend's own client-side ticker (useOptimizerRun.js) fills the gap,
    exactly as it's designed to for a real backend that under-reports.
  - session shape: my SolveResult.placed items don't carry action/
    intensity/locked/completed (PREFERENCE_API.md §2 says so explicitly --
    "what this response is not"). Sensible defaults are invented below and
    called out inline; nothing here is measured or tuned like the rest of
    this project's numbers are.

This module does NOT change api.py's documented contract. It imports that
module's already-running app and STORE/DATA singletons and adds routes
under /api/*, matching frontend/src/lib/endpoints.js's paths, alongside
the existing /solve, /plan, /tools/* routes. Run it exactly like api.py,
just pointing uvicorn at this module instead:

    uvicorn frontend_bridge:app --reload --port 8000

Then in frontend/.env.local:
    VITE_API_MODE=live
    VITE_API_BASE_URL=/api
and in the frontend's own shell:
    VITE_PROXY_TARGET=http://localhost:8000 npm run dev
"""
from __future__ import annotations

import itertools
import threading
import time
from datetime import datetime, timezone

from fastapi import Body, HTTPException

import data_loader
import scheduler
from api import app, DATA, STORE, ALWAYS_ON_DEFAULTS, WINDOW_START, WINDOW_DAYS, ROUTINE

# --------------------------------------------------------------------------
# Preference translation. Onboarding (frontend/src/lib/onboarding.js) always
# emits `start_slot`/`end_slot` as 15-minute-of-day integers (0-95), matching
# preferences.py's own `_hhmm_to_slot` slot size -- just the opposite
# direction of conversion.
# --------------------------------------------------------------------------

SLOT_MINUTES = 15
_ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Onboarding sends a bare 0-1 float weight, not one of my strength enums --
# there's no principled mapping, so every onboarding preference lands at
# preferences_store.WEIGHT_MAP's "moderate" tier. avoid_block is a hard
# constraint on my side regardless of weight (see preferences.py's
# _compile_avoid_block), so its weight is irrelevant.
_ONBOARDING_WEIGHT = {"preferred_hours": 20}


def _slot_to_hhmm(slot: int) -> str:
    minutes = (slot * SLOT_MINUTES) % (24 * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def bridge_apply_preference_entry(entry: dict) -> bool:
    """Returns True if this entry maps onto a real compiler; False (skipped,
    not faked) otherwise."""
    etype = entry.get("type")
    value = entry.get("value", {})
    if etype == "preferred_hours":
        STORE.set(
            "preferred_hours",
            {"start": _slot_to_hhmm(value["start_slot"]), "end": _slot_to_hhmm(value["end_slot"])},
            _ONBOARDING_WEIGHT["preferred_hours"],
            source=entry.get("source", "onboarding"),
        )
        return True
    if etype == "avoid_block":
        # Onboarding's avoid_block has no `days` field (it's meant as "this
        # time, every day"); my avoid_block compiler requires one. Applying
        # it to every day of the week is the literal reading of "this is
        # when I'm unavailable," not a guess at a narrower one.
        STORE.set(
            "avoid_block",
            {"days": list(_ALL_DAYS), "start": _slot_to_hhmm(value["start_slot"]), "end": _slot_to_hhmm(value["end_slot"])},
            0,
            source=entry.get("source", "onboarding"),
        )
        return True
    # weight_adjustment (per-task reweighting) and session_length
    # (decomposition-stage chunk size) have no equivalent anywhere in
    # preferences.py or decompose.py yet -- see PREFERENCE_API.md §9's
    # "planned, not available" list. Accepted so onboarding doesn't error,
    # not silently pretended to take effect.
    return False


@app.post("/api/preferences")
def bridge_create_preferences(body: dict = Body(...)):
    entries = body.get("entries", [])
    replace_source = body.get("replace_source")
    if replace_source:
        # Matches createPreferences's own contract (frontend/src/lib/
        # endpoints.js's comment on the route, and mock/handlers.js's
        # literal behavior): a re-submit under the same source replaces
        # the prior batch instead of piling on top of it. Onboarding always
        # sends replace_source: 'onboarding', so restarting onboarding
        # doesn't leave a stale avoid_block/preferred_hours pair from the
        # first attempt still hard-constraining the solve underneath the
        # new answers -- found by hitting exactly that accumulation bug
        # while testing this bridge end-to-end.
        STORE.remove_by_source(replace_source)
    applied, skipped = [], []
    for entry in entries:
        (applied if bridge_apply_preference_entry(entry) else skipped).append(entry)
    return {"preferences": applied, "skipped_types": sorted({e.get("type") for e in skipped})}


@app.get("/api/preferences")
def bridge_list_preferences():
    return {
        "preferences": [
            {"type": e.internal_type, "value": e.value, "weight": e.weight, "source": e.source}
            for e in STORE.list_active()
        ]
    }


# --------------------------------------------------------------------------
# Course catalog -- GET /api/courses. Frontend's shape carries fields
# (section, term, department, units) my Course dataclass doesn't have;
# reported as null rather than invented.
# --------------------------------------------------------------------------


@app.get("/api/courses")
def bridge_list_courses():
    return {
        "courses": [
            {
                "_id": c.id,
                "code": data_loader.format_course_code(c.name) or c.id,
                "name": c.name,
                "section": None,
                "term": None,
                "department": None,
                "units": None,
                "meeting_times": [
                    {"days": mt.days, "start_time": mt.start_time, "end_time": mt.end_time, "location": mt.location}
                    for mt in c.meeting_times
                ],
            }
            for c in DATA.courses.values()
        ]
    }


# --------------------------------------------------------------------------
# The fake-async run. One CP-SAT solve at a time (it already parallelizes
# internally across cores -- see scheduler.py's num_search_workers -- so
# stacking concurrent solves on top of that would just contend for the same
# cores, not go faster).
# --------------------------------------------------------------------------

_run_seq = itertools.count(1)
RUNS: dict[str, dict] = {}
_SOLVE_LOCK = threading.Lock()
_LAST_BRIDGE_PLAN: dict | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_run(run: dict) -> dict:
    return {k: run.get(k) for k in (
        "run_id", "status", "stage", "progress", "objective_value",
        "best_bound", "gap", "created_at", "completed_at", "message",
    )}


def _build_plan_payload(result: scheduler.SolveResult) -> dict:
    courses = [
        {"_id": c.id, "code": data_loader.format_course_code(c.name) or c.id, "name": c.name}
        for c in DATA.courses.values()
    ]
    tasks = [
        {
            "_id": t.id,
            "course_id": t.course_id,
            "display_title": t.title,
            "source_assignment": t.title,
            "status": t.status,
            "due_at": t.due_at.isoformat(),
            # No priority model exists yet outside urgency_priority's own
            # solve-time weighting -- 1 for every task, not a real signal.
            "priority_weight": 1,
            "est_duration_min": t.est_duration_min,
        }
        for t in DATA.tasks
    ]

    def to_session_doc(b: scheduler.PlacedBlock) -> dict | None:
        if b.start is None or b.end is None:
            return None
        is_fixed = b.kind == "fixed"
        title_lower = b.title.lower()
        # Invented, not measured: SolveResult carries no notion of
        # action/intensity (PREFERENCE_API.md §2's "what this response is
        # not"). Good enough for the calendar to render something legible.
        # A fixed block with no course_id is one of ROUTINE's personal
        # blocks (gym, meals -- see run_prototype.py), not a class meeting;
        # calling that "attend_class" too was wrong (found by actually
        # looking at the rendered calendar: gym showed up as a lecture).
        if is_fixed:
            action = "attend_class" if b.course_id else "personal"
        else:
            action = "review" if "review" in title_lower else "work_on"
        return {
            "_id": b.id,
            "task_id": b.task_id,
            "course_id": b.course_id,
            "type": "fixed" if is_fixed else "flexible",
            "action": action,
            "intensity": "moderate",
            "duration_min": round((b.end - b.start).total_seconds() / 60),
            "locked": is_fixed,
            "completed": False,
            "start": b.start.isoformat(),
            "end": b.end.isoformat(),
            "title": b.title,
        }

    sessions = [d for d in (to_session_doc(b) for b in result.placed) if d is not None]
    return {"courses": courses, "tasks": tasks, "sessions": sessions}


def _solve_worker(run_id: str) -> None:
    global _LAST_BRIDGE_PLAN
    run = RUNS[run_id]
    run["status"] = "running"
    run["stage"] = "compiling"
    try:
        with _SOLVE_LOCK:
            run["stage"] = "solving"
            preferences = STORE.to_preferences()
            t0 = time.perf_counter()
            result = scheduler.build_and_solve(
                DATA,
                window_start=WINDOW_START,
                window_days=WINDOW_DAYS,
                preferences=[*ALWAYS_ON_DEFAULTS, *preferences],
                personal_blocks=ROUTINE,
                max_time_in_seconds=15.0,
            )
            solve_seconds = time.perf_counter() - t0

        _LAST_BRIDGE_PLAN = _build_plan_payload(result)
        gap = None
        if result.objective_value:
            gap = (result.best_bound - result.objective_value) / result.objective_value

        run["objective_value"] = result.objective_value
        run["best_bound"] = result.best_bound
        run["gap"] = gap
        run["solve_seconds"] = solve_seconds
        run["stage"] = "finalizing"
        run["progress"] = 1.0
        run["completed_at"] = _now_iso()
        if result.status_name == "INFEASIBLE":
            run["status"] = "infeasible"
            run["message"] = "Some of this genuinely can't fit before its deadline."
        elif result.status_name not in ("OPTIMAL", "FEASIBLE"):
            run["status"] = "failed"
            run["message"] = f"Solver returned {result.status_name}, not a usable schedule."
        else:
            run["status"] = "solved"
    except Exception as exc:  # a bug here shouldn't leave the frontend polling forever
        run["status"] = "failed"
        run["message"] = str(exc)
        run["completed_at"] = _now_iso()


@app.post("/api/optimizer/runs")
def bridge_start_run(body: dict = Body(default={})):
    run_id = f"run_{next(_run_seq)}"
    run = {
        "run_id": run_id,
        "status": "queued",
        "stage": "ingesting",
        "progress": 0.0,
        "created_at": _now_iso(),
        "completed_at": None,
        "message": None,
    }
    RUNS[run_id] = run
    # NOTE: `body.reset` is intentionally NOT wired to STORE.clear() here.
    # The mock's resetDb() wipes preferences too, which would erase the
    # preferences onboarding just wrote one call earlier (useOptimizerRun.js
    # calls start() with reset defaulting to true on every mount) -- almost
    # certainly not the intended behavior, and not one worth reproducing.
    threading.Thread(target=_solve_worker, args=(run_id,), daemon=True).start()
    return _serialize_run(run)


@app.get("/api/optimizer/runs/{run_id}")
def bridge_get_run(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="no such optimizer run")
    return _serialize_run(run)


@app.post("/api/optimizer/runs/{run_id}/cancel")
def bridge_cancel_run(run_id: str):
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="no such optimizer run")
    # Best-effort, same caveat as useOptimizerRun.js's own cancel(): CP-SAT
    # isn't wired to a cancellation token here, so a running solve keeps
    # running to completion in its thread; only the reported status changes.
    if run["status"] in ("queued", "running"):
        run["status"] = "cancelled"
        run["completed_at"] = _now_iso()
    return _serialize_run(run)


@app.get("/api/plan")
def bridge_get_plan():
    payload = _LAST_BRIDGE_PLAN or {"courses": [], "tasks": [], "sessions": []}
    latest_run = None
    if RUNS:
        latest_id = max(RUNS, key=lambda k: RUNS[k]["created_at"])
        latest_run = _serialize_run(RUNS[latest_id])
    return {**payload, "run": latest_run}
