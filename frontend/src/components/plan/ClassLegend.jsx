// ---------------------------------------------------------------------------
// The color key that sits next to the calendar. It is not only a legend: each
// row also carries that class's own week and next deadline, so the panel
// answers "which color is which class" and "how far through this class's week
// am I" at once.
//
// The bar is real elapsed clock time, not a completion checkbox: how much of
// this class's total time on the calendar THIS WEEK (lectures + study
// sessions, every block carrying that course's color) has already happened,
// out of the whole week's worth. A class can read 40% through its week
// without a single session manually checked off -- the bar tracks the clock,
// not the checklist (TaskDetail/CalendarView's own `completed`-vs-`isPast`
// distinction, applied here at the class level instead of per session).
//
// Deliberately quiet: one line of numbers per class, not three. The panel's
// job is orientation, not a second dashboard.
// ---------------------------------------------------------------------------

import { Lock } from 'lucide-react';
import { colorFor } from '../../lib/courseColors.js';
import { hasEnded } from '../../lib/time.js';

export function ClassLegend({ plan, weekOffsets, now }) {
  if (!plan.goals.length) {
    return (
      <div className="bg-white dark:bg-stone-900 border border-stone-200/70 dark:border-stone-800 rounded-2xl px-4 py-3">
        <p className="text-sm text-stone-400 dark:text-stone-500">No classes yet.</p>
      </div>
    );
  }

  const weekOffsetSet = new Set(weekOffsets);

  return (
    <div className="self-start bg-white dark:bg-stone-900 border border-stone-200/70 dark:border-stone-800 rounded-2xl px-4 py-4 space-y-4">
      <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Your classes</p>

      <div className="space-y-3.5">
        {plan.goals.map((goal) => {
          const color = colorFor(plan.colorMap, goal.id);
          const weekItems = [
            ...plan.flexibleSessions.filter((s) => s.courseId === goal.id && weekOffsetSet.has(s.dayOffset)),
            ...plan.fixedBlocks.filter((b) => b.courseId === goal.id && weekOffsetSet.has(b.dayOffset)),
          ];
          const totalMin = weekItems.reduce((sum, i) => sum + i.durationMin, 0);
          const elapsedMin = weekItems
            .filter((i) => hasEnded(i.end, now))
            .reduce((sum, i) => sum + i.durationMin, 0);
          const throughWeek = totalMin ? Math.round((elapsedMin / totalMin) * 100) : 0;

          return (
            <div key={goal.id}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />
                <p className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate flex-1" title={goal.title}>
                  {goal.code ?? goal.title}
                </p>
                {goal.dueLabel && (
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 shrink-0">{goal.dueLabel}</span>
                )}
              </div>

              <div className="pl-4 mt-1.5 space-y-1">
                <div className="h-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${color.rail}`} style={{ width: `${throughWeek}%` }} />
                </div>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  {totalMin ? `${elapsedMin} of ${totalMin} min this week` : 'Nothing scheduled this week'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 pt-3 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-400 dark:text-stone-500">
        <Lock className="w-3 h-3 shrink-0" />
        Locked blocks are class time and your routine — ask Buddy to move anything else.
      </p>
    </div>
  );
}
