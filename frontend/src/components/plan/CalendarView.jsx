// ---------------------------------------------------------------------------
// An actual calendar grid: a real time axis with blocks positioned by their
// start time and sized by their duration.
//
// Fixed blocks and flexible sessions are drawn from the same list and laid out by
// the same rules — a lecture just renders as immovable (dark, locked, not
// clickable). Overlaps, if a re-solve ever produces one, split into side-by-side
// lanes rather than hiding one behind the other.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { assignLanes, itemsForDay, visibleHourRange } from '../../lib/adapters.js';
import { colorFor } from '../../lib/courseColors.js';

const PX_PER_HOUR = 56;
const GUTTER = 52;

function hourLabel(hour) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 || hour === 24 ? 'AM' : 'PM';
  return `${h} ${ampm}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function Block({ entry, laneCount, startHour, colorMap, onOpenTask }) {
  const { item, lane } = entry;
  const color = colorFor(colorMap, item.courseId);
  const top = ((item.minutesIntoDay - startHour * 60) / 60) * PX_PER_HOUR;
  const height = Math.max(20, (item.durationMin / 60) * PX_PER_HOUR - 2);
  const widthPct = 100 / laneCount;

  const style = {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${lane * widthPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  };

  const isFixed = item.type === 'fixed';
  const tight = height < 38;

  if (isFixed) {
    // Class time carries its class's own color, one shade deeper than the
    // sessions that study for it. The lock is what says "immovable" — not a
    // black block that reads as a different kind of thing entirely.
    return (
      <div
        style={style}
        title={`${item.action} · ${item.timeLabel} · ${item.durationMin} min · can't be moved`}
        className={`absolute rounded-lg overflow-hidden border flex ${color.strongTint} ${color.strongBorder}`}
      >
        <span className={`w-1 shrink-0 ${color.rail}`} />
        <span className="px-1.5 py-1 min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <Lock className={`w-2.5 h-2.5 shrink-0 opacity-50 ${color.strongSubtext}`} />
            <span className={`text-[11px] font-medium truncate ${color.strongText}`}>{item.action}</span>
          </span>
          {!tight && <span className={`block text-[10px] truncate ${color.strongSubtext}`}>{item.timeLabel}</span>}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      style={style}
      onClick={() => onOpenTask?.(item.taskId)}
      data-event-id={item.id}
      data-start={item.start}
      data-end={item.end}
      title={[item.action, item.courseTitle, item.timeLabel, `${item.durationMin} min`].filter(Boolean).join(' · ')}
      className={`absolute rounded-lg overflow-hidden border text-left flex hover:ring-2 hover:ring-emerald-500/40 transition-shadow ${color.tint} ${color.border}`}
    >
      <span className={`w-1 shrink-0 ${color.rail}`} />
      <span className="px-1.5 py-1 min-w-0 flex-1">
        <span
          className={`block text-[11px] font-medium truncate ${
            item.completed ? 'line-through opacity-60' : ''
          } ${color.text}`}
        >
          {item.action}
        </span>
        {!tight && <span className={`block text-[10px] truncate ${color.subtext}`}>{item.timeLabel} · {item.durationMin}m</span>}
      </span>
    </button>
  );
}

function DayColumn({ plan, offset, startHour, endHour, colorMap, onOpenTask, isToday }) {
  const items = itemsForDay(plan, offset);
  const { placed, laneCount } = useMemo(() => assignLanes(items), [items]);
  const hours = endHour - startHour;
  const [now, setNow] = useState(nowMinutes);

  // Keep the "now" line honest without re-rendering constantly.
  useEffect(() => {
    if (!isToday) return undefined;
    const id = setInterval(() => setNow(nowMinutes()), 60000);
    return () => clearInterval(id);
  }, [isToday]);

  const showNow = isToday && now >= startHour * 60 && now <= endHour * 60;

  return (
    <div className="relative flex-1 min-w-0 border-l border-stone-100 dark:border-stone-900" style={{ height: hours * PX_PER_HOUR }}>
      {Array.from({ length: hours }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-stone-100/80 dark:border-stone-900"
          style={{ top: i * PX_PER_HOUR }}
        />
      ))}

      {showNow && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ top: ((now - startHour * 60) / 60) * PX_PER_HOUR }}
          aria-hidden="true"
        >
          <span className="block h-px bg-rose-500" />
          <span className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-rose-500" />
        </div>
      )}

      {placed.map((entry) => (
        <Block
          key={entry.item.id}
          entry={entry}
          laneCount={laneCount}
          startHour={startHour}
          colorMap={colorMap}
          onOpenTask={onOpenTask}
        />
      ))}

      {items.length === 0 && (
        <span className="absolute inset-x-0 top-3 text-center text-[11px] text-stone-300 dark:text-stone-700">—</span>
      )}
    </div>
  );
}

export function CalendarView({ plan, days, selectedOffset, onSelectDay, onOpenTask }) {
  const offsets = days.map((d) => d.offset);
  const { startHour, endHour } = useMemo(() => visibleHourRange(plan, offsets), [plan, offsets.join(',')]);
  const hours = endHour - startHour;
  const scrollRef = useRef(null);
  const previous = useRef(null);
  useEffect(() => {
    const current = plan.flexibleSessions;
    if (previous.current) {
      const changed = current.find(s => offsets.includes(s.dayOffset) && !previous.current.some(old => old.id === s.id && old.start === s.start && old.durationMin === s.durationMin));
      if (changed && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, ((changed.minutesIntoDay - startHour * 60) / 60) * PX_PER_HOUR - 60);
    }
    previous.current = current;
  }, [plan.flexibleSessions, offsets.join(','), startHour]);

  return (
    <div className="self-start bg-white dark:bg-stone-900 border border-stone-200/70 dark:border-stone-800 rounded-2xl overflow-hidden">
      <div className="flex border-b border-stone-100 dark:border-stone-800">
        <div className="shrink-0" style={{ width: GUTTER }} />
        {days.map((day) => {
          const isSelected = day.offset === selectedOffset;
          return (
            <button
              key={day.offset}
              type="button"
              onClick={() => onSelectDay(day.offset)}
              aria-pressed={isSelected}
              className={`flex-1 min-w-0 px-1 py-2 border-l border-stone-100 dark:border-stone-900 transition-colors ${
                isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/60' : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
              }`}
            >
              <span
                className={`block text-xs font-medium truncate ${
                  isSelected ? 'text-emerald-800 dark:text-emerald-200' : 'text-stone-600 dark:text-stone-300'
                }`}
              >
                {day.label}
              </span>
              <span className="block text-[10px] text-stone-400 dark:text-stone-500">{day.date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 460 }}>
        <div className="flex">
          <div className="shrink-0 relative" style={{ width: GUTTER, height: hours * PX_PER_HOUR }}>
            {Array.from({ length: hours }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] text-stone-400 dark:text-stone-500 tabular-nums"
                style={{ top: i * PX_PER_HOUR }}
              >
                {hourLabel(startHour + i)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <DayColumn
              key={day.offset}
              plan={plan}
              offset={day.offset}
              startHour={startHour}
              endHour={endHour}
              colorMap={plan.colorMap}
              onOpenTask={onOpenTask}
              isToday={!plan.windowStart && day.offset === 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
