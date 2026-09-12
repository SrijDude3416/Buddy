"""
Pydantic request/response models for the FastAPI service, kept in one file
separate from the wiring (api.py) and the preference-persistence logic
(preferences_store.py) -- same one-concern-per-file split as the rest of
this package.

Every shape here is meant to match PREFERENCE_API.md exactly -- that
document is the spec, this is the implementation of it. Where a docstring
here explains *why* a field looks the way it does, that's because the same
explanation is in the markdown; this file doesn't repeat the full reasoning,
just enough to keep the two from drifting apart silently.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
Strength = Literal["gentle", "moderate", "firm"]
Meal = Literal["breakfast", "lunch", "dinner"]

# "HH:MM" 24-hour. protect_time_block's end_time additionally allows "24:00"
# for midnight (PREFERENCE_API.md §5: "use '24:00' for midnight, not
# '00:00'") -- everywhere else, "24:00" is not a valid time-of-day.
_HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
_HHMM_OR_MIDNIGHT = r"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"


def _time_field(pattern: str = _HHMM, **kw) -> Field:
    return Field(pattern=pattern, examples=["17:00"], **kw)


# --------------------------------------------------------------------------
# /solve (PREFERENCE_API.md §2)
# --------------------------------------------------------------------------


class MeetingTimeIn(BaseModel):
    days: list[Weekday] = Field(min_length=1)
    start_time: str = _time_field()
    end_time: str = _time_field(_HHMM_OR_MIDNIGHT)
    location: str | None = None


class CourseIn(BaseModel):
    id: str
    name: str
    meeting_times: list[MeetingTimeIn] = Field(default_factory=list)


class TaskIn(BaseModel):
    id: str
    course_id: str
    title: str
    due_at: datetime
    est_duration_min: int = Field(gt=0)
    splittable: bool = True
    status: Literal["not_started", "in_progress", "done"] = "not_started"


class PreferenceIn(BaseModel):
    """The exact {type, value, weight, source} shape PREFERENCE_API.md's
    tools produce internally. /solve accepts these directly -- it has no
    opinion on strength enums or scope keys, that logic lives in
    preferences_store.py, upstream of this endpoint."""

    type: str
    value: dict = Field(default_factory=dict)
    weight: float = 1.0
    source: str = "manual"


class SolveRequest(BaseModel):
    window_start: datetime
    window_days: int = Field(gt=0)
    max_time_in_seconds: float = Field(default=15.0, gt=0)
    courses: list[CourseIn] = Field(default_factory=list)
    tasks: list[TaskIn] = Field(default_factory=list)
    personal_blocks: list[MeetingTimeIn] = Field(default_factory=list)
    preferences: list[PreferenceIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _tasks_reference_real_courses(self) -> "SolveRequest":
        # Not expressible as a per-field validator -- this is exactly the
        # cross-field check PREFERENCE_API.md §7 calls out as needing a
        # field-level 4xx before any solving starts, not a 500 mid-solve.
        course_ids = {c.id for c in self.courses}
        bad = [t.id for t in self.tasks if t.course_id not in course_ids]
        if bad:
            raise ValueError(
                f"tasks reference course_id(s) not present in courses: {bad}"
            )
        return self


class PlacedBlockOut(BaseModel):
    id: str
    task_id: str | None
    course_id: str | None
    title: str
    kind: Literal["fixed", "flexible", "unplaced", "out_of_window", "infeasible_deadline"]
    start: datetime | None
    end: datetime | None


class SolveResponse(BaseModel):
    status: str
    objective_value: float | None
    best_bound: float | None
    gap_pct: float | None
    solve_seconds: float
    placed: list[PlacedBlockOut]
    unplaced: list[PlacedBlockOut]


# --------------------------------------------------------------------------
# Tools (PREFERENCE_API.md §5) -- request bodies mirror tool_schemas.json
# parameter-for-parameter. Response is a small ToolCallResponse (confirm the
# write + a solve summary), not the full SolveResponse -- GET /plan is where
# the full result lives, same split /solve vs GET /plan already draws.
# --------------------------------------------------------------------------


class ToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SetPreferredWorkHoursIn(ToolInput):
    start_time: str = _time_field()
    end_time: str = _time_field()
    strength: Strength = "moderate"

    @model_validator(mode="after")
    def _end_after_start(self) -> "SetPreferredWorkHoursIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SetDailyWorkloadLimitIn(ToolInput):
    minutes_per_day: int = Field(ge=30, le=900)
    days: list[Weekday] | None = Field(default=None, min_length=1)
    strength: Strength = "moderate"


class ProtectTimeBlockIn(ToolInput):
    days: list[Weekday] = Field(min_length=1)
    start_time: str = _time_field()
    end_time: str = _time_field(_HHMM_OR_MIDNIGHT)

    @field_validator("end_time")
    @classmethod
    def _end_after_start_lexically(cls, v: str, info) -> str:
        # "24:00" always sorts after any real HH:MM lexically, so plain
        # string comparison is safe here without parsing times out.
        start = info.data.get("start_time")
        if start is not None and v <= start:
            raise ValueError("end_time must be later than start_time")
        return v


class SetBreakHabitsIn(ToolInput):
    break_minutes: int = Field(default=45, ge=15, le=120)
    strength: Strength = "moderate"


class SetTaskSpacingIn(ToolInput):
    strength: Strength = "moderate"


class SetUrgencyEmphasisIn(ToolInput):
    strength: Strength = "moderate"


class SetMinimumGapIn(ToolInput):
    # 15 is the only value ever tuned/tested (CLAUDE.md, api.py's former
    # ALWAYS_ON_DEFAULTS). Bounded well below anything that could make ~150
    # sessions over a 14-day window infeasible on its own -- this is a HARD
    # constraint (preferences.py's _compile_min_gap), not a soft one a tight
    # week can just trade off against.
    minutes: int = Field(default=15, ge=0, le=60)


class SetMealWindowIn(ToolInput):
    # Meals used to be an exact, immovable time (api.py's old ROUTINE) --
    # now a bounded window CP-SAT places freely within (scheduler.py's
    # meal-window handling, not preferences.py's registry: it needs its
    # solved placement extracted back out, which the registry's plain
    # (weight, expr) contract can't carry). Hard -- like protect_time_block,
    # the window itself is the point, no strength parameter.
    meal: Meal
    start_time: str = _time_field()
    end_time: str = _time_field()
    duration_minutes: int = Field(default=45, ge=15, le=90)

    @model_validator(mode="after")
    def _end_after_start(self) -> "SetMealWindowIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self

    @model_validator(mode="after")
    def _window_fits_duration(self) -> "SetMealWindowIn":
        start_min = int(self.start_time[:2]) * 60 + int(self.start_time[3:])
        end_min = int(self.end_time[:2]) * 60 + int(self.end_time[3:])
        if end_min - start_min < self.duration_minutes:
            raise ValueError("the window is narrower than duration_minutes -- nothing could fit in it")
        return self


class SetCommitmentIn(ToolInput):
    """A user-named, day-scoped personal commitment -- gym, club meetings,
    a standing appointment, anything that isn't schoolwork but needs real
    time on the calendar. Generalizes two things that used to be separate
    and neither chat-editable: ROUTINE (api.py's old hardcoded, exact-time
    personal blocks -- now `mode="locked"`) and meal_window's bounded-range
    mechanism (now `mode="windowed"`, available for anything, not just the
    three meal types).

    Re-calling this for the SAME `name` replaces the previous entry --
    that's also how "lock" and "unlock" work: there's no separate toggle
    tool, just calling this again with a different `mode` for the same
    commitment (preferences_store.SCOPE_FNS scopes `commitment` by
    normalized name, same singleton-per-name pattern meal_window uses
    per-meal)."""
    name: str = Field(min_length=1, max_length=60)
    mode: Literal["locked", "windowed"] = "windowed"
    days: list[Weekday] | None = Field(default=None, min_length=1)  # omit for every day
    start_time: str = _time_field()
    end_time: str = _time_field()
    # Only meaningful for mode="windowed" -- how long the activity itself
    # takes, within the [start_time, end_time) range CP-SAT is free to place
    # it in. Ignored for mode="locked", where start_time/end_time already
    # give the exact, non-negotiable span. No single tested default the way
    # meals have one (45 min) -- a commitment's real length varies too much
    # to guess well, so this stays required for windowed rather than
    # defaulting to a number likely to be wrong.
    duration_minutes: int | None = Field(default=None, ge=15, le=240)

    @model_validator(mode="after")
    def _end_after_start(self) -> "SetCommitmentIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self

    @model_validator(mode="after")
    def _windowed_needs_duration_that_fits(self) -> "SetCommitmentIn":
        if self.mode != "windowed":
            return self
        if self.duration_minutes is None:
            raise ValueError("duration_minutes is required when mode is \"windowed\" -- how long the commitment itself takes, within the window")
        start_min = int(self.start_time[:2]) * 60 + int(self.start_time[3:])
        end_min = int(self.end_time[:2]) * 60 + int(self.end_time[3:])
        if end_min - start_min < self.duration_minutes:
            raise ValueError("the window is narrower than duration_minutes -- nothing could fit in it")
        return self


class RemovePreferenceIn(ToolInput):
    preference_type: Literal[
        "preferred_work_hours", "daily_workload_limit", "protected_time_block", "break_habits",
        "task_spacing", "urgency_emphasis", "minimum_session_gap", "meal_window", "commitment",
    ]
    match: dict | None = None


class SolveSummary(BaseModel):
    """The compact solve summary a tool call returns -- enough to confirm
    what happened without duplicating GET /plan's full payload."""

    status: str
    objective_value: float | None
    best_bound: float | None
    gap_pct: float | None
    solve_seconds: float
    placed_count: int
    unplaced_count: int


class ToolCallResponse(BaseModel):
    preference_type: str
    action: Literal["created", "replaced", "removed"]
    value: dict
    weight: float | None
    resolve: SolveSummary | None = None  # None only if resolve=false was requested


class ActivePreferenceOut(BaseModel):
    """One entry as returned by list_current_preferences."""

    preference_type: str
    internal_type: str
    value: dict
    weight: float
    source: str
