import { z } from 'zod';
import definitions from '../../backend/optimizer/tool_schemas.json';

// Names and parameters correspond to the existing Python /tools endpoints.
// The Python models remain the final argument validators.
export const PreferenceCallSchema = z.object({
  name: z.enum(['set_preferred_work_hours', 'set_daily_workload_limit', 'protect_time_block', 'set_break_habits', 'remove_preference', 'list_current_preferences']),
  arguments: z.record(z.unknown()),
}).strict();
export const PreferenceCallsSchema = z.array(PreferenceCallSchema).max(12);
export const SavedPreferencesSchema = z.array(PreferenceCallSchema).max(50).refine(calls => calls.every(c => c.name !== 'remove_preference' && c.name !== 'list_current_preferences'), 'Only active preference setters can be saved.');
export type PreferenceCall = z.infer<typeof PreferenceCallSchema>;
export const preferenceTools = definitions.tools.map(tool => ({
  type: 'function' as const, name: tool.name, description: tool.description,
  parameters: tool.parameters, strict: false as const,
}));
