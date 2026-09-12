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

from pydantic import BaseModel, Field, field_validator, model_validator

Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
Strength = Literal["gentle", "moderate", "firm"]

# "HH:MM" 24-hour. protect_time_block's end_time additionally allows "24:00"
# for midnight (PREFERENCE_API.md §5: "use '24:00' for midnight, not
# '00:00'") -- everywhere else, "24:00" is not a valid time-of-day.
_HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
_HHMM_OR_MIDNIGHT = r"^([01][0-9]|2[0-3]):[0-5][0-9]|24:00$"


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


class SetPreferredWorkHoursIn(BaseModel):
    start_time: str = _time_field()
    end_time: str = _time_field()
    strength: Strength = "moderate"

    @model_validator(mode="after")
    def _end_after_start(self) -> "SetPreferredWorkHoursIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SetDailyWorkloadLimitIn(BaseModel):
    minutes_per_day: int = Field(ge=30, le=900)
    days: list[Weekday] | None = Field(default=None, min_length=1)
    strength: Strength = "moderate"


class ProtectTimeBlockIn(BaseModel):
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


class SetBreakHabitsIn(BaseModel):
    break_minutes: int = Field(default=45, ge=15, le=120)
    strength: Strength = "moderate"


class RemovePreferenceIn(BaseModel):
    preference_type: Literal[
        "preferred_work_hours", "daily_workload_limit", "protected_time_block", "break_habits"
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
