"""Batch the existing preference endpoint handlers and rebuild with CP-SAT.

Each request uses an isolated PreferenceStore. Its canonical preference state is
returned with the plan. A cancelled/failed request cannot mutate another tab or
leave partly applied preferences behind. No alternative scheduling algorithm.
"""
import os
import time
import threading
from datetime import datetime
from functools import lru_cache
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

import data_loader
import mongo_state
import scheduler
from preferences_store import PreferenceStore, WEIGHT_MAP
from plan_payload import to_plan_payload

ToolName = Literal["set_preferred_work_hours", "set_daily_workload_limit", "protect_time_block",
                   "set_break_habits", "remove_preference", "list_current_preferences"]


class PreferenceCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ToolName
    arguments: dict = Field(default_factory=dict)


class PreferenceBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operations: list[PreferenceCall] = Field(default_factory=list, max_length=12)
    preferences: list[PreferenceCall] = Field(default_factory=list, max_length=50)
    course_ids: list[str] | None = Field(default=None, min_length=1, max_length=6)


def canonical_preferences(store):
    calls = []
    for entry in store.list_active():
        value = entry.value
        tier = next((s for s, w in WEIGHT_MAP.get(entry.internal_type, {}).items() if w == entry.weight), "moderate")
        if entry.internal_type == "preferred_hours":
            name, args = "set_preferred_work_hours", {"start_time": value["start"], "end_time": value["end"], "strength": tier}
        elif entry.internal_type == "daily_load_cap":
            name, args = "set_daily_workload_limit", {"minutes_per_day": value["minutes"], "strength": tier}
            if value.get("days"):
                args["days"] = value["days"]
        elif entry.internal_type == "avoid_block":
            name, args = "protect_time_block", {"days": value["days"], "start_time": value["start"], "end_time": value["end"]}
        else:
            name, args = "set_break_habits", {"break_minutes": value["break_minutes"], "strength": tier}
        calls.append({"name": name, "arguments": args})
    return calls


# CP-SAT already uses worker threads internally. Avoid piling up concurrent solves.
_SOLVE_LOCK = threading.Lock()


def _try(label, fn):
    """Runs a Mongo durability side-effect (mongo_state.py) without ever
    letting it break the request the user is actually waiting on. A chat
    turn that worked but failed to persist is a degraded demo ("this
    session's state won't survive a restart"); a chat turn that worked but
    then raised because of a logging write would be a demo that appears
    broken over a concern the user never asked about. Printed either way --
    same "never silent" policy as data_loader.load_data_preferring_mongo."""
    try:
        fn()
    except Exception as exc:
        print(f"[preference_pipeline] {label} failed ({exc}); continuing without it.")


def register_pipeline(app):
    # Loaded after api.py has defined its handlers. Those handlers are the single
    # implementation for both individual /tools endpoints and the batch endpoint.
    import api
    import api_models as models
    handlers = {
        "set_preferred_work_hours": (models.SetPreferredWorkHoursIn, api.set_preferred_work_hours),
        "set_daily_workload_limit": (models.SetDailyWorkloadLimitIn, api.set_daily_workload_limit),
        "protect_time_block": (models.ProtectTimeBlockIn, api.protect_time_block),
        "set_break_habits": (models.SetBreakHabitsIn, api.set_break_habits),
        "remove_preference": (models.RemovePreferenceIn, api.remove_preference),
    }

    def execute(call, store):
        if call.name == "list_current_preferences":
            if call.arguments:
                raise HTTPException(422, "list_current_preferences takes no arguments")
            return [e.model_dump() for e in api.list_current_preferences(store=store)]
        model, handler = handlers[call.name]
        try:
            body = model.model_validate(call.arguments)
        except ValidationError as exc:
            raise HTTPException(422, {"message": f"Invalid arguments for {call.name}", "errors": exc.errors(include_context=False)})
        return handler(body, resolve=False, store=store).model_dump()

    @app.post("/preferences/operations")
    def apply_and_solve(body: PreferenceBatch):
        store = PreferenceStore()
        for call in body.preferences:
            if call.name in ("remove_preference", "list_current_preferences"):
                raise HTTPException(422, "Saved preferences must contain only active preference setters")
            execute(call, store)
        applied = []
        for call in body.operations:
            output = execute(call, store)
            applied.append({"name": call.name, "arguments": call.arguments,
                            "endpoint": f"/tools/{call.name}",
                            "method": "GET" if call.name == "list_current_preferences" else "POST",
                            "result": output})
        preferences = canonical_preferences(store)
        selected = set(body.course_ids) if body.course_ids is not None else set(api.DATA.courses)
        if not selected.issubset(api.DATA.courses):
            raise HTTPException(422, "Unknown course ID")
        data = data_loader.ScheduleData(
            generated_at=api.DATA.generated_at,
            courses={k: c for k, c in api.DATA.courses.items() if k in selected},
            tasks=[t for t in api.DATA.tasks if t.course_id in selected],
        )
        if not _SOLVE_LOCK.acquire(timeout=25):
            raise HTTPException(503, "The optimizer is busy. Please retry.")
        try:
            started = time.perf_counter()
            result = scheduler.build_and_solve(
                data, window_start=api.WINDOW_START, window_days=api.WINDOW_DAYS,
                preferences=[*api.ALWAYS_ON_DEFAULTS, *store.to_preferences()],
                personal_blocks=api.ROUTINE,
                max_time_in_seconds=float(os.environ.get("BUDDY_SOLVE_SECONDS", "15")),
            )
            seconds = time.perf_counter()-started
        finally:
            _SOLVE_LOCK.release()

        # inputs_snapshot: exactly what this solve was asked to do -- the
        # applied tool calls and the resulting canonical preference set,
        # same shape the response itself already returns, not a re-derived
        # summary that could drift from what the caller actually saw.
        inputs_snapshot = {"course_ids": sorted(selected), "operations": applied, "preferences": preferences}

        if result.status_name not in ("FEASIBLE", "OPTIMAL"):
            _try("optimizer_runs log (infeasible)", lambda: mongo_state.log_optimizer_run(
                status=result.status_name, inputs_snapshot=inputs_snapshot,
                objective_value=None, best_bound=None, gap=None, solve_seconds=seconds,
            ))
            raise HTTPException(409, {"message": "The optimizer could not find a usable schedule. Previous preferences and calendar are unchanged.", "status": result.status_name})

        plan = to_plan_payload(result, data, api.WINDOW_START, api.WINDOW_DAYS, preferences, seconds)

        # Past-preserving merge: whatever the previous cached plan showed for
        # times already behind "now" carries over untouched, rather than a
        # fresh solve silently rewriting a slot the user already saw/acted
        # on. `now` is real wall-clock time (not the fixed WINDOW_START demo
        # anchor) in the same tz WINDOW_START itself uses, then stripped to
        # match plan_payload.py's naive session timestamps.
        try:
            previous = mongo_state.load_plan_cache()
        except Exception as exc:
            previous = None
            print(f"[preference_pipeline] Could not load previous plan for past-preservation ({exc}); using fresh solve as-is.")
        if previous and previous.get("plan", {}).get("sessions"):
            now = datetime.now(api.WINDOW_START.tzinfo).replace(tzinfo=None)
            plan["sessions"] = mongo_state.merge_preserving_past(previous["plan"]["sessions"], plan["sessions"], now)

        response = {"preferences": preferences, "preference_calls": applied, "plan": plan}

        _try("preferences save", lambda: mongo_state.save_preferences(store))
        _try("optimizer_runs log", lambda: mongo_state.log_optimizer_run(
            status=result.status_name, inputs_snapshot=inputs_snapshot,
            objective_value=result.objective_value, best_bound=result.best_bound,
            gap=plan["run"]["gap"], solve_seconds=seconds,
        ))
        # Cached with preference_calls: [] -- a cache HIT should look exactly
        # like a fresh cold-start default (nothing "just applied"), matching
        # what /preferences/defaults already returns on its own fallback path.
        _try("plan cache save", lambda: mongo_state.save_plan_cache(
            {"preferences": preferences, "preference_calls": [], "plan": plan}
        ))

        return response

    @lru_cache(maxsize=1)
    def initial_plan():
        # Prefers whatever this demo user last saved (mongo_state.py) so a
        # fresh server start, or a brand-new browser tab with no prior
        # state, picks up where the last session left off instead of
        # always resetting to a generic 8-5 default. Printed either way,
        # not silent -- same policy as data_loader.load_data_preferring_mongo.
        try:
            saved = mongo_state.load_preferences()
            if saved.list_active():
                calls = [PreferenceCall(**c) for c in canonical_preferences(saved)]
                print(f"[preference_pipeline] Restored {len(calls)} saved preference(s) from MongoDB.")
                return apply_and_solve(PreferenceBatch(preferences=calls))
        except Exception as exc:
            print(f"[preference_pipeline] Could not load saved preferences from MongoDB ({exc}); using default.")
        return apply_and_solve(PreferenceBatch(preferences=[PreferenceCall(
            name="set_preferred_work_hours", arguments={"start_time": "08:00", "end_time": "17:00", "strength": "moderate"},
        )]))

    @app.get("/preferences/defaults")
    def defaults():
        # The actual "don't re-run the optimizer every page load" behavior:
        # a page load is GET /preferences/defaults, and if apply_and_solve
        # has ever completed for this user, mongo_state.plan_cache already
        # has a full, current response sitting there -- return it as-is, no
        # solve. Only a genuinely first-ever load (nothing cached yet) falls
        # through to initial_plan()'s restore-preferences-then-solve path.
        # The frontend's "Recalculate" button (POST /preferences/operations
        # with no new operations) is the explicit, user-requested way to
        # force a fresh solve -- that endpoint is untouched by this cache.
        try:
            cached = mongo_state.load_plan_cache()
            if cached and cached.get("plan", {}).get("sessions"):
                print("[preference_pipeline] Restored cached plan from MongoDB (no solve).")
                return cached
        except Exception as exc:
            print(f"[preference_pipeline] Could not load cached plan ({exc}); solving fresh.")
        return initial_plan()
