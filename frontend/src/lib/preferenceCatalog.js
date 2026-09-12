// ---------------------------------------------------------------------------
// The fixed, enumerable preference catalog.
//
// Nothing in the app may invent a preference type. These are exactly the types
// the CP-SAT compiler registry in backend/optimizer/scheduler_core.py has a
// hand-written compiler for, plus the one stage-1 type consumed before the solve.
//
// Onboarding answers and chat feedback both end up here as typed
// { type, value, weight } objects. That is the whole point: the language layer
// picks a type from this list and fills its value schema; it never touches the
// solver.
// ---------------------------------------------------------------------------

export const SLOT_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES; // 96
export const HORIZON_DAYS = 7;
export const HORIZON_SLOTS = SLOTS_PER_DAY * HORIZON_DAYS; // 672 — one rolling week

/**
 * consumed_by tells you which stage of the pipeline reads the entry:
 *   'compiler'      -> has a registered CP-SAT compiler (stage 2, placement)
 *   'decomposition' -> read by the task->session splitter (stage 1, pre-solve)
 */
export const PREFERENCE_TYPES = {
  preferred_hours: {
    consumed_by: 'compiler',
    describe: (v) => `Prefer working between slot ${v.start_slot} and ${v.end_slot}`,
    valid: (v) => Number.isInteger(v?.start_slot) && Number.isInteger(v?.end_slot),
  },
  avoid_block: {
    consumed_by: 'compiler',
    describe: (v) => `Avoid slot ${v.start_slot}-${v.end_slot}${v.hard ? ' (hard)' : ''}`,
    valid: (v) => Number.isInteger(v?.start_slot) && Number.isInteger(v?.end_slot),
  },
  weight_adjustment: {
    consumed_by: 'compiler',
    describe: (v) => `Re-weight task ${v.task_id} by ${v.multiplier}x`,
    valid: (v) => typeof v?.task_id === 'string' && typeof v?.multiplier === 'number',
  },
  session_length: {
    consumed_by: 'decomposition',
    describe: (v) => `Split work into ~${v.minutes}-minute sessions`,
    valid: (v) => Number.isInteger(v?.minutes),
  },
};

/** Guard at the boundary — an unknown type is a bug, not something to pass through. */
export function validatePreferenceEntry(entry) {
  const spec = PREFERENCE_TYPES[entry?.type];
  if (!spec) return `Unknown preference type "${entry?.type}"`;
  if (!spec.valid(entry.value)) return `Invalid value for "${entry.type}"`;
  if (typeof entry.weight !== 'number') return `Missing numeric weight on "${entry.type}"`;
  if (entry.source !== 'onboarding' && entry.source !== 'chat') {
    return `source must be "onboarding" or "chat"`;
  }
  return null;
}

export function describePreference(entry) {
  const spec = PREFERENCE_TYPES[entry.type];
  return spec ? spec.describe(entry.value) : entry.type;
}

/** Hour-of-day -> slot index, for building window values from human answers. */
export const slotOf = (hour, minute = 0) => Math.floor((hour * 60 + minute) / SLOT_MINUTES);
