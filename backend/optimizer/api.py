"""
FastAPI implementation of PREFERENCE_API.md's §2 (`/solve`) and §5 (the six
tools), plus `GET /plan`. Test-data only, by design -- CLAUDE.md's real
version reads/writes Mongo; this one loads
test-data/schedule_test_data.json once at startup and keeps every
preference in an in-process PreferenceStore (preferences_store.py). There
is exactly one implicit "student" here, matching the fact that there's no
auth or multi-tenancy yet either. Swapping in real persistence later means
replacing this file's global STORE/DATA with a per-request, per-user lookup
-- nothing in scheduler.py, preferences.py, or preferences_store.py's
*logic* needs to change to get there.

Run it:
    source .venv/bin/activate
    uvicorn api:app --reload --port 8000
Then see backend/optimizer/README.md for a curl walkthrough, or open
http://localhost:8000/docs for FastAPI's interactive Swagger UI.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import JSONResponse

import data_loader
import scheduler
from preferences import Preference
from preferences_store import (
    WEIGHT_MAP,
    TOOL_TO_INTERNAL,
    INTERNAL_TO_TOOL,
    PreferenceStore,
    AmbiguousRemoval,
    NothingToRemove,
)
from run_prototype import ROUTINE, NOW as WINDOW_START
from api_models import (
    SolveRequest,
    SolveResponse,
    PlacedBlockOut,
    SetPreferredWorkHoursIn,
    SetDailyWorkloadLimitIn,
    ProtectTimeBlockIn,
    SetBreakHabitsIn,
    RemovePreferenceIn,
    ToolCallResponse,
    SolveSummary,
    ActivePreferenceOut,
)

app = FastAPI(
    title="Buddy optimizer (test-data only)",
    description="Implements PREFERENCE_API.md against test-data/schedule_test_data.json. No live DB.",
)

# --- fixed "test student" state -------------------------------------------
# Loaded once at import time. A real deployment replaces this whole block
# with a per-request Mongo read keyed by user_id; nothing below this point
# needs to know the difference.
DATA = data_loader.load_data()
WINDOW_DAYS = 14  # matches run_prototype.py's default and every tuning run in README.md
STORE = PreferenceStore()
_LAST_SOLVE: SolveResponse | None = None

# PREFERENCE_API.md §6: shapes every schedule regardless of anything else,
# never chat-toggleable. Identical to run_prototype.py's "tuned" profile's
# always-on entries -- kept here, not imported from there, because
# run_prototype.py is a standalone CLI script, not a library this service
# should depend on for its own defaults.
ALWAYS_ON_DEFAULTS: list[Preference] = [
    Preference("min_gap_between_sessions", {"minutes": 15}, weight=0),  # hard
    Preference("spread_multi_session_tasks", {}, weight=25),
    Preference("urgency_priority", {}, weight=8),
]


# --------------------------------------------------------------------------
# Shared solve machinery
# --------------------------------------------------------------------------


def _to_solve_response(result: scheduler.SolveResult, solve_seconds: float) -> SolveResponse:
    gap_pct = None
    if result.objective_value:
        # (best_bound - objective_value) / objective_value -- NOT the other
        # way around. See PREFERENCE_API.md §2's response spec: this exact
        # sign was implemented backwards once already this project (a
        # negative gap on any non-OPTIMAL FEASIBLE run, i.e. >100%
        # "optimized"). Do not "simplify" this without re-reading why.
        gap_pct = (result.best_bound - result.objective_value) / result.objective_value

    def block(b) -> PlacedBlockOut:
        return PlacedBlockOut(
            id=b.id, task_id=b.task_id, course_id=b.course_id, title=b.title,
            kind=b.kind, start=b.start, end=b.end,
        )

    return SolveResponse(
        status=result.status_name,
        objective_value=result.objective_value,
        best_bound=result.best_bound,
        gap_pct=gap_pct,
        solve_seconds=solve_seconds,
        placed=[block(b) for b in result.placed],
        unplaced=[block(b) for b in result.unplaced],
    )


def _run_solve_for_student(preferences: list[Preference], max_time_in_seconds: float = 15.0) -> SolveResponse:
    """The one path every tool call and GET /plan goes through -- always
    includes ALWAYS_ON_DEFAULTS on top of whatever the store currently
    holds, exactly like run_prototype.py's "tuned" profile does."""
    import time

    t0 = time.perf_counter()
    result = scheduler.build_and_solve(
        DATA,
        window_start=WINDOW_START,
        window_days=WINDOW_DAYS,
        preferences=[*ALWAYS_ON_DEFAULTS, *preferences],
        personal_blocks=ROUTINE,
        max_time_in_seconds=max_time_in_seconds,
    )
    solve_seconds = time.perf_counter() - t0
    return _to_solve_response(result, solve_seconds)


# --------------------------------------------------------------------------
# POST /solve -- PREFERENCE_API.md §2. Stateless: takes a full payload,
# returns a result, never touches STORE. This is the service-to-service
# contract; whoever assembles courses/tasks/preferences (Next.js, today
# nothing) owns that. Also includes ALWAYS_ON_DEFAULTS, per §6's "shapes
# every schedule regardless of anything above" -- interpreted as applying
# here too, not just to tool-triggered solves; flagged in README.md as an
# interpretation worth confirming, since §2 didn't spell this out.
# --------------------------------------------------------------------------


@app.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    courses = {
        c.id: data_loader.Course(
            id=c.id,
            name=c.name,
            meeting_times=[
                data_loader.MeetingTime(mt.days, mt.start_time, mt.end_time, mt.location)
                for mt in c.meeting_times
            ],
        )
        for c in req.courses
    }
    tasks = [
        data_loader.Task(
            id=t.id, course_id=t.course_id, title=t.title, due_at=t.due_at,
            est_duration_min=t.est_duration_min,
            est_duration_is_guess=False,  # provenance-only field; unused by decompose/scheduler
            splittable=t.splittable, status=t.status,
        )
        for t in req.tasks
    ]
    data = data_loader.ScheduleData(generated_at=req.window_start, courses=courses, tasks=tasks)
    personal_blocks = [
        data_loader.MeetingTime(mt.days, mt.start_time, mt.end_time, mt.location)
        for mt in req.personal_blocks
    ]
    preferences = [Preference(p.type, p.value, p.weight, p.source) for p in req.preferences]

    import time

    t0 = time.perf_counter()
    result = scheduler.build_and_solve(
        data,
        window_start=req.window_start,
        window_days=req.window_days,
        preferences=[*ALWAYS_ON_DEFAULTS, *preferences],
        personal_blocks=personal_blocks,
        max_time_in_seconds=req.max_time_in_seconds,
    )
    solve_seconds = time.perf_counter() - t0
    return _to_solve_response(result, solve_seconds)


# --------------------------------------------------------------------------
# GET /plan -- the latest solve for the one test student. Not a SCHEMA.md
# `sessions` document (no action/intensity/locked/completed) -- see
# PREFERENCE_API.md §2's "what this response is not." If nothing has solved
# yet, runs one now against whatever the (possibly empty) store holds,
# rather than erroring -- a fresh student with zero preferences set still
# has a real, if plain, schedule.
# --------------------------------------------------------------------------


@app.get("/plan", response_model=SolveResponse)
def get_plan() -> SolveResponse:
    global _LAST_SOLVE
    if _LAST_SOLVE is None:
        _LAST_SOLVE = _run_solve_for_student(STORE.to_preferences())
    return _LAST_SOLVE


# --------------------------------------------------------------------------
# Tools -- PREFERENCE_API.md §5. Each one: validate (Pydantic), map
# strength -> weight (WEIGHT_MAP, never a caller-supplied number), persist
# via PreferenceStore per §4's singleton/accumulating rules, then resolve
# (§2: a write always triggers a re-solve; `resolve=false` is a
# testing-only escape hatch not in the spec, for stacking several
# preferences quickly without waiting ~15s each time).
# --------------------------------------------------------------------------


def _tool_response(internal_type: str, value: dict, weight: float | None, action: str, resolve: bool, store: PreferenceStore) -> ToolCallResponse:
    summary = None
    if resolve:
        global _LAST_SOLVE
        _LAST_SOLVE = _run_solve_for_student(store.to_preferences())
        summary = SolveSummary(
            status=_LAST_SOLVE.status,
            objective_value=_LAST_SOLVE.objective_value,
            best_bound=_LAST_SOLVE.best_bound,
            gap_pct=_LAST_SOLVE.gap_pct,
            solve_seconds=_LAST_SOLVE.solve_seconds,
            placed_count=len(_LAST_SOLVE.placed),
            unplaced_count=len(_LAST_SOLVE.unplaced),
        )
    return ToolCallResponse(
        preference_type=INTERNAL_TO_TOOL.get(internal_type, internal_type),
        action=action, value=value, weight=weight, resolve=summary,
    )


def get_preference_store() -> PreferenceStore:
    return STORE


@app.post("/tools/set_preferred_work_hours", response_model=ToolCallResponse)
def set_preferred_work_hours(body: SetPreferredWorkHoursIn, resolve: bool = True, store: PreferenceStore = Depends(get_preference_store)) -> ToolCallResponse:
    value = {"start": body.start_time, "end": body.end_time}
    weight = WEIGHT_MAP["preferred_hours"][body.strength]
    action = store.set("preferred_hours", value, weight, source="chat")
    return _tool_response("preferred_hours", value, weight, action, resolve, store)


@app.post("/tools/set_daily_workload_limit", response_model=ToolCallResponse)
def set_daily_workload_limit(body: SetDailyWorkloadLimitIn, resolve: bool = True, store: PreferenceStore = Depends(get_preference_store)) -> ToolCallResponse:
    value: dict = {"minutes": body.minutes_per_day}
    if body.days:
        value["days"] = body.days
    weight = WEIGHT_MAP["daily_load_cap"][body.strength]
    action = store.set("daily_load_cap", value, weight, source="chat")
    return _tool_response("daily_load_cap", value, weight, action, resolve, store)


@app.post("/tools/protect_time_block", response_model=ToolCallResponse)
def protect_time_block(body: ProtectTimeBlockIn, resolve: bool = True, store: PreferenceStore = Depends(get_preference_store)) -> ToolCallResponse:
    value = {"days": body.days, "start": body.start_time, "end": body.end_time}
    action = store.set("avoid_block", value, weight=0, source="chat")  # hard constraint; weight unused
    return _tool_response("avoid_block", value, None, action, resolve, store)


@app.post("/tools/set_break_habits", response_model=ToolCallResponse)
def set_break_habits(body: SetBreakHabitsIn, resolve: bool = True, store: PreferenceStore = Depends(get_preference_store)) -> ToolCallResponse:
    value = {"break_minutes": body.break_minutes}
    weight = WEIGHT_MAP["max_continuous_work"][body.strength]
    action = store.set("max_continuous_work", value, weight, source="chat")
    return _tool_response("max_continuous_work", value, weight, action, resolve, store)


@app.post("/tools/remove_preference", response_model=ToolCallResponse)
def remove_preference(body: RemovePreferenceIn, resolve: bool = True, store: PreferenceStore = Depends(get_preference_store)) -> ToolCallResponse:
    try:
        entry = store.remove(body.preference_type, body.match)
    except NothingToRemove:
        raise HTTPException(status_code=404, detail=f"no active {body.preference_type!r} preference to remove")
    except AmbiguousRemoval as exc:
        # §7: "rejected with the list of current candidates ... don't
        # guess." 409 Conflict, not 422 -- the request was well-formed, it's
        # the current state that makes it ambiguous.
        raise HTTPException(
            status_code=409,
            detail={
                "error": f"ambiguous removal for {body.preference_type!r}",
                "candidates": [{"value": c.value, "weight": c.weight} for c in exc.candidates],
            },
        )
    return _tool_response(entry.internal_type, entry.value, entry.weight, "removed", resolve, store)


@app.get("/tools/list_current_preferences", response_model=list[ActivePreferenceOut])
def list_current_preferences(store: PreferenceStore = Depends(get_preference_store)) -> list[ActivePreferenceOut]:
    return [
        ActivePreferenceOut(
            preference_type=INTERNAL_TO_TOOL.get(e.internal_type, e.internal_type),
            internal_type=e.internal_type, value=e.value, weight=e.weight, source=e.source,
        )
        for e in store.list_active()
    ]


# --------------------------------------------------------------------------
# Dev-only convenience, not part of PREFERENCE_API.md.
# --------------------------------------------------------------------------


@app.post("/reset")
def reset() -> dict:
    """Clears every active preference and the cached plan. For repeatable
    manual testing only -- there is no equivalent in the spec because a
    real deployment has no notion of 'reset the whole system', only
    per-student state that doesn't need wiping between tests."""
    global _LAST_SOLVE
    STORE.clear()
    _LAST_SOLVE = None
    return {"reset": True}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "courses": len(DATA.courses), "tasks": len(DATA.tasks)}


# The integrated app batches the same preference endpoint handlers with an
# isolated store, then runs the real optimizer exactly once per request.
from preference_pipeline import register_pipeline
register_pipeline(app)
