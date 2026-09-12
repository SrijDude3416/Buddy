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

from data_loader import WEEKDAY_ABBR


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
    course_id: str
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
    counts when the session is actually scheduled (gated by `presence`).
    Linearized by hand rather than AddMultiplicationEquality(c, [a, b]): the
    generic multiplication constraint is a heavier global constraint for
    CP-SAT to propagate than three linear ones, and this compiler runs at
    O(sessions^2) in a couple of places -- the difference is the gap between
    finding a first feasible solution in seconds vs. not at all in 60."""
    c = model.NewBoolVar(name)
    model.Add(c <= a)
    model.Add(c <= b)
    model.Add(c >= a + b - 1)
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
    the placeholder objective produced with no preferences at all.

    `value["days"]` (optional) scopes the cap to specific weekdays -- e.g. a
    much lower Sunday cap alongside a normal one for every other day, rather
    than one uniform number that can't tell a rest day from a workday.
    """
    cap_minutes = pref.value["minutes"]
    cap_slots = cap_minutes // ctx["slot_minutes"]
    weight_per_slot = round(pref.weight)
    days_filter = set(pref.value["days"]) if "days" in pref.value else None
    terms = []
    for day in range(ctx["window_days"]):
        if days_filter is not None:
            weekday = WEEKDAY_ABBR[(ctx["day0_weekday"] + day) % 7]
            if weekday not in days_filter:
                continue
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


def _compile_avoid_block(model, pref, sessions, ctx):
    """Hard constraint: no flexible work at all in a declared window on the
    given weekdays -- e.g. protect Friday/Saturday night. Implemented exactly
    like the off-hours blackout (an immovable interval fed into the same
    AddNoOverlap pool), not a penalty -- CLAUDE.md's own example preference
    type, and the one place a soft nudge doesn't match what a real calendar
    (see the "Friday Night" / "Saturday Night" blocks) actually does: total
    protection, not "try not to.\""""
    days_wanted = set(pref.value["days"])
    lo = _hhmm_to_slot(pref.value["start"], ctx["slot_minutes"])
    hi = min(_hhmm_to_slot(pref.value["end"], ctx["slot_minutes"]), (24 * 60) // ctx["slot_minutes"])
    if hi <= lo:
        return []
    for day in range(ctx["window_days"]):
        weekday = WEEKDAY_ABBR[(ctx["day0_weekday"] + day) % 7]
        if weekday not in days_wanted:
            continue
        base = day * ((24 * 60) // ctx["slot_minutes"])
        iv = model.NewIntervalVar(base + lo, hi - lo, base + hi, f"avoidblock_{day}_{pref.value['start']}")
        ctx["all_intervals"].append(iv)
    return []


def _compile_after_class_bonus(model, pref, sessions, ctx):
    """Reward a session starting shortly after its OWN course's lecture ends
    that same day -- "review right after class" is a strong, specific
    pattern in real study schedules that a generic evening-hours preference
    can't produce on its own."""
    window_slots = pref.value.get("minutes", 90) // ctx["slot_minutes"]
    weight = round(pref.weight)
    terms = []
    for s in sessions:
        ends = ctx["course_lecture_ends"].get(s.course_id, [])
        if not ends:
            continue
        near_any = []
        for i, end_slot in enumerate(ends):
            in_window = reify_window(model, s.start, end_slot, end_slot + window_slots, f"afterclass_{s.session_id}_{i}")
            near_any.append(in_window)
        near_lecture = model.NewBoolVar(f"nearlecture_{s.session_id}")
        model.AddMaxEquality(near_lecture, near_any)
        rewarded = _and(model, near_lecture, s.presence, f"afterclass_active_{s.session_id}")
        terms.append((weight, rewarded))
    return terms


def _compile_max_continuous_work(model, pref, sessions, ctx):
    """Soft: minimize the single longest unbroken run of flexible work in the
    whole schedule -- sessions chained by gaps under `break_minutes` count as
    one continuous run. Carlos's own reframe of "never work more than two
    hours without a break": a hard cap could only ever satisfy itself by
    dropping a session outright when a big, urgent deadline genuinely needs
    a long push, which is worse than occasionally allowing one. Minimizing
    the worst streak instead lets the solver trade a longer streak off
    against everything else in the objective, same as any other preference.

    No same-day check is needed: every flexible session is already bounded
    to a single day's working hours (see scheduler.py), so crossing from one
    day into the next always means an overnight gap far larger than any real
    break threshold -- a small gap is, by construction, same-day.

    For each session i, `streak[i]` is the true cumulative work-minutes
    ending at i: either just i's own duration, or -- for whichever other
    present session j chains directly into i (ends within `break_minutes` of
    i's start) -- streak[j] + i's duration. `max_streak` is the max over
    every session's streak; the objective term penalizes it directly.
    """
    # Review-notes sessions are excluded: they're a light, class-anchored
    # 30-minute activity, not the grinding work this rule protects against,
    # and this compiler's cost is quadratic in session count -- cutting ~30
    # review sessions out of ~100 total sessions took real solve time down
    # meaningfully (see README.md for the actual before/after numbers).
    sessions = [s for s in sessions if not s.task_id.startswith("review_")]
    if not sessions:
        return []

    break_slots = max(1, pref.value.get("break_minutes", 45) // ctx["slot_minutes"])
    weight = round(pref.weight)

    streak = {s.session_id: model.NewIntVar(0, ctx["total_slots"], f"streak_{s.session_id}") for s in sessions}

    for i in sessions:
        candidates = [i.duration_slots]
        for j in sessions:
            if j.session_id == i.session_id:
                continue
            gap = model.NewIntVar(-ctx["total_slots"], ctx["total_slots"], f"gap_{j.session_id}_{i.session_id}")
            model.Add(gap == i.start - (j.start + j.duration_slots))
            precedes = reify_window(model, gap, 0, break_slots, f"precedes_{j.session_id}_{i.session_id}")
            both_present = _and(model, i.presence, j.presence, f"streakpres_{j.session_id}_{i.session_id}")
            chained = _and(model, precedes, both_present, f"chained_{j.session_id}_{i.session_id}")
            summed = model.NewIntVar(0, ctx["total_slots"], f"streaksum_{j.session_id}_{i.session_id}")
            model.Add(summed == streak[j.session_id] + i.duration_slots)
            candidate = model.NewIntVar(0, ctx["total_slots"], f"streakcand_{j.session_id}_{i.session_id}")
            model.Add(candidate == summed).OnlyEnforceIf(chained)
            model.Add(candidate == 0).OnlyEnforceIf(chained.Not())
            candidates.append(candidate)
        model.AddMaxEquality(streak[i.session_id], candidates)

    max_streak = model.NewIntVar(0, ctx["total_slots"], "max_streak")
    model.AddMaxEquality(max_streak, list(streak.values()))
    return [(-weight, max_streak)]


def _compile_urgency_priority(model, pref, sessions, ctx):
    """Reward placing a task's sessions earlier, scaled by how urgent that
    task actually is (`ctx["task_urgency"]`, minutes of remaining work per
    hour of runway until its deadline -- see scheduler.py). Without this,
    nothing distinguishes "a big assignment due in 2 days" from "a 20-minute
    reading due in 2 weeks" once both are merely in-scope; the solver has no
    reason to prefer finishing the former over idly picking up the latter,
    which is exactly the "why is it working on next week's reading instead
    of the huge thing due Wednesday" complaint this exists to fix.

    This is deliberately NOT the old blanket "-start" tie-break that caused
    the original day-one cramming bug (see git history) -- that pulled
    *everything* earlier regardless of need. This only pulls a session
    earlier in proportion to its own task's real urgency, computed once in
    Python from actual remaining work and actual time left, not applied
    uniformly.

    Uses `-day`, not `-start`: this is the same lesson from that same old
    bug, applied again. `-start` ranges over ~1300 slots -- multiplied by a
    real urgency score (tens) and PREF_SCALE, a single urgent session's
    reward can exceed PRESENCE_WEIGHT itself, meaning the solver would
    rather leave some OTHER, unrelated session unplaced than accept a
    slightly-later start for the urgent one. That's a broken tier order
    (this is tier 2 material, not license to override tier 1). `-day` caps
    the range at `window_days` (~14), keeping this safely inside tier 2
    regardless of how large a real urgency score gets.
    """
    weight = round(pref.weight)
    terms = []
    for s in sessions:
        urgency = ctx["task_urgency"].get(s.task_id, 0)
        if urgency <= 0:
            continue
        contribution = model.NewIntVar(-ctx["window_days"], 0, f"urgency_{s.session_id}")
        model.Add(contribution == -s.day).OnlyEnforceIf(s.presence)
        model.Add(contribution == 0).OnlyEnforceIf(s.presence.Not())
        terms.append((weight * urgency, contribution))
    return terms


REGISTRY: dict[str, Callable] = {
    "preferred_hours": _compile_preferred_hours,
    "daily_load_cap": _compile_daily_load_cap,
    "min_gap_between_sessions": _compile_min_gap,
    "spread_multi_session_tasks": _compile_spread_multi_session,
    "avoid_block": _compile_avoid_block,
    "after_class_bonus": _compile_after_class_bonus,
    "max_continuous_work": _compile_max_continuous_work,
    "urgency_priority": _compile_urgency_priority,
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
