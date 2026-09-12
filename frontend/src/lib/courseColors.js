// ---------------------------------------------------------------------------
// One color per class, assigned once and used everywhere: calendar blocks, goal
// swimlanes, the legend, and the session dots. Assignment is deterministic from
// the course order in the plan, so a color never shifts between renders or views.
//
// Two tiers per class: the light `tint` for flexible sessions the optimizer
// placed, and the deeper `strong*` set for immovable class time. Both carry the
// class's own hue — a lecture and the session that studies for it should read as
// the same class at a glance, with the lock (not a different color) saying which
// one can't move. Only blocks with no class at all (gym, meals) go neutral.
//
// Class strings are written out in full rather than composed at runtime —
// Tailwind only generates classes it can see literally in the source.
// ---------------------------------------------------------------------------

export const COURSE_PALETTE = [
  {
    key: 'emerald',
    hex: '#059669',
    darkHex: '#34D399',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    tint: 'bg-emerald-50 dark:bg-emerald-950',
    strongTint: 'bg-emerald-100 dark:bg-emerald-900',
    strongBorder: 'border-emerald-400 dark:border-emerald-700',
    strongText: 'text-emerald-950 dark:text-emerald-50',
    strongSubtext: 'text-emerald-800 dark:text-emerald-200',
    border: 'border-emerald-300 dark:border-emerald-800',
    rail: 'bg-emerald-500 dark:bg-emerald-400',
    text: 'text-emerald-900 dark:text-emerald-100',
    subtext: 'text-emerald-700 dark:text-emerald-300',
  },
  {
    key: 'sky',
    hex: '#0284C7',
    darkHex: '#38BDF8',
    dot: 'bg-sky-600 dark:bg-sky-400',
    tint: 'bg-sky-50 dark:bg-sky-950',
    strongTint: 'bg-sky-100 dark:bg-sky-900',
    strongBorder: 'border-sky-400 dark:border-sky-700',
    strongText: 'text-sky-950 dark:text-sky-50',
    strongSubtext: 'text-sky-800 dark:text-sky-200',
    border: 'border-sky-300 dark:border-sky-800',
    rail: 'bg-sky-500 dark:bg-sky-400',
    text: 'text-sky-900 dark:text-sky-100',
    subtext: 'text-sky-700 dark:text-sky-300',
  },
  {
    key: 'violet',
    hex: '#7C3AED',
    darkHex: '#A78BFA',
    dot: 'bg-violet-600 dark:bg-violet-400',
    tint: 'bg-violet-50 dark:bg-violet-950',
    strongTint: 'bg-violet-100 dark:bg-violet-900',
    strongBorder: 'border-violet-400 dark:border-violet-700',
    strongText: 'text-violet-950 dark:text-violet-50',
    strongSubtext: 'text-violet-800 dark:text-violet-200',
    border: 'border-violet-300 dark:border-violet-800',
    rail: 'bg-violet-500 dark:bg-violet-400',
    text: 'text-violet-900 dark:text-violet-100',
    subtext: 'text-violet-700 dark:text-violet-300',
  },
  {
    key: 'amber',
    hex: '#D97706',
    darkHex: '#FBBF24',
    dot: 'bg-amber-600 dark:bg-amber-400',
    tint: 'bg-amber-50 dark:bg-amber-950',
    strongTint: 'bg-amber-100 dark:bg-amber-900',
    strongBorder: 'border-amber-400 dark:border-amber-700',
    strongText: 'text-amber-950 dark:text-amber-50',
    strongSubtext: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-300 dark:border-amber-800',
    rail: 'bg-amber-500 dark:bg-amber-400',
    text: 'text-amber-900 dark:text-amber-100',
    subtext: 'text-amber-700 dark:text-amber-300',
  },
  {
    key: 'rose',
    hex: '#E11D48',
    darkHex: '#FB7185',
    dot: 'bg-rose-600 dark:bg-rose-400',
    tint: 'bg-rose-50 dark:bg-rose-950',
    strongTint: 'bg-rose-100 dark:bg-rose-900',
    strongBorder: 'border-rose-400 dark:border-rose-700',
    strongText: 'text-rose-950 dark:text-rose-50',
    strongSubtext: 'text-rose-800 dark:text-rose-200',
    border: 'border-rose-300 dark:border-rose-800',
    rail: 'bg-rose-500 dark:bg-rose-400',
    text: 'text-rose-900 dark:text-rose-100',
    subtext: 'text-rose-700 dark:text-rose-300',
  },
  {
    key: 'teal',
    hex: '#0D9488',
    darkHex: '#2DD4BF',
    dot: 'bg-teal-600 dark:bg-teal-400',
    tint: 'bg-teal-50 dark:bg-teal-950',
    strongTint: 'bg-teal-100 dark:bg-teal-900',
    strongBorder: 'border-teal-400 dark:border-teal-700',
    strongText: 'text-teal-950 dark:text-teal-50',
    strongSubtext: 'text-teal-800 dark:text-teal-200',
    border: 'border-teal-300 dark:border-teal-800',
    rail: 'bg-teal-500 dark:bg-teal-400',
    text: 'text-teal-900 dark:text-teal-100',
    subtext: 'text-teal-700 dark:text-teal-300',
  },
  {
    key: 'indigo',
    hex: '#4F46E5',
    darkHex: '#818CF8',
    dot: 'bg-indigo-600 dark:bg-indigo-400',
    tint: 'bg-indigo-50 dark:bg-indigo-950',
    strongTint: 'bg-indigo-100 dark:bg-indigo-900',
    strongBorder: 'border-indigo-400 dark:border-indigo-700',
    strongText: 'text-indigo-950 dark:text-indigo-50',
    strongSubtext: 'text-indigo-800 dark:text-indigo-200',
    border: 'border-indigo-300 dark:border-indigo-800',
    rail: 'bg-indigo-500 dark:bg-indigo-400',
    text: 'text-indigo-900 dark:text-indigo-100',
    subtext: 'text-indigo-700 dark:text-indigo-300',
  },
  {
    key: 'orange',
    hex: '#EA580C',
    darkHex: '#FB923C',
    dot: 'bg-orange-600 dark:bg-orange-400',
    tint: 'bg-orange-50 dark:bg-orange-950',
    strongTint: 'bg-orange-100 dark:bg-orange-900',
    strongBorder: 'border-orange-400 dark:border-orange-700',
    strongText: 'text-orange-950 dark:text-orange-50',
    strongSubtext: 'text-orange-800 dark:text-orange-200',
    border: 'border-orange-300 dark:border-orange-800',
    rail: 'bg-orange-500 dark:bg-orange-400',
    text: 'text-orange-900 dark:text-orange-100',
    subtext: 'text-orange-700 dark:text-orange-300',
  },
];

/** Fallback for anything with no course (shouldn't happen, but never crash). */
export const NEUTRAL_COLOR = {
  key: 'stone',
  hex: '#57534E',
  darkHex: '#A8A29E',
  dot: 'bg-stone-500 dark:bg-stone-400',
  tint: 'bg-stone-100 dark:bg-stone-800',
  strongTint: 'bg-stone-200 dark:bg-stone-800',
  strongBorder: 'border-stone-300 dark:border-stone-700',
  strongText: 'text-stone-800 dark:text-stone-100',
  strongSubtext: 'text-stone-600 dark:text-stone-400',
  border: 'border-stone-300 dark:border-stone-700',
  rail: 'bg-stone-500 dark:bg-stone-400',
  text: 'text-stone-900 dark:text-stone-100',
  subtext: 'text-stone-600 dark:text-stone-400',
};

/**
 * @param {string[]} courseIds in the order the plan lists them
 * @returns {Map<string, typeof COURSE_PALETTE[0]>}
 */
export function buildColorMap(courseIds) {
  const map = new Map();
  courseIds.forEach((id, i) => {
    map.set(id, COURSE_PALETTE[i % COURSE_PALETTE.length]);
  });
  return map;
}

export function colorFor(colorMap, courseId) {
  return colorMap?.get(courseId) ?? NEUTRAL_COLOR;
}
