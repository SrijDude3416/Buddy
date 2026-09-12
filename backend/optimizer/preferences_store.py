"""
In-memory preference persistence for the test-data-only API service.

There's no live database yet (by design -- see backend/optimizer/README.md
and the chat history this was built from), so this stands in for the real
`preferences` collection SCHEMA.md describes: a single in-process store, one
implicit test user, reset on server restart. Everything about *how* entries
persist -- singleton vs. accumulating, what "the same scope" means per type,
how removal disambiguates -- is exactly PREFERENCE_API.md §4's model; this
is that model's first real implementation, not a new design.

This module owns the strength-enum -> internal-weight mapping (§10's table)
and the tool-facing type name -> internal Preference.type mapping. Nothing
outside this file should ever construct a raw weight for a tool call --
that's the whole point of §2's safety rule.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from preferences import Preference

# §10's table, verbatim. The starred (tested) values are the `moderate`
# entries for preferred_hours/daily_load_cap and both moderate+firm for
# daily_load_cap; gentle/firm elsewhere are principled interpolations, not
# independently verified -- see PREFERENCE_API.md §10 for which is which.
WEIGHT_MAP: dict[str, dict[str, float]] = {
    "preferred_hours": {"gentle": 10, "moderate": 20, "firm": 30},
    "daily_load_cap": {"gentle": 8, "moderate": 15, "firm": 25},
    "max_continuous_work": {"gentle": 500, "moderate": 1000, "firm": 2000},
}

# Tool-facing preference_type (used in remove_preference and in
# ActivePreferenceOut) -> internal Preference.type (the compiler-registry
# key in preferences.py). Two different vocabularies on purpose -- see
# PREFERENCE_API.md §10 for why the tool names read better to a model
# deciding whether to call them.
TOOL_TO_INTERNAL: dict[str, str] = {
    "preferred_work_hours": "preferred_hours",
    "daily_workload_limit": "daily_load_cap",
    "protected_time_block": "avoid_block",
    "break_habits": "max_continuous_work",
}
INTERNAL_TO_TOOL: dict[str, str] = {v: k for k, v in TOOL_TO_INTERNAL.items()}

# None => singleton (at most one entry of this internal type, ever).
# A function => accumulating; its return value is the scope key two entries
# must share to be considered "the same" (and therefore replace, not add).
ScopeFn = Callable[[dict], tuple]
SCOPE_FNS: dict[str, ScopeFn | None] = {
    "preferred_hours": None,
    "max_continuous_work": None,
    "daily_load_cap": lambda value: tuple(sorted(value.get("days", []))),  # () = every day
    "avoid_block": lambda value: (
        tuple(sorted(value["days"])),
        value["start"],
        value["end"],
    ),
}


@dataclass
class _Entry:
    internal_type: str
    value: dict
    weight: float
    source: str


@dataclass
class AmbiguousRemoval(Exception):
    """Raised when remove_preference can't tell which entry to delete.
    Carries the candidates so the caller can surface them (PREFERENCE_API.md
    §7: 'rejected with the list of current candidates ... don't guess')."""

    preference_type: str
    candidates: list[_Entry]

    def __str__(self) -> str:
        return f"ambiguous removal for {self.preference_type!r}: {len(self.candidates)} candidates"


@dataclass
class NothingToRemove(Exception):
    preference_type: str

    def __str__(self) -> str:
        return f"no active {self.preference_type!r} preference to remove"


class PreferenceStore:
    """One instance = one (implicit) student's active preferences. A real
    multi-user version keys this by user_id; there is exactly one user here,
    so it's just a list."""

    def __init__(self) -> None:
        self._entries: list[_Entry] = []

    def set(self, internal_type: str, value: dict, weight: float, source: str) -> str:
        """Apply §4's persistence model for one write. Returns 'created' or
        'replaced' for the caller to report back (ToolCallResponse.action)."""
        scope_fn = SCOPE_FNS[internal_type]
        if scope_fn is None:
            replaced = self._remove_all(internal_type)
        else:
            scope = scope_fn(value)
            replaced = self._remove_matching(internal_type, lambda e: scope_fn(e.value) == scope)
        self._entries.append(_Entry(internal_type, value, weight, source))
        return "replaced" if replaced else "created"

    def remove(self, tool_type: str, match: dict | None) -> _Entry:
        """§7's disambiguation rule: exactly one candidate or fail loudly,
        never guess among several."""
        internal_type = TOOL_TO_INTERNAL[tool_type]
        candidates = [e for e in self._entries if e.internal_type == internal_type]
        if not candidates:
            raise NothingToRemove(tool_type)

        scope_fn = SCOPE_FNS[internal_type]
        if scope_fn is not None and match:
            # `match` only needs to identify the scope, so check it as a
            # partial match against each candidate's own value -- e.g.
            # {"days": ["Sun"]} against a daily_load_cap entry scoped to
            # exactly ["Sun"].
            narrowed = [e for e in candidates if all(e.value.get(k) == v for k, v in match.items())]
            candidates = narrowed
            if not candidates:
                raise NothingToRemove(tool_type)

        if len(candidates) > 1:
            raise AmbiguousRemoval(tool_type, candidates)

        entry = candidates[0]
        self._entries.remove(entry)
        return entry

    def list_active(self) -> list[_Entry]:
        return list(self._entries)

    def remove_by_source(self, source: str) -> int:
        """Drop every entry written by a given source (e.g. 'onboarding'),
        regardless of internal_type/scope. Not part of PREFERENCE_API.md's
        tool-facing surface (tools always act on one type at a time, per
        §4) -- this exists for frontend_bridge.py's /api/preferences,
        which mirrors createPreferences's `replace_source` semantics: an
        onboarding re-submit should replace the prior onboarding batch
        wholesale, not accumulate next to it. Returns the number removed."""
        before = len(self._entries)
        self._entries = [e for e in self._entries if e.source != source]
        return before - len(self._entries)

    def to_preferences(self) -> list[Preference]:
        """The raw list scheduler.build_and_solve() takes. Always-on system
        defaults (spread_multi_session_tasks, urgency_priority,
        min_gap_between_sessions -- PREFERENCE_API.md §6) are NOT stored
        here; api.py adds those separately at solve time, same as
        run_prototype.py's PROFILES["tuned"] does today."""
        return [Preference(e.internal_type, e.value, e.weight, e.source) for e in self._entries]

    def clear(self) -> None:
        self._entries.clear()

    def _remove_all(self, internal_type: str) -> bool:
        return self._remove_matching(internal_type, lambda e: True)

    def _remove_matching(self, internal_type: str, predicate) -> bool:
        before = len(self._entries)
        self._entries = [
            e for e in self._entries if not (e.internal_type == internal_type and predicate(e))
        ]
        return len(self._entries) != before
