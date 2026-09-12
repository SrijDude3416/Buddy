export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type Strength = "gentle" | "moderate" | "firm";
export type PreferenceOperation = { name: "set_preferred_work_hours" | "set_daily_workload_limit" | "protect_time_block" | "set_break_habits" | "set_task_spacing" | "set_urgency_emphasis" | "set_minimum_gap" | "set_meal_window" | "remove_preference" | "list_current_preferences"; arguments: Record<string, unknown> };
export type ScheduleInterpretation = { chatResponse: string; operations: PreferenceOperation[]; debug: { openaiResponse: unknown } };
export type OptimizerRun = { id: string; status: string; stage?: string; progress?: number };
export type SchedulePlan = { placed: unknown[]; unplaced: unknown[]; [key: string]: unknown };
export type PreferenceWriteResult = { runId?: string; warning?: string; preferences?: unknown[] };
