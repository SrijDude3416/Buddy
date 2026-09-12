// ---------------------------------------------------------------------------
// The main hub.
//
//   [ calendar ..................... ][ class colors ]
//   [ coming up .....................................]
//
// The calendar shows when time goes; the class panel beside it shows what it is
// going toward. The day heading carries the two numbers that describe the day
// (how much is on it, and how close to optimal the placement is) so there is one
// place to look rather than a status line floating somewhere else on the page.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as Arrow } from 'lucide-react';
import { CalendarView } from '../components/plan/CalendarView.jsx';
import { ClassLegend } from '../components/plan/ClassLegend.jsx';
import { PillTabs } from '../components/ui/PillTabs.jsx';
import { PlanSkeleton } from '../components/ui/Skeleton.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { horizonDays } from '../lib/time.js';
import { itemsForDay } from '../lib/adapters.js';
import { usePlan } from '../state/PlanProvider.jsx';
import { useNow } from '../hooks/useNow.js';

const RANGE_TABS = [
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
];

/**
 * CP-SAT reports a provable bound on the best possible objective even when it
 * can't prove optimality, so the gap is a real number — but a gap is the wrong
 * way round for a reader. Show its complement: how optimal this schedule is.
 */
function optimalityLabel(run) {
  if (!run || run.gap === null || run.gap === undefined) return null;
  const pct = Math.max(0, Math.min(100, (1 - run.gap) * 100));
  return `${pct.toFixed(1)}% optimal schedule`;
}

export function PlanPage({ onOpenTask }) {
  const { plan, status, error, refresh, actionError, clearActionError } = usePlan();
  const [range, setRange] = useState('week');
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [weekStart, setWeekStart] = useState(0);
  // One shared clock for the calendar's "now" line/auto-cross-out and the
  // class panel's "how far through this week" bars -- both read the same
  // live time rather than each keeping its own.
  const now = useNow();

  const allDays = useMemo(() => horizonDays(14, plan.windowStart ? new Date(plan.windowStart) : new Date()).map(d => plan.windowStart ? { ...d, label: d.date.toLocaleDateString('en-US', { weekday: 'short' }) } : d), [plan.windowStart]);
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
  const optimality = optimalityLabel(plan.run);

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
            {optimality && (
              <>
                <span className="text-stone-300 dark:text-stone-700"> · </span>
                <span className="font-semibold text-stone-700 dark:text-stone-200">{optimality}</span>
              </>
            )}
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
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 disabled:opacity-30 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(7)}
                disabled={weekStart >= 7}
                aria-label="Next week"
                className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 disabled:opacity-30 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
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
          now={now}
        />
        <ClassLegend plan={plan} weekOffsets={weekDays.map((d) => d.offset)} now={now} />
      </div>

      <div>
        <h3 className="text-sm font-medium text-stone-500 dark:text-stone-400 mb-3">Coming up</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {[...plan.goals]
            .sort((a, b) => (a.daysAway ?? 999) - (b.daysAway ?? 999))
            .map((goal) => (
              <button
                key={goal.id}
                type="button"
                disabled={!goal.nextTaskId}
                onClick={() => goal.nextTaskId && onOpenTask?.(goal.nextTaskId)}
                title={goal.nextTaskId ? `Open ${goal.deadlineLabel}` : undefined}
                className="group text-left bg-white dark:bg-stone-900 border border-stone-200/70 dark:border-stone-800 rounded-xl px-4 py-3 enabled:hover:border-stone-300 dark:enabled:hover:border-stone-700 disabled:cursor-default transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{goal.deadlineLabel}</p>
                  <span className="flex items-center gap-1 shrink-0 text-xs text-stone-500 dark:text-stone-400">
                    {goal.dueLabel ?? ''}
                    {goal.nextTaskId && (
                      <Arrow className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" aria-hidden="true" />
                    )}
                  </span>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">{goal.title}</p>
              </button>
            ))}
          {plan.goals.length === 0 && (
            <p className="text-sm text-stone-400 dark:text-stone-500">Nothing coming up yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
