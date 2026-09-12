import { z } from 'zod';
import { SavedPreferencesSchema } from './preference-contract';

// This file validates/labels optimizer output. It never places or edits events.
const WallTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
export const PlanSchema = z.object({
  courses: z.array(z.object({ _id: z.string(), name: z.string(), code: z.string() })).max(30),
  tasks: z.array(z.object({ _id: z.string(), course_id: z.string(), display_title: z.string(), source_assignment: z.string(), status: z.string(), due_at: WallTime, priority_weight: z.number(), est_duration_min: z.number() })).max(200),
  sessions: z.array(z.object({
    _id: z.string(), task_id: z.string().nullable(), course_id: z.string().nullable(),
    type: z.enum(['fixed', 'flexible']), action: z.string(), intensity: z.string(),
    duration_min: z.number().positive(), locked: z.boolean(), completed: z.boolean(), start: WallTime, end: WallTime,
  })).max(1000),
  windowStart: WallTime, windowDays: z.number().int().min(1).max(14),
  preferences: SavedPreferencesSchema,
  run: z.object({
    status: z.literal('solved'), engine: z.literal('CP-SAT'), solverStatus: z.enum(['FEASIBLE', 'OPTIMAL']),
    objective_value: z.number().nullable(), best_bound: z.number().nullable(), gap: z.number().nullable(), solve_seconds: z.number(),
  }),
  unplaced: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string() })).max(1000),
});
export type Plan = z.infer<typeof PlanSchema>;
