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
    saved if there's no cache yet) and `apply_and_solve`'s own
    past-preserving merge (reads the previous `plan_cache` to know what
    "the past" looked like last time). Every other request still gets its
    preference state from the browser-held `body.preferences` it already
    sends -- unchanged from before this file existed.
"""
from __future__ import annotations

from datetime import datetime, timezone

from mongo_loader import DEMO_USER_ID, get_db
from preferences_store import PreferenceStore


def save_preferences(store: PreferenceStore, user_id: str = DEMO_USER_ID) -> None:
    """Replace-all write. `store.list_active()` is already the fully-resolved
    result of every singleton/accumulating scoping rule in
    preferences_store.py (a later `set()` already dropped whatever it
    superseded) -- dumping it wholesale is correct and idempotent, there's
    no partial-update case to get wrong by doing this instead of a
    per-entry diff."""
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
    db = get_db()
    doc = db.plan_cache.find_one({"user_id": user_id})
    if not doc:
        return None
    doc.pop("_id", None)
    doc.pop("user_id", None)
    doc.pop("cached_at", None)
    return doc


def merge_preserving_past(old_sessions: list[dict], new_sessions: list[dict], now: datetime) -> list[dict]:
    """A fresh solve should never silently rewrite what the user already saw
    happen: once a session's start time is in the past, it's part of the
    record, not something an unrelated preference change (or just clicking
    Recalculate) should reshuffle out from under someone mid-day. Everything
    still in the future is free to come entirely from the new solve.

    `now` and every session's `start` are the same naive local wall-clock
    datetimes plan_payload.py already returns (tzinfo stripped before
    serializing) -- plain datetime comparison, not a tz-aware one.

    `_id` is stable across solves for the same logical session -- decompose.py
    assigns it deterministically from `{task.id}__s{n}` (a pure function of
    the task, not of any particular solve's placement) -- but CP-SAT is free
    to place that same id at a different time on every solve. That means the
    SAME `_id` can legitimately be "past" in `old_sessions` (frozen at
    whatever time it was last shown) and independently "future" in
    `new_sessions` (the fresh solve's own, unrelated placement for it) --
    without deduplicating, both copies survive the partition below and ship
    to React as two elements with the same `key`, exactly the duplicate-key
    warning that surfaced this. The old, already-shown time always wins for
    an id that's past; the new solve's placement for that id is simply
    dropped rather than shown a second time in the future.

    Known simplification: past/future is still decided by time only, not
    matched to course/preference selection -- if `old_sessions` came from a
    different course selection than `new_sessions`, a past session from a
    course no longer selected still carries over. Fine for a single-student
    demo with no course-removal flow exercised yet; a real multi-selection
    product would want to intersect on course_id too."""
    # Also de-dupes WITHIN old_sessions by _id (first occurrence wins) --
    # defensive against a plan_cache document saved before this function
    # de-duplicated past/future itself; a stale duplicate already in Mongo
    # should self-heal on the next solve, not get carried forward forever.
    past, seen = [], set()
    for s in old_sessions:
        if datetime.fromisoformat(s["start"]) < now and s["_id"] not in seen:
            past.append(s)
            seen.add(s["_id"])
    future = [
        s for s in new_sessions
        if datetime.fromisoformat(s["start"]) >= now and s["_id"] not in seen
    ]
    return past + future
