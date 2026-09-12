"""
Per-user runtime state in Mongo: `preferences` (SCHEMA.md's real field
names/shape), `optimizer_runs` (the durable "why" log CLAUDE.md describes),
and a `plan_cache` collection that is NOT one of SCHEMA.md's nine -- see its
own docstring below for why that's a deliberate, narrow exception rather
than scope creep. All three are read/write -- unlike mongo_loader.py's
read-only courses/tasks catalog, which is why this is a separate module even
though all of them lean on mongo_loader.get_db()/DEMO_USER_ID for the same
connection and the same single-implicit-user convention buddy/'s whole demo
already runs on (no auth yet -- root README.md).

Persistence policy, chosen specifically to NOT touch
preference_pipeline.py's existing per-request isolation guarantee ("an
error or cancelled request cannot leave a half-applied preference update"
-- buddy/PIPELINE.md):
  - Mongo is written to ONLY after a request's isolated PreferenceStore has
    already produced the result the caller is about to return as success.
    Nothing here is part of the decision that makes a request succeed or
    fail -- it's a durability side-effect of an already-decided outcome,
    same relationship a request log has to the request it logs. Callers
    wrap these in try/except (see preference_pipeline.py) so a transient
    Mongo write failure degrades to "this session's state doesn't persist
    today," never to "the chat request the user is waiting on fails."
  - Mongo is read from in two places: /preferences/defaults' cold start
    (first `plan_cache`, to skip solving entirely when nothing needs to
    change; then `preferences`, to seed a real solve with what was last
    saved if there's no cache yet) and `apply_and_solve`'s past-locking step
    (reads the previous `plan_cache` to know which already-past flexible
    sessions to hand `scheduler.build_and_solve` as `locked_sessions` --
    see that function's docstring for why this moved into the solver
    itself rather than staying a post-hoc merge here). Every other request
    still gets its preference state from the browser-held `body.preferences`
    it already sends -- unchanged from before this file existed.
"""
from __future__ import annotations

from datetime import datetime, timezone

import data_loader
from mongo_loader import DEMO_USER_ID, SEED_SOURCE, get_db
from request_identity import mongo_user_id, request_mode
from preferences_store import PreferenceStore


def save_preferences(store: PreferenceStore, user_id: str = DEMO_USER_ID) -> None:
    """Replace-all write. `store.list_active()` is already the fully-resolved
    result of every singleton/accumulating scoping rule in
    preferences_store.py (a later `set()` already dropped whatever it
    superseded) -- dumping it wholesale is correct and idempotent, there's
    no partial-update case to get wrong by doing this instead of a
    per-entry diff."""
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    db.preferences.delete_many({"user_id": user_id})
    entries = store.list_active()
    if not entries:
        return
    now = datetime.now(timezone.utc)
    db.preferences.insert_many(
        [
            {
                "user_id": user_id,
                "type": e.internal_type,
                "value": e.value,
                "weight": e.weight,
                "source": e.source,
                "source_message_id": None,  # SCHEMA.md: set only when source == "chat" traces to a real message doc; chat_messages isn't persisted yet
                "updated_at": now,
            }
            for e in entries
        ]
    )


def load_preferences(user_id: str = DEMO_USER_ID) -> PreferenceStore:
    """Replays saved entries through the same .set() every live write
    already goes through, not a raw dict copy -- so a store loaded from
    Mongo behaves identically to one built live via tool calls (same
    scope-replace semantics if a future caller ever seeds it
    incrementally, e.g. one entry at a time instead of all at once)."""
    if request_mode.get() == "demo":
        return PreferenceStore()
    user_id = mongo_user_id() or user_id
    db = get_db()
    store = PreferenceStore()
    for doc in db.preferences.find({"user_id": user_id}):
        store.set(doc["type"], doc["value"], doc["weight"], doc["source"])
    return store


def log_optimizer_run(
    *,
    status: str,
    inputs_snapshot: dict,
    objective_value: float | None,
    best_bound: float | None,
    gap: float | None,
    solve_seconds: float,
    user_id: str = DEMO_USER_ID,
) -> None:
    """Append-only -- CLAUDE.md: "the durable 'why' log". Logs every solve
    this demo's Python service actually runs (preference_pipeline.py's
    apply_and_solve is the only path buddy/ exercises), successes and
    infeasible/failed ones alike -- a failed run is exactly the kind of
    thing worth a durable record of, not just the ones that worked."""
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    db.optimizer_runs.insert_one(
        {
            "user_id": user_id,
            "status": status,
            "inputs_snapshot": inputs_snapshot,
            "objective_value": objective_value,
            "best_bound": best_bound,
            "gap": gap,
            "solve_seconds": solve_seconds,
            "created_at": datetime.now(timezone.utc),
        }
    )


# --------------------------------------------------------------------------
# Tasks added/removed via chat (add_task/remove_task, PREFERENCE_API.md).
# Unlike preferences, `tasks` is NOT replace-all-on-every-write here:
# save_preferences() can safely delete-then-reinsert the WHOLE set every
# request because store.list_active() already fully reconstructs it, but
# there is no equivalent full in-memory reconstruction for tasks -- most of
# `DATA.tasks` came from seed_mongo.py's original test-data.json import, and
# collapsing each one back through data_loader.Task's single `title` field
# would flatten Mongo's own display_title/source_assignment distinction for
# documents this feature never touched. So these two write ONLY the specific
# tasks a request actually added or removed, in place, leaving every other
# task's Mongo document exactly as it already was -- the surgical
# equivalent of preferences' "only durable after a successful solve" rule
# (both are called from preference_pipeline.py's apply_and_solve, only
# after `result.status_name` is FEASIBLE/OPTIMAL, same as
# save_preferences()).
# --------------------------------------------------------------------------


def save_new_tasks(tasks: list[data_loader.Task], user_id: str = DEMO_USER_ID) -> None:
    """Inserts each newly chat-added task as its own real `tasks` document --
    `seed_source` matches every other document this project's Python side
    writes (mongo_loader.load_data()'s query filters on it), so a server
    restart picks these back up exactly like the original test-data.json
    import. `session_plan` travels through even when None -- mongo_loader.
    load_data() reads it back with `.get("session_plan")`, so an explicit
    breakdown survives a restart too, not just the same server process."""
    if not tasks:
        return
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    now = datetime.now(timezone.utc)
    db.tasks.insert_many(
        [
            {
                "_id": t.id,
                "seed_source": SEED_SOURCE,
                "user_id": user_id,
                "course_id": t.course_id,
                "source_assignment": t.title,
                "display_title": None,
                "due_at": t.due_at,
                "est_duration_min": t.est_duration_min,
                "splittable": t.splittable,
                "status": t.status,
                "priority_weight": 1.0,
                "actual_time_logged_min": None,
                "session_plan": t.session_plan,
                "source": "chat",
                "created_at": now,
            }
            for t in tasks
        ]
    )


def delete_tasks(task_ids: set[str] | list[str], user_id: str = DEMO_USER_ID) -> None:
    if not task_ids:
        return
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    db.tasks.delete_many({"user_id": user_id, "_id": {"$in": list(task_ids)}})


# --------------------------------------------------------------------------
# plan_cache -- NOT a SCHEMA.md collection. It exists purely so a page load
# (GET /preferences/defaults) can answer "what did we already compute" without
# re-running CP-SAT: a full {preferences, preference_calls, plan} response,
# one document per user, replaced wholesale on every successful solve. The
# optimizer itself never reads this -- build_and_solve only ever sees
# `tasks`+`preferences` (via api.DATA and store.to_preferences()), exactly as
# before; this collection sits entirely above that boundary, at the HTTP
# route-handler layer deciding whether to call build_and_solve at all. It is
# derived, disposable data: deleting it just means the next load solves fresh
# once, same as before this feature existed.
# --------------------------------------------------------------------------


def save_plan_cache(response: dict, user_id: str = DEMO_USER_ID) -> None:
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    db.plan_cache.replace_one(
        {"user_id": user_id},
        {"user_id": user_id, **response, "cached_at": datetime.now(timezone.utc)},
        upsert=True,
    )


def load_plan_cache(user_id: str = DEMO_USER_ID) -> dict | None:
    """Returns the cached {preferences, preference_calls, plan} response, or
    None if nothing's cached yet (a brand-new cluster, or --wipe was run).
    Strips Mongo's own bookkeeping fields so the result is exactly the
    response shape a caller can return as-is."""
    if request_mode.get() == "demo":
        return
    user_id = mongo_user_id() or user_id
    db = get_db()
    doc = db.plan_cache.find_one({"user_id": user_id})
    if not doc:
        return None
    doc.pop("_id", None)
    doc.pop("user_id", None)
    doc.pop("cached_at", None)
    return doc


# --------------------------------------------------------------------------
# Past preservation used to live here, as merge_preserving_past(): a
# Python-side concatenation of "past" sessions from the last cached plan
# with "future" sessions from a brand-new, entirely independent solve.
# Retired -- it had a real, live bug: decompose.py assigns a session's `_id`
# deterministically from `{task.id}__s{n}`, a pure function of the task, not
# of any particular solve's placement, so the SAME id could come back at a
# DIFFERENT time from two different solves. A same-id duplicate across the
# merge was fixable by deduplicating (which this function briefly did), but
# a DIFFERENT id from the old solve and a different id from the new solve
# landing at overlapping times was not fixable this way at all -- CP-SAT's
# AddNoOverlap only ever protects the intervals actually inside ONE model;
# concatenating two separately-solved session lists afterward has no such
# guarantee between them. Confirmed live: two real, different sessions
# overlapping by 15-45 minutes right around the day this was tested.
#
# Fixed properly in scheduler.py instead: build_and_solve() now takes
# `locked_sessions` and adds each one as a real, mandatory CP-SAT interval
# in the SAME AddNoOverlap pool fixed course blocks already use -- so a
# fresh solve's own placements are mathematically guaranteed never to
# collide with a locked one, not just hoped not to. preference_pipeline.py's
# apply_and_solve computes the locked set from the previous plan_cache
# BEFORE solving (any flexible session whose `start` is already behind real
# wall-clock "now") and passes it straight into build_and_solve; there's no
# post-hoc merge step left to have this bug in.
# --------------------------------------------------------------------------
