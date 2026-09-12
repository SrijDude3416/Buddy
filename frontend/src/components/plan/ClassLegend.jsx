// ---------------------------------------------------------------------------
// The color key that sits next to the calendar. It is not only a legend: each
// row also carries that class's progress and next deadline, so the panel answers
// "which color is which class" and "how is that class going" at once.
// ---------------------------------------------------------------------------

import { Lock } from 'lucide-react';
import { colorFor } from '../../lib/courseColors.js';

export function ClassLegend({ plan, selectedOffset, dayLabel }) {
  if (!plan.goals.length) {
    return (
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3">
        <p className="text-sm text-stone-400 dark:text-stone-500">No classes yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3 space-y-3">
      <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Your classes</p>

      <div className="space-y-3">
        {plan.goals.map((goal) => {
          const color = colorFor(plan.colorMap, goal.id);
          const todayMin = [
            ...plan.flexibleSessions.filter((s) => s.courseId === goal.id && s.dayOffset === selectedOffset),
            ...plan.fixedBlocks.filter((b) => b.courseId === goal.id && b.dayOffset === selectedOffset),
          ].reduce((sum, s) => sum + s.durationMin, 0);

          return (
            <div key={goal.id}>
              <div className="flex items-start gap-2">
                <span className={`w-3 h-3 rounded-sm shrink-0 mt-0.5 ${color.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate" title={goal.title}>
                    {goal.code ?? goal.title}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{goal.title}</p>
                </div>
              </div>

              <div className="pl-5 mt-1.5 space-y-1">
                <div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${color.rail}`} style={{ width: `${goal.progress}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                  <span>{goal.progress}% done</span>
                  {goal.dueLabel && <span className="truncate">{goal.deadlineLabel} {goal.dueLabel}</span>}
                </div>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  {todayMin ? `${todayMin} min on ${dayLabel.toLowerCase()}` : `nothing ${dayLabel.toLowerCase()}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-stone-200 dark:border-stone-800 space-y-1.5">
        <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">Block types</p>
        <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
          <span className="w-3 h-3 rounded-sm bg-stone-700 inline-flex items-center justify-center shrink-0">
            <Lock className="w-2 h-2 text-stone-300" />
          </span>
          Class time — can&apos;t be moved
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
          <span className="w-3 h-3 rounded-sm border border-stone-300 dark:border-stone-600 bg-stone-100 dark:bg-stone-800 shrink-0" />
          Your own session — ask Buddy to move it
        </span>
      </div>
    </div>
  );
}
