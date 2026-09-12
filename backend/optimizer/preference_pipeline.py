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
import mongo_loader
from request_identity import current_user, mongo_user_id
import scheduler
from preferences_store import PreferenceStore, WEIGHT_MAP
from plan_payload import to_plan_payload

ToolName = Literal["set_preferred_work_hours", "set_daily_workload_limit", "protect_time_block",
                   "set_break_habits", "set_task_spacing", "set_urgency_emphasis", "set_minimum_gap",
                   "set_meal_window", "set_commitment", "add_task", "remove_task",
                   "remove_preference", "list_current_preferences"]


class PreferenceCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ToolName
    arguments: dict = Field(default_factory=dict)


class MeetingTimeOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: list[Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]] = Field(min_length=1)
    start_time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    end_time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    location: str | None = None


class CourseOverride(BaseModel):
    """A course the caller supplies rather than one this service loaded at
    startup -- the real section a student picked out of the course catalog,
    with the meeting times of that specific lecture/recitation.

    Deliberately the same shape as api_models.CourseIn (/solve's course), so
    there is one representation of "a course with meeting times" on this
    service's wire, not two. Overrides are per-request and never mutate
    api.DATA: a solve for one student can't change what another sees.

    A course supplied this way usually has no `tasks` here -- the catalog knows
    when a class meets, not what is due in it -- so it contributes fixed blocks
    and no study sessions. That is the honest outcome, not a degraded one.
    """
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    meeting_times: list[MeetingTimeOverride] = Field(default_factory=list, max_length=20)


class PreferenceBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operations: list[PreferenceCall] = Field(default_factory=list, max_length=12)
    preferences: list[PreferenceCall] = Field(default_factory=list, max_length=50)
    course_ids: list[str] | None = Field(default=None, min_length=1, max_length=6)
    courses: list[CourseOverride] | None = Field(default=None, max_length=6)


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
        elif entry.internal_type == "max_continuous_work":
            name, args = "set_break_habits", {"break_minutes": value["break_minutes"], "strength": tier}
        elif entry.internal_type == "spread_multi_session_tasks":
            name, args = "set_task_spacing", {"strength": tier}
        elif entry.internal_type == "urgency_priority":
            name, args = "set_urgency_emphasis", {"strength": tier}
        elif entry.internal_type == "min_gap_between_sessions":
            name, args = "set_minimum_gap", {"minutes": value["minutes"]}
        elif entry.internal_type == "meal_window":
            name, args = "set_meal_window", {"meal": value["meal"], "start_time": value["start"],
                                              "end_time": value["end"], "duration_minutes": value["duration_minutes"]}
        elif entry.internal_type == "commitment":
            name, args = "set_commitment", {"name": value["name"], "mode": value["mode"],
                                             "start_time": value["start"], "end_time": value["end"]}
            if value.get("days"):
                args["days"] = value["days"]
            if value.get("duration_minutes") is not None:
                args["duration_minutes"] = value["duration_minutes"]
        else:
            # A genuinely unrecognized internal_type is a bug upstream (a
            # new preferences.py compiler registered without a matching tool
            # here) -- skip it rather than crash the whole response over one
            # bad entry; CLAUDE.md's "worth surfacing, not hiding" still
            # applies, so print rather than pretend it didn't happen.
            print(f"[preference_pipeline] No tool mapping for internal_type={entry.internal_type!r}; omitting from canonical_preferences.")
            continue
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
        "set_task_spacing": (models.SetTaskSpacingIn, api.set_task_spacing),
        "set_urgency_emphasis": (models.SetUrgencyEmphasisIn, api.set_urgency_emphasis),
        "set_minimum_gap": (models.SetMinimumGapIn, api.set_minimum_gap),
        "set_meal_window": (models.SetMealWindowIn, api.set_meal_window),
        "set_commitment": (models.SetCommitmentIn, api.set_commitment),
        "remove_preference": (models.RemovePreferenceIn, api.remove_preference),
    }

    def _pipeline_remove_task(call, pending_tasks, pending_removed_ids):
        # Different from api.remove_task (used as-is by the bare /tools/*
        # surface): that one mutates whatever list it's given immediately,
        # matching its "no isolation" character. This pipeline can't do that
        # for an already-committed task -- api.DATA.tasks is process-global,
        # shared across every request, and the whole point of building this
        # per-request is that a cancelled/failed request leaves no trace
        # (same guarantee `store` already gives preferences). So: a task
        # added earlier in THIS SAME request is still only in `pending_tasks`
        # (nothing durable to undo) and gets removed there directly; an
        # already-committed task instead gets its id staged in
        # `pending_removed_ids`, actually removed from api.DATA.tasks/Mongo
        # only after this request's solve succeeds (see apply_and_solve's
        # own post-solve block).
        try:
            body = models.RemoveTaskIn.model_validate(call.arguments)
        except ValidationError as exc:
            raise HTTPException(422, {"message": "Invalid arguments for remove_task", "errors": exc.errors(include_context=False)})
        match = next((t for t in pending_tasks if t.id == body.task_id), None)
        if match is not None:
            pending_tasks.remove(match)
        else:
            match = next((t for t in api.DATA.tasks if t.id == body.task_id and t.id not in pending_removed_ids), None)
            if match is None:
                raise HTTPException(404, f"no task with id {body.task_id!r}")
            pending_removed_ids.add(body.task_id)
        return models.TaskCallResponse(
            action="removed", task_id=match.id, title=match.title, course_id=match.course_id,
            due_at=match.due_at, est_duration_min=match.est_duration_min,
            splittable=match.splittable, session_plan=match.session_plan, resolve=None,
        ).model_dump()

    def execute(call, store, pending_tasks, pending_removed_ids):
        if call.name == "list_current_preferences":
            if call.arguments:
                raise HTTPException(422, "list_current_preferences takes no arguments")
            return [e.model_dump() for e in api.list_current_preferences(store=store)]
        if call.name == "add_task":
            try:
                body = models.AddTaskIn.model_validate(call.arguments)
            except ValidationError as exc:
                raise HTTPException(422, {"message": "Invalid arguments for add_task", "errors": exc.errors(include_context=False)})
            if body.course_id not in api.DATA.courses:
                raise HTTPException(422, f"Unknown course_id {body.course_id!r}")
            new_task = api._build_task_from_input(body)
            pending_tasks.append(new_task)
            return api._task_response("created", new_task, resolve=False, store=store).model_dump()
        if call.name == "remove_task":
            return _pipeline_remove_task(call, pending_tasks, pending_removed_ids)
        model, handler = handlers[call.name]
        try:
            body = model.model_validate(call.arguments)
        except ValidationError as exc:
            raise HTTPException(422, {"message": f"Invalid arguments for {call.name}", "errors": exc.errors(include_context=False)})
        return handler(body, resolve=False, store=store).model_dump()

    @app.post("/preferences/operations")
    def apply_and_solve(body: PreferenceBatch):
        try:
            source = mongo_loader.load_data(mongo_user_id()) if current_user.get() else api.DATA
        except Exception as exc:
            raise HTTPException(503, "Could not load your MongoDB courses and tasks.") from exc
        store = PreferenceStore()
        # Per-request-isolated, exactly like `store` -- see _pipeline_remove_task's
        # own comment for why removal in particular can't just mutate
        # api.DATA.tasks directly the way api.py's bare endpoints do.
        pending_tasks: list[data_loader.Task] = []
        pending_removed_ids: set[str] = set()
        for call in body.preferences:
            if call.name in ("remove_preference", "list_current_preferences", "add_task", "remove_task"):
                raise HTTPException(422, "Saved preferences must contain only active preference setters")
            execute(call, store, pending_tasks, pending_removed_ids)
        applied = []
        for call in body.operations:
            output = execute(call, store, pending_tasks, pending_removed_ids)
            applied.append({"name": call.name, "arguments": call.arguments,
                            "endpoint": f"/tools/{call.name}",
                            "method": "GET" if call.name == "list_current_preferences" else "POST",
                            "result": output})
        preferences = canonical_preferences(store)
        # A caller-supplied course wins over one of the same id loaded at startup:
        # the student picked a specific section, and that beats whatever generic
        # meeting time this service happens to have for the course.
        overrides = {
            c.id: data_loader.Course(
                id=c.id,
                name=c.name,
                meeting_times=[
                    data_loader.MeetingTime(mt.days, mt.start_time, mt.end_time, mt.location)
                    for mt in c.meeting_times
                ],
            )
            for c in (body.courses or [])
        }
        available = {**source.courses, **overrides}
        selected = set(body.course_ids) if body.course_ids is not None else set(available)
        if not selected.issubset(available):
            raise HTTPException(422, "Unknown course ID")
        data = data_loader.ScheduleData(
            generated_at=source.generated_at,
            courses={k: c for k, c in available.items() if k in selected},
            # Only startup-loaded courses have tasks. An overridden course with no
            # tasks contributes its class blocks and nothing else -- see CourseOverride.
            # pending_removed_ids/pending_tasks (add_task/remove_task, this
            # request's operations) are folded in here -- BEFORE the solve,
            # not after -- so a just-added task is actually schedulable this
            # same solve and a just-removed one genuinely stops competing for
            # space, matching every other operation's "applies to this solve"
            # contract.
            tasks=[t for t in api.DATA.tasks if t.course_id in selected and t.id not in pending_removed_ids]
                  + [t for t in pending_tasks if t.course_id in selected],
        )
        # Past-preserving lock: whatever the previous cached plan showed for
        # flexible sessions already behind "now" gets fed into THIS solve as
        # locked, mandatory intervals -- not merged in afterward. A fresh
        # solve should never silently rewrite what the user already saw
        # happen, and the only way to actually guarantee that (not just
        # hope two independent solves agree) is to make CP-SAT's own
        # AddNoOverlap aware of them, the same way a fixed class block
        # already works. `now` is real wall-clock time (not the fixed
        # WINDOW_START demo anchor), kept tz-aware in the same tz
        # WINDOW_START itself uses throughout this block -- scheduler.py's
        # own window_start/window_end are tz-aware, and mixing naive/aware
        # datetimes raises TypeError the moment this comparison actually
        # runs against a non-empty locked set (found by testing multiple
        # solves in a row, not by inspection -- the first solve after a
        # cache clear has nothing to lock, so this path went unexercised
        # until a second one). Only `type: "flexible"` sessions are locked
        # -- fixed blocks (classes, routine) are regenerated identically
        # every solve already, from `courses.meeting_times`/ROUTINE,
        # deterministically by weekday.
        now = datetime.now(api.WINDOW_START.tzinfo)
        locked_sessions: list[scheduler.PlacedBlock] = []
        # Every flexible session from the previous cached plan -- past AND
        # future -- doubles as a solution hint for this solve (scheduler.py's
        # `hint_placements`): the past ones are redundant with locked_sessions
        # below (their ids get excluded from this solve's own decomposition
        # entirely, so the hint lookup for them is simply never consulted),
        # but the still-future ones are exactly the "small perturbation of a
        # schedule you already have" case CLAUDE.md's chat-feedback loop
        # produces on every message -- warm-starting CP-SAT from where they
        # already sat lets it spend the time budget improving on a
        # near-optimal incumbent instead of rediscovering one from nothing.
        hint_placements: list[scheduler.PlacedBlock] = []
        try:
            previous = mongo_state.load_plan_cache()
            for s in (previous or {}).get("plan", {}).get("sessions", []):
                if s.get("type") != "flexible":
                    continue
                # plan_payload.py's wall() strips tzinfo before serializing
                # (wire format is naive local wall-clock); scheduler.py's own
                # window_start/window_end are tz-aware -- re-attach the same
                # fixed offset here or the comparisons inside build_and_solve
                # raise "can't compare offset-naive and offset-aware
                # datetimes" the moment locked_sessions is ever non-empty.
                start = datetime.fromisoformat(s["start"]).replace(tzinfo=api.WINDOW_START.tzinfo)
                end = datetime.fromisoformat(s["end"]).replace(tzinfo=api.WINDOW_START.tzinfo)
                block = scheduler.PlacedBlock(
                    id=s["_id"], task_id=s.get("task_id"), course_id=s.get("course_id"),
                    title=s.get("action", ""), kind="flexible",
                    start=start, end=end,
                )
                hint_placements.append(block)
                if start < now:
                    locked_sessions.append(block)
        except Exception as exc:
            print(f"[preference_pipeline] Could not load previous plan for past-locking/hinting ({exc}); solving with nothing locked or hinted.")

        if not _SOLVE_LOCK.acquire(timeout=25):
            raise HTTPException(503, "The optimizer is busy. Please retry.")
        try:
            started = time.perf_counter()
            result = scheduler.build_and_solve(
                data, window_start=api.WINDOW_START, window_days=api.WINDOW_DAYS,
                preferences=[*api.ALWAYS_ON_DEFAULTS, *store.to_preferences()],
                personal_blocks=api.ROUTINE,
                locked_sessions=locked_sessions,
                hint_placements=hint_placements,
                now_slot=max(0, int((now - api.WINDOW_START).total_seconds() // (scheduler.SLOT_MINUTES * 60))),
                max_time_in_seconds=float(os.environ.get("BUDDY_SOLVE_SECONDS", "15")),
                relative_gap_limit=float(os.environ.get("BUDDY_SOLVE_GAP", "0.005")),
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
            raise HTTPException(409, {"message": "The optimizer could not find a usable schedule. Previous preferences, tasks, and calendar are unchanged.", "status": result.status_name})

        plan = to_plan_payload(result, data, api.WINDOW_START, api.WINDOW_DAYS, preferences, seconds)
        response = {"preferences": preferences, "preference_calls": applied, "plan": plan}

        _try("preferences save", lambda: mongo_state.save_preferences(store))
        # Tasks become durable only now, after a successful solve -- same
        # "no partial commits on a cancelled/failed request" guarantee
        # preferences already have, just via two smaller, surgical writes
        # instead of one replace-all (mongo_state.save_new_tasks's own
        # docstring explains why tasks can't safely use preferences' own
        # delete-then-reinsert-everything pattern). api.DATA.tasks is
        # process-global and read by every other request from this point
        # on -- mutated here, not any earlier, for exactly that reason.
        if pending_removed_ids:
            api.DATA.tasks[:] = [t for t in api.DATA.tasks if t.id not in pending_removed_ids]
            _try("tasks remove (mongo)", lambda: mongo_state.delete_tasks(pending_removed_ids))
        if pending_tasks:
            api.DATA.tasks.extend(pending_tasks)
            _try("tasks save (mongo)", lambda: mongo_state.save_new_tasks(pending_tasks))
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
        # Restores whatever this demo user has saved (mongo_state.py) so a
        # fresh server start, or a brand-new browser tab with no prior
        # state, picks up where the last session left off. There is no
        # hardcoded default preference here anymore -- the "initial
        # calendar"'s one default (preferred_hours, 08:00-17:00, moderate)
        # is real seed data now (seed_mongo.py's seed_default_preferences()),
        # not a magic value materialized only as a side effect of the first
        # solve. If Mongo genuinely has nothing (a fresh cluster nobody's
        # seeded yet, or a transient read failure), this solves with an
        # empty preference set rather than silently re-inventing a default
        # here -- still governed by api.ALWAYS_ON_DEFAULTS's system-level
        # behavior, so the demo still produces *a* calendar, just an
        # honestly unpreferenced one. Printed either way, not silent -- same
        # policy as data_loader.load_data_preferring_mongo.
        calls = []
        try:
            saved = mongo_state.load_preferences()
            calls = [PreferenceCall(**c) for c in canonical_preferences(saved)]
        except Exception as exc:
            print(f"[preference_pipeline] Could not load preferences from MongoDB ({exc}); solving with none.")
        if calls:
            print(f"[preference_pipeline] Restored {len(calls)} saved preference(s) from MongoDB.")
        else:
            print("[preference_pipeline] No preferences saved yet (run seed_mongo.py to seed the default); solving with none.")
        return apply_and_solve(PreferenceBatch(preferences=calls))

    @app.get("/preferences/defaults")
    def defaults():
        if current_user.get():
            # Never reuse the process-wide demo cache for a signed-in account.
            return initial_plan.__wrapped__()
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
