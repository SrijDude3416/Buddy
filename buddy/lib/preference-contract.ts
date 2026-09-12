import { z } from 'zod';
import definitions from '../../backend/optimizer/tool_schemas.json';

// Names and parameters correspond to the existing Python /tools endpoints.
// The Python models remain the final argument validators.
export const PreferenceCallSchema = z.object({
  name: z.enum(['set_preferred_work_hours', 'set_daily_workload_limit', 'protect_time_block', 'set_break_habits', 'set_task_spacing', 'set_urgency_emphasis', 'set_minimum_gap', 'set_meal_window', 'set_commitment', 'add_task', 'remove_task', 'remove_preference', 'list_current_preferences']),
  arguments: z.record(z.unknown()),
}).strict();
export const PreferenceCallsSchema = z.array(PreferenceCallSchema).max(12);
// add_task/remove_task are one-shot creates/deletes, not restatements of
// "current state" the way every preference setter is -- replaying an
// add_task on every request (the way `preferences` gets round-tripped)
// would create a duplicate task each time. Excluded here for the same
// reason remove_preference/list_current_preferences already are; the
// backend enforces this same rule independently (preference_pipeline.py's
// apply_and_solve), this is the same check surfacing earlier.
export const SavedPreferencesSchema = z.array(PreferenceCallSchema).max(50).refine(calls => calls.every(c => !['remove_preference', 'list_current_preferences', 'add_task', 'remove_task'].includes(c.name)), 'Only active preference setters can be saved.');
export type PreferenceCall = z.infer<typeof PreferenceCallSchema>;
export const preferenceTools = definitions.tools.map(tool => ({
  type: 'function' as const, name: tool.name, description: tool.description,
  parameters: tool.parameters, strict: false as const,
}));
