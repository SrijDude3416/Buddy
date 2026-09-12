"""
Core CP-SAT scheduling model for Buddy.

Two-stage pipeline, deliberately split:

  1. Task -> session decomposition happens BEFORE this file, and is not a
     solver problem. Given a task's total est_duration_min and the user's
     "how do you like to work" preference (short bursts / standard blocks /
     deep sessions), a simple heuristic (or an LLM call constrained to the
     same kind of schema) decides how many sessions a task splits into and
     how long each one is. That produces FlexibleSession objects with a
     *fixed* duration -- this file never resizes a session, it only decides
     WHEN each one happens.

  2. Placement is what CP-SAT actually solves: given a set of already-sized
     sessions, a set of immovable fixed blocks (class/recitation), and a set
     of user preferences, find start times that satisfy every hard
     constraint and maximize a weighted sum of soft ones.

Preferences (produced by the LLM from onboarding + chat) are typed,
validated dicts: {type, value, weight}. Each *type* has exactly one
registered compiler function below. The LLM only ever picks a type from a
fixed enum and fills in that type's value schema -- it never writes, sees,
or influences this file's logic. That boundary is what makes the system
auditable: every scheduling decision traces back to a (type, value, weight)
tuple you can log and show the user, not to a prompt.
"""

from dataclasses import dataclass
from typing import Callable
from ortools.sat.python import cp_model

SLOT_MINUTES = 15
SLOTS_PER_DAY = 24 * 60 // SLOT_MINUTES        # 96
HORIZON_DAYS = 7
HORIZON_SLOTS = SLOTS_PER_DAY * HORIZON_DAYS   # 672 -- one rolling week

# CP-SAT objectives are integer-only under the hood. Preference weights come
# in as floats (e.g. 2.5), so every coefficient gets scaled up here before
# it reaches model.Maximize(). Compilers themselves stay in plain float terms.
WEIGHT_SCALE = 1000


# --------------------------------------------------------------------------
# Inputs -- shapes mirror the `sessions` / `tasks` / `preferences` collections
# --------------------------------------------------------------------------

@dataclass
class FixedBlock:
    id: str
    start_slot: int
    duration_slots: int
    label: str


@dataclass
class FlexibleSession:
    id: str
    task_id: str
    duration_slots: int
    deadline_slot: int
    intensity: str          # "high" | "medium" | "low"


@dataclass
class Preference:
    type: str
    value: dict
    weight: float


INTENSITY_SCORE = {"high": 3, "medium": 2, "low": 1}


# --------------------------------------------------------------------------
# Shared helper: a fully-reified "is this value inside [lo, hi)" boolean.
#
# Fully reified means both directions are enforced (value in window <=> b
# is true), which matters because the same helper gets used for both reward
# terms (preferred_hours) and penalty terms (avoid_block) -- a one-directional
# implication is only safe for one of those two directions, and it's easy to
# quietly build a soft constraint that the solver can freely ignore. Fully
# reifying once, here, means every compiler that needs it is safe by
# construction instead of by careful reasoning each time.
# --------------------------------------------------------------------------

def reify_window(model: cp_model.CpModel, value_var: cp_model.IntVar, lo: int, hi: int, tag: str):
    b_lo = model.NewBoolVar(f"{tag}_ge_lo")
    model.Add(value_var >= lo).OnlyEnforceIf(b_lo)
    model.Add(value_var < lo).OnlyEnforceIf(b_lo.Not())

    b_hi = model.NewBoolVar(f"{tag}_lt_hi")
    model.Add(value_var < hi).OnlyEnforceIf(b_hi)
    model.Add(value_var >= hi).OnlyEnforceIf(b_hi.Not())

    in_window = model.NewBoolVar(tag)
    model.AddBoolAnd([b_lo, b_hi]).OnlyEnforceIf(in_window)
    model.AddBoolOr([b_lo.Not(), b_hi.Not()]).OnlyEnforceIf(in_window.Not())
    return in_window


# --------------------------------------------------------------------------
# The preference compiler registry.
#
# Each compiler gets the live model, its own (value, weight), the built
# session variables, and the raw session data (for things like intensity
# that aren't decision variables). It either adds a hard constraint directly
# and returns [], or returns a list of (coefficient, BoolVar) terms to fold
# into the weighted objective. Every term must be a weight times something
# BOUNDED -- almost always a 0/1 BoolVar -- so weights from different
# preference types stay comparable against each other. An unbounded term
# (like raw slack minutes) has to be normalized down to roughly the same
# scale before it's usable, or it'll dominate the objective regardless of
# its actual weight.
# --------------------------------------------------------------------------

PreferenceCompiler = Callable[[cp_model.CpModel, dict, dict, dict, float], list]
COMPILERS: dict[str, PreferenceCompiler] = {}


def register(pref_type: str):
    def wrap(fn):
        COMPILERS[pref_type] = fn
        return fn
    return wrap


@register("preferred_hours")
def compile_preferred_hours(model, value, sess_vars, sessions_by_id, weight):
    """
    value: {"start_slot": int, "end_slot": int}

    This is the literal mechanism behind "match deep work to when you're
    sharpest": every session gets a reward for landing in the window, scaled
    by its own intensity -- a high-intensity session in-window is worth 3x
    a low-intensity one, so the solver actually prioritizes protecting the
    window for the work that needs it most, rather than just filling it
    with whatever fits.
    """
    lo, hi = value["start_slot"], value["end_slot"]
    terms = []
    for sid, sv in sess_vars.items():
        in_window = reify_window(model, sv["start"], lo, hi, f"inwin_{sid}")
        score = INTENSITY_SCORE[sessions_by_id[sid].intensity]
        terms.append((weight * score, in_window))
    return terms


@register("avoid_block")
def compile_avoid_block(model, value, sess_vars, sessions_by_id, weight):
    """
    value: {"start_slot": int, "end_slot": int, "hard": bool}

    "hard" is itself something the LLM fills in -- it's the model's read of
    whether the user said something absolute ("never after 11pm") versus a
    soft preference ("I'd rather not work late"). That judgment call is
    exactly what an LLM is good at; turning "hard: true" into an actual
    domain restriction is not a judgment call, so it stays in this
    deterministic function instead.
    """
    lo, hi = value["start_slot"], value["end_slot"]
    hard = value.get("hard", False)
    terms = []
    for sid, sv in sess_vars.items():
        if hard:
            forbidden = [(s,) for s in range(lo, hi)]
            model.AddForbiddenAssignments([sv["start"]], forbidden)
        else:
            hit = reify_window(model, sv["start"], lo, hi, f"avoid_{sid}")
            terms.append((-weight, hit))  # penalty: subtracts from the objective
    return terms


@register("weight_adjustment")
def compile_weight_adjustment(model, value, sess_vars, sessions_by_id, weight):
    """
    value: {"task_id": str, "multiplier": float}

    A chat message like "deprioritize chem this week" lands here as a
    temporary multiplier on how strongly that task's sessions are rewarded
    for finishing with slack before their deadline -- not as an edit to the
    task's base priority_weight, and never as a direct change to when
    anything is scheduled. The solver still decides the actual placement.
    """
    task_id = value["task_id"]
    multiplier = value["multiplier"]
    terms = []
    for sid, sv in sess_vars.items():
        if sessions_by_id[sid].task_id != task_id:
            continue
        slack = sessions_by_id[sid].deadline_slot - sv["end"]
        # Normalize into roughly [0, 1] so this stays comparable in scale to
        # the boolean-indicator terms above -- see the note on the registry.
        terms.append((weight * multiplier / HORIZON_SLOTS, slack))
    return terms


# --------------------------------------------------------------------------
# Model assembly
# --------------------------------------------------------------------------

def build_and_solve(
    fixed_blocks: list[FixedBlock],
    flexible_sessions: list[FlexibleSession],
    preferences: list[Preference],
    time_limit_s: float = 10.0,
):
    model = cp_model.CpModel()
    sessions_by_id = {s.id: s for s in flexible_sessions}
    intervals = []
    sess_vars: dict[str, dict] = {}

    # Fixed blocks: immovable, but they share the same timeline as flexible
    # work. This is the whole trick for "class times are locked without
    # special-case logic elsewhere" -- they're just intervals with no
    # decision variables, sitting in the same no-overlap pool as everything
    # else.
    for b in fixed_blocks:
        iv = model.NewIntervalVar(
            b.start_slot, b.duration_slots, b.start_slot + b.duration_slots, f"fixed_{b.id}"
        )
        intervals.append(iv)

    # Flexible sessions: decide a start slot within [0, deadline - duration].
    # A session simply has no valid placement past its own deadline --
    # infeasibility here is exactly "this can't be scheduled in time,"
    # which is useful to detect and surface, not something to hide.
    for s in flexible_sessions:
        latest_start = max(0, s.deadline_slot - s.duration_slots)
        start = model.NewIntVar(0, latest_start, f"start_{s.id}")
        end = model.NewIntVar(0, HORIZON_SLOTS, f"end_{s.id}")
        model.Add(end == start + s.duration_slots)
        iv = model.NewIntervalVar(start, s.duration_slots, end, f"iv_{s.id}")
        sess_vars[s.id] = {"start": start, "end": end}
        intervals.append(iv)

    # The one hard scheduling rule that matters: nothing overlaps.
    model.AddNoOverlap(intervals)

    # Compile every active preference. This loop is the entire surface area
    # where LLM-derived input enters the solver -- everything upstream was
    # the model's job; everything from here down is plain, unit-testable
    # Python that never changes based on what anyone said in chat.
    objective_terms = []
    for pref in preferences:
        compiler = COMPILERS.get(pref.type)
        if compiler is None:
            continue  # unknown/unsupported type: skip rather than guess
        objective_terms.extend(compiler(model, pref.value, sess_vars, sessions_by_id, pref.weight))

    if objective_terms:
        model.Maximize(sum(round(coef * WEIGHT_SCALE) * var for coef, var in objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    status = solver.Solve(model)

    result = {
        "status": solver.StatusName(status),
        "objective_value": solver.ObjectiveValue() if objective_terms else None,
        "best_bound": solver.BestObjectiveBound() if objective_terms else None,
        "sessions": {},
    }
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for sid, sv in sess_vars.items():
            result["sessions"][sid] = {
                "start_slot": solver.Value(sv["start"]),
                "end_slot": solver.Value(sv["end"]),
            }
    return result
