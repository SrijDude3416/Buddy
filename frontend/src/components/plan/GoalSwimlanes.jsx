// ---------------------------------------------------------------------------
// Rows are goals, not days.
//
// The calendar answers "when is my time going?". This answers "what is my time
// going toward?" for the same day — each lane is one class, and every session
// sits under the goal it serves, on the same time axis as the calendar above it.
// A goal with nothing on the selected day still gets a lane, because an empty
// lane is information too.
// ---------------------------------------------------------------------------

import { Lock } from 'lucide-react';
import { sessionsByGoalForDay, visibleHourRange } from '../../lib/adapters.js';
import { colorFor } from '../../lib/courseColors.js';

function Lane({ row, startHour, endHour, colorMap, onOpenTask }) {
  const color = colorFor(colorMap, row.goal.id);
  const span = (endHour - startHour) * 60;
  const pos = (minutes) => ((minutes - startHour * 60) / span) * 100;

  const blocks = [
    ...row.fixed.map((item) => ({ item, kind: 'fixed' })),
    ...row.sessions.map((item) => ({ item, kind: 'session' })),
  ];

  return (
    <div className="flex items-stretch gap-3">
      <div className="w-36 shrink-0 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} />
          <span className="text-xs font-medium text-stone-700 dark:text-stone-200 truncate" title={row.goal.title}>
            {row.goal.code ?? row.goal.title}
          </span>
        </div>
        <span className="block text-[10px] text-stone-400 dark:text-stone-500 pl-3.5">
          {row.totalMin ? `${row.totalMin} min today` : 'nothing today'}
        </span>
      </div>

      <div className="relative flex-1 min-w-0 h-11 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
        {blocks.map(({ item, kind }) => {
          const left = Math.max(0, pos(item.minutesIntoDay));
          const width = Math.max(1.5, (item.durationMin / span) * 100);
          const style = { left: `${left}%`, width: `calc(${Math.min(width, 100 - left)}% - 2px)` };

          if (kind === 'fixed') {
            return (
              <div
                key={item.id}
                style={style}
                title={`${item.action} · ${item.timeLabel} · can't be moved`}
                className={`absolute top-1 bottom-1 rounded border flex items-center gap-1 px-1 overflow-hidden ${color.strongTint} ${color.strongBorder}`}
              >
                <Lock className={`w-2.5 h-2.5 shrink-0 opacity-50 ${color.strongSubtext}`} />
                <span className={`text-[10px] truncate ${color.strongText}`}>{item.action}</span>
              </div>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              style={style}
              onClick={() => onOpenTask?.(item.taskId)}
              title={`${item.action} · ${item.timeLabel} · ${item.durationMin} min`}
              className={`absolute top-1 bottom-1 rounded border px-1 flex items-center overflow-hidden hover:ring-2 hover:ring-emerald-500/60 ${color.tint} ${color.border}`}
            >
              <span className={`text-[10px] truncate ${item.completed ? 'line-through opacity-60' : ''} ${color.text}`}>
                {item.action}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function GoalSwimlanes({ plan, offset, dayLabel, onOpenTask }) {
  const rows = sessionsByGoalForDay(plan, offset);
  const { startHour, endHour } = visibleHourRange(plan, [offset]);

  if (!rows.length) {
    return <p className="text-sm text-stone-400 dark:text-stone-500">No classes yet.</p>;
  }

  const ticks = Array.from({ length: Math.max(2, Math.ceil((endHour - startHour) / 3)) + 1 }, (_, i) =>
    Math.min(endHour, startHour + i * 3),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-36 shrink-0" />
        <div className="flex-1 min-w-0 flex justify-between text-[10px] text-stone-400 dark:text-stone-500">
          {ticks.map((hour) => (
            <span key={hour}>{hour % 12 || 12}{hour < 12 ? 'a' : 'p'}</span>
          ))}
        </div>
      </div>

      {rows.map((row) => (
        <Lane
          key={row.goal.id}
          row={row}
          startHour={startHour}
          endHour={endHour}
          colorMap={plan.colorMap}
          onOpenTask={onOpenTask}
        />
      ))}

      <p className="text-[11px] text-stone-400 dark:text-stone-500 pt-1">
        Each row is a goal — {dayLabel.toLowerCase()}&apos;s sessions shown under the class they serve.
      </p>
    </div>
  );
}
