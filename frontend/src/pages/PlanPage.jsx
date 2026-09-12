// ---------------------------------------------------------------------------
// The main hub.
//
//   [ calendar ..................... ][ class colors ]
//   [ goal swimlanes for the selected day ...........]
//   [ coming up .....................................]
//
// The calendar shows when time goes; the swimlanes underneath show what it goes
// toward on the same day, with rows as goals rather than days. The class colors
// on the right are the key shared by both.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { CalendarView } from '../components/plan/CalendarView.jsx';
import { GoalSwimlanes } from '../components/plan/GoalSwimlanes.jsx';
import { ClassLegend } from '../components/plan/ClassLegend.jsx';
import { PillTabs } from '../components/ui/PillTabs.jsx';
import { PlanSkeleton } from '../components/ui/Skeleton.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { horizonDays } from '../lib/time.js';
import { itemsForDay } from '../lib/adapters.js';
import { usePlan } from '../state/PlanProvider.jsx';

const RANGE_TABS = [
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

export function PlanPage({ onOpenTask }) {
  const { plan, status, error, refresh, actionError, clearActionError } = usePlan();
  const [range, setRange] = useState('week');
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [weekStart, setWeekStart] = useState(0);

  const allDays = useMemo(() => horizonDays(14), []);
  const weekDays = useMemo(
    () => allDays.slice(weekStart, weekStart + 7),
    [allDays, weekStart],
  );
  const visibleDays = range === 'week' ? weekDays : allDays.slice(selectedOffset, selectedOffset + 1);

  if (status === 'loading' || status === 'idle') return <PlanSkeleton />;
  if (status === 'error') return <ErrorNotice error={error} onRetry={refresh} title="Couldn't load your plan" />;

  const selectedDay = allDays.find((d) => d.offset === selectedOffset) ?? allDays[0];
  const selectedItems = itemsForDay(plan, selectedOffset);
  const selectedMinutes = selectedItems.reduce((sum, i) => sum + i.durationMin, 0);

  function shiftWeek(delta) {
    const next = Math.min(7, Math.max(0, weekStart + delta));
    setWeekStart(next);
    // Keep the selected day inside the visible range.
    if (selectedOffset < next || selectedOffset > next + 6) setSelectedOffset(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">{selectedDay.label}</h2>
          <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
            {selectedItems.length
              ? `${selectedItems.length} thing${selectedItems.length === 1 ? '' : 's'} · ${Math.round(selectedMinutes / 60 * 10) / 10}h`
              : 'Nothing on the books'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {range === 'week' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftWeek(-7)}
                disabled={weekStart === 0}
                aria-label="Previous week"
                className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400 disabled:opacity-40 hover:border-emerald-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(7)}
                disabled={weekStart >= 7}
                aria-label="Next week"
                className="p-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400 disabled:opacity-40 hover:border-emerald-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
          <PillTabs tabs={RANGE_TABS} value={range} onChange={setRange} />
        </div>
      </div>

      {actionError && <ErrorNotice error={actionError} onRetry={clearActionError} compact />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_248px]">
        <CalendarView
          plan={plan}
          days={visibleDays}
          selectedOffset={selectedOffset}
          onSelectDay={setSelectedOffset}
          onOpenTask={onOpenTask}
        />
        <ClassLegend plan={plan} selectedOffset={selectedOffset} dayLabel={selectedDay.label} />
      </div>

      <div className="border-t border-stone-200 dark:border-stone-800 pt-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Goals on {selectedDay.label.toLowerCase()}</p>
          <p className="text-xs text-stone-400 dark:text-stone-500">Rows are goals, not days</p>
        </div>
        <GoalSwimlanes plan={plan} offset={selectedOffset} dayLabel={selectedDay.label} onOpenTask={onOpenTask} />
      </div>

      <div className="border-t border-stone-200 dark:border-stone-800 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          <h3 className="font-serif text-lg text-stone-900 dark:text-stone-100">Coming up</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[...plan.goals]
            .sort((a, b) => (a.daysAway ?? 999) - (b.daysAway ?? 999))
            .map((goal) => (
              <div
                key={goal.id}
                className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{goal.deadlineLabel}</p>
                  <span className="text-xs text-stone-500 dark:text-stone-400 shrink-0">{goal.dueLabel ?? ''}</span>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">{goal.title}</p>
              </div>
            ))}
          {plan.goals.length === 0 && (
            <p className="text-sm text-stone-400 dark:text-stone-500">Nothing coming up yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
