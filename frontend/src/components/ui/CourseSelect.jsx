// ---------------------------------------------------------------------------
// Multi-select dropdown over the course catalog.
//
// Still not free text: the user types only to filter, and can only ever commit a
// course that exists in the catalog. Picked courses become removable chips so the
// selection stays visible once the menu closes.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Spinner } from './Spinner.jsx';

export function CourseSelect({ courses, selectedIds, onToggle, onRemove, loading, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.department ?? '').toLowerCase().includes(q),
    );
  }, [courses, query]);

  useEffect(() => setActiveIndex(0), [query, open]);

  const selected = selectedIds.map((id) => courses.find((c) => c._id === id)).filter(Boolean);

  function commit(course) {
    onToggle(course._id);
    setQuery('');
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const course = filtered[activeIndex];
      if (course) commit(course);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((course) => (
            <span
              key={course._id}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-sm bg-emerald-700 text-white"
            >
              <span className="font-medium">{course.code}</span>
              <span className="max-w-32 truncate opacity-90">{course.name}</span>
              <button
                type="button"
                onClick={() => onRemove(course._id)}
                aria-label={`Remove ${course.code}`}
                className="rounded-full hover:bg-white/20 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm text-stone-700 dark:text-stone-200 hover:border-emerald-600 disabled:opacity-50"
      >
        <span className={selected.length ? '' : 'text-stone-400 dark:text-stone-500'}>
          {loading
            ? 'Loading the course catalog'
            : selected.length
              ? `${selected.length} class${selected.length === 1 ? '' : 'es'} selected`
              : 'Choose your classes'}
        </span>
        {loading ? <Spinner className="w-4 h-4" /> : <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200 dark:border-stone-800">
            <Search className="w-4 h-4 text-stone-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Filter by code, name or department"
              aria-label="Filter courses"
              className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
            />
          </div>

          <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto py-1">
            {filtered.map((course, i) => {
              const isSelected = selectedIds.includes(course._id);
              return (
                <li key={course._id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => commit(course)}
                    className={`w-full text-left px-3 py-2 flex items-start gap-2.5 ${
                      i === activeIndex ? 'bg-stone-100 dark:bg-stone-800' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                        isSelected
                          ? 'bg-emerald-700 border-emerald-700'
                          : 'border-stone-300 dark:border-stone-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-stone-900 dark:text-stone-100">
                        <span className="font-medium">{course.code}</span> · {course.name}
                      </span>
                      <span className="block text-xs text-stone-500 dark:text-stone-400">
                        {course.department} · {course.units} units · {course.meeting_times.length} weekly meeting
                        {course.meeting_times.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-stone-400 dark:text-stone-500">No course matches that.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
