"""
Preference compiler registry, per CLAUDE.md's non-negotiable: "The LLM never
touches solver code or the schedule directly. It only ever emits typed,
validated preference objects (type, value, weight) from a fixed, enumerable
catalog. A separate, deterministic Python compiler registry -- never the
model -- decides how each type becomes a CP-SAT constraint or objective term."

There's no onboarding/chat flow producing real Preference objects yet, so
every Preference used right now is hand-authored (see run_prototype.py's
PROFILES) as a stand-in for what a real user's answers would eventually
produce. The registry itself doesn't know or care where a Preference came
from -- that's the point of the boundary.

Each compiler receives the shared SessionCtx list (one entry per flexible
session, with its CP-SAT variables already built) and either adds hard
constraints straight to the model, or returns objective terms as
(integer_weight, expr) pairs for scheduler.py to sum into the objective.
Never both halves in the same place -- see CLAUDE.md's weight-normalization
note for why terms need to arrive as comparable integer units.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ortools.sat.python import cp_model


@dataclass
class Preference:
    type: str
    value: dict
    weight: float = 1.0
    source: str = "manual"  # 'manual' until onboarding/chat exist


@dataclass
class SessionCtx:
    """One flexible session's CP-SAT variables, built once in scheduler.py and
    shared across every compiler so they never redeclare the same variable."""

    session_id: str
    task_id: str
    presence: cp_model.IntVar
    start: cp_model.IntVar
    duration_slots: int
    day: cp_model.IntVar          # start // slots_per_day
    minute_of_day: cp_model.IntVar  # start % slots_per_day


def reify_window(
    model: cp_model.CpModel, var: cp_model.IntVar, lo: int, hi: int, name: str
) -> cp_model.IntVar:
    """b <=> (lo <= var < hi), fully reified in both directions.

    CLAUDE.md flags exactly this as easy to get quietly wrong: a
    one-directional implication is safe for a reward term but silently
    broken for a penalty term, since the solver can then dodge the penalty
    for free by leaving the boolean false regardless of var's real value.
    Building both directions once here means every compiler that needs a
    window-membership boolean is safe by construction, reward or penalty.
    """
    below = model.NewBoolVar(f"{name}_below")
    model.Add(var < lo).OnlyEnforceIf(below)
    model.Add(var >= lo).OnlyEnforceIf(below.Not())

    above = model.NewBoolVar(f"{name}_above")
    model.Add(var >= hi).OnlyEnforceIf(above)
    model.Add(var < hi).OnlyEnforceIf(above.Not())

    b = model.NewBoolVar(name)
    model.AddBoolAnd([below.Not(), above.Not()]).OnlyEnforceIf(b)
    model.AddBoolOr([below, above]).OnlyEnforceIf(b.Not())
    return b


def _and(model: cp_model.CpModel, a: cp_model.IntVar, b: cp_model.IntVar, name: str) -> cp_model.IntVar:
    """c <=> (a AND b), as a fresh bool -- used everywhere a preference only
    counts when the session is actually scheduled (gated by `presence`)."""
    c = model.NewBoolVar(name)
    model.AddMultiplicationEquality(c, [a, b])
    return c


def _hhmm_to_slot(hhmm: str, slot_minutes: int) -> int:
    h, m = hhmm.split(":")
    return (int(h) * 60 + int(m)) // slot_minutes


# --------------------------------------------------------------------------
# Compilers. Registry key == Preference.type.
# --------------------------------------------------------------------------


def _compile_preferred_hours(model, pref, sessions, ctx):
    """Reward sessions whose start time-of-day falls in [start, end)."""
    lo = _hhmm_to_slot(pref.value["start"], ctx["slot_minutes"])
    hi = _hhmm_to_slot(pref.value["end"], ctx["slot_minutes"])
    weight = round(pref.weight)
    terms = []
    for i, s in enumerate(sessions):
        in_window = reify_window(model, s.minute_of_day, lo, hi, f"prefhrs_{s.session_id}")
        rewarded = _and(model, in_window, s.presence, f"prefhrs_active_{s.session_id}")
        terms.append((weight, rewarded))
    return terms


def _compile_daily_load_cap(model, pref, sessions, ctx):
    """Penalize flexible-session minutes on any single day beyond the cap.
    This directly targets the "everything piles onto day one" failure mode
    the placeholder objective produced with no preferences at all."""
    cap_minutes = pref.value["minutes"]
    cap_slots = cap_minutes // ctx["slot_minutes"]
    weight_per_slot = round(pref.weight)
    terms = []
    for day in range(ctx["window_days"]):
        active_today = []
        for s in sessions:
            in_day = model.NewBoolVar(f"inday_{day}_{s.session_id}")
            model.Add(s.day == day).OnlyEnforceIf(in_day)
            model.Add(s.day != day).OnlyEnforceIf(in_day.Not())
            active = _and(model, in_day, s.presence, f"dayactive_{day}_{s.session_id}")
            active_today.append((s.duration_slots, active))
        if not active_today:
            continue
        day_load = sum(dur * act for dur, act in active_today)
        overage = model.NewIntVar(0, ctx["total_slots"], f"overage_{day}")
        model.Add(overage >= day_load - cap_slots)
        terms.append((-weight_per_slot, overage))
    return terms


def _compile_min_gap(model, pref, sessions, ctx):
    """Hard constraint: consecutive flexible sessions need a buffer between
    them. Implemented as padded shadow intervals used only for no-overlap --
    the real (start, duration, end) that deadlines/output use is untouched."""
    gap_slots = max(0, pref.value["minutes"] // ctx["slot_minutes"])
    if gap_slots == 0:
        return []
    padded = []
    for s in sessions:
        padded_end = model.NewIntVar(0, ctx["total_slots"] + gap_slots, f"padend_{s.session_id}")
        model.Add(padded_end == s.start + s.duration_slots + gap_slots)
        iv = model.NewOptionalIntervalVar(
            s.start, s.duration_slots + gap_slots, padded_end, s.presence, f"padded_{s.session_id}"
        )
        padded.append(iv)
    ctx["extra_no_overlap_groups"].append(padded)
    return []


def _compile_spread_multi_session(model, pref, sessions, ctx):
    """Penalize two sessions of the *same* task landing on the same day --
    doing all 8 chunks of a big assignment back-to-back on one day defeats
    the point of splitting it into sessions in the first place."""
    weight = round(pref.weight)
    by_task: dict[str, list] = {}
    for s in sessions:
        by_task.setdefault(s.task_id, []).append(s)

    terms = []
    for task_id, group in by_task.items():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                same_day = model.NewBoolVar(f"sameday_{a.session_id}_{b.session_id}")
                model.Add(a.day == b.day).OnlyEnforceIf(same_day)
                model.Add(a.day != b.day).OnlyEnforceIf(same_day.Not())
                both_present = _and(model, a.presence, b.presence, f"bothpres_{a.session_id}_{b.session_id}")
                penalized = _and(model, same_day, both_present, f"clump_{a.session_id}_{b.session_id}")
                terms.append((-weight, penalized))
    return terms


REGISTRY: dict[str, Callable] = {
    "preferred_hours": _compile_preferred_hours,
    "daily_load_cap": _compile_daily_load_cap,
    "min_gap_between_sessions": _compile_min_gap,
    "spread_multi_session_tasks": _compile_spread_multi_session,
}


def compile_all(model, preferences: list[Preference], sessions: list[SessionCtx], ctx: dict):
    """Run every preference through its compiler, collecting objective terms.
    Unknown types fail loudly -- a typo in a hand-authored profile (or later,
    a bad AI-emitted type) should never just silently do nothing."""
    all_terms = []
    for pref in preferences:
        if pref.type not in REGISTRY:
            raise ValueError(f"no compiler registered for preference type {pref.type!r}")
        all_terms.extend(REGISTRY[pref.type](model, pref, sessions, ctx))
    return all_terms
