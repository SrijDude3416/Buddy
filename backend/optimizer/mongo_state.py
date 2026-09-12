"""
Per-user runtime state in Mongo: `preferences` (SCHEMA.md's real field
names/shape) and `optimizer_runs` (the durable "why" log CLAUDE.md
describes). Both are read/write -- unlike mongo_loader.py's read-only
courses/tasks catalog, which is why this is a separate module even though
both lean on mongo_loader.get_db()/DEMO_USER_ID for the same connection and
the same single-implicit-user convention buddy/'s whole demo already runs
on (no auth yet -- root README.md).

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
  - Mongo is read from in exactly one place: /preferences/defaults' cold
    start, to answer "what were this user's preferences last time" instead
    of always resetting to a hardcoded default. Every other request still
    gets its preference state from the browser-held `body.preferences` it
    already sends -- unchanged from before this file existed.
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
