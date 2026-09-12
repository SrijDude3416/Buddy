// A real 24-hour dial: actual clock times mapped to angles, fixed blocks and
// flexible sessions drawn as arcs on the same ring.
import { INTENSITY_HEX, FIXED_HEX } from '../../lib/constants.js';

const DAY_START = 360; // 6:00 AM, in minutes
const SPAN = 1080; // 6am -> midnight
const R = 90;
const CIRCUMFERENCE = 2 * Math.PI * R;

function frac(minutes) {
  return Math.min(1, Math.max(0, (minutes - DAY_START) / SPAN));
}

export function RadialDayView({ items, emptyLabel = 'Nothing scheduled for this day.' }) {
  if (!items.length) {
    return <p className="text-sm text-stone-400 dark:text-stone-500 text-center py-8">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <svg viewBox="0 0 240 240" width="220" height="220" role="img" aria-label="Your day as a 24-hour dial">
        <circle cx="120" cy="120" r={R} fill="none" className="stroke-stone-200 dark:stroke-stone-800" strokeWidth="18" />
        {items.map(({ kind, item }) => {
          const startFrac = frac(item.minutesIntoDay);
          const lenFrac = Math.max(0.005, Math.min(1 - startFrac, item.durationMin / SPAN));
          const color = kind === 'fixed' ? FIXED_HEX : INTENSITY_HEX[item.intensity];
          return (
            <circle
              key={item.id}
              cx="120"
              cy="120"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="18"
              strokeDasharray={`${lenFrac * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={-startFrac * CIRCUMFERENCE}
              transform="rotate(-90 120 120)"
            />
          );
        })}
        <text x="120" y="116" textAnchor="middle" className="fill-stone-400 dark:fill-stone-500" style={{ fontSize: 10 }}>
          6am
        </text>
        <text x="120" y="130" textAnchor="middle" className="fill-stone-400 dark:fill-stone-500" style={{ fontSize: 10 }}>
          to midnight
        </text>
      </svg>
      <div className="flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-stone-600 inline-block" />
          Fixed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
          High focus
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          Lighter
        </span>
      </div>
    </div>
  );
}
