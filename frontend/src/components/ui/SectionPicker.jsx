// ---------------------------------------------------------------------------
// Which lecture and recitation are yours.
//
// Part of the class question, not a sixth one (CLAUDE.md pins onboarding at five):
// picking a class isn't finished until the schedule knows which section of it you
// sit in. Only courses that genuinely offer a choice appear here — a class with a
// single lecture and no recitation has nothing to ask about, and asking anyway
// would be a form field pretending to be a decision.
// ---------------------------------------------------------------------------

import { Lock } from 'lucide-react';

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ["Wed","Mon"] -> "Mon, Wed" — catalog order isn't week order. */
function formatDays(days) {
  return [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).join(', ');
}

/** "13:00" -> "1:00 PM". The catalog's own 12-hour strings are lossy about noon. */
function formatTime(value) {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function describeSection(section) {
  if (!section.scheduled) return 'Time to be announced';
  return `${formatDays(section.days)} · ${formatTime(section.start_time)}–${formatTime(section.end_time)}`;
}

function SectionGroup({ label, sections, selectedId, onSelect, disabled }) {
  if (!sections.length) return null;

  // Nothing to decide: state it and move on rather than rendering a one-option radio.
  if (sections.length === 1) {
    const only = sections[0];
    return (
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-stone-500 dark:text-stone-400 shrink-0">{label}</span>
        <span className="text-stone-700 dark:text-stone-300">
          {only.section} · {describeSection(only)}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-stone-500 dark:text-stone-400">
        {label} · {sections.length} options
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {sections.map((section) => {
          const selected = section.id === selectedId;
          return (
            <button
              key={section.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(section.id)}
              title={[section.location, section.instructors].filter(Boolean).join(' · ') || undefined}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                selected
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white dark:bg-stone-900 border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:border-emerald-600'
              }`}
            >
              <span className="block text-xs font-medium">{section.section}</span>
              <span className={`block text-xs ${selected ? 'text-emerald-50' : 'text-stone-500 dark:text-stone-400'}`}>
                {describeSection(section)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SectionPicker({ courses, selections, onSelect, disabled }) {
  // Only courses where something is actually open to choose.
  const needChoice = courses.filter(
    (c) => (c.lecture?.length ?? 0) + (c.recitation?.length ?? 0) > 0,
  );
  if (!needChoice.length) return null;

  return (
    <div className="space-y-3 border-t border-stone-200 dark:border-stone-800 pt-3">
      <p className="text-sm text-stone-600 dark:text-stone-300">Which sections are yours?</p>
      {needChoice.map((course) => {
        const chosen = selections[course._id] ?? {};
        const unscheduled = [...(course.lecture ?? []), ...(course.recitation ?? [])].every((s) => !s.scheduled);
        return (
          <div key={course._id} className="space-y-2 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-3">
            <p className="text-sm text-stone-900 dark:text-stone-100">
              <span className="font-medium">{course.code}</span> · {course.name}
            </p>
            <SectionGroup
              label="Lecture"
              sections={course.lecture ?? []}
              selectedId={chosen.lecture}
              onSelect={(id) => onSelect(course._id, 'lecture', id)}
              disabled={disabled}
            />
            <SectionGroup
              label="Recitation"
              sections={course.recitation ?? []}
              selectedId={chosen.recitation}
              onSelect={(id) => onSelect(course._id, 'recitation', id)}
              disabled={disabled}
            />
            {unscheduled && (
              <p className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <Lock className="w-3 h-3 shrink-0" />
                The catalog has no meeting time for this class, so it won&apos;t appear on the calendar.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
