// ---------------------------------------------------------------------------
// The wordmark. "Buddy" stays put; the word in front of it rolls through what
// Buddy actually is on a given day — Study Buddy, Homework Buddy, Quiz Buddy —
// one at a time. The stacked words keep their natural widths, the current one
// is measured on every swap, and the container eases to that width while
// clipping whatever is wider than it — so a long word never paints over
// "Buddy" while the container is still catching up. The motion itself lives
// in index.css (buddy-word-*), so both the Vite and the Next.js builds get it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const BUDDY_WORDS = ['Study', 'Homework', 'Quiz', 'Exam', 'Schedule', 'Focus'];

// useLayoutEffect warns under server rendering (the render smoke test); the
// measurement it does is meaningless there anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * @param {object} props
 * @param {string[]} [props.words]
 * @param {number} [props.intervalMs] how long each word holds
 * @param {boolean} [props.animate] false renders the first word, static
 * @param {string} [props.className] font classes for the whole mark
 * @param {string} [props.accentClassName] color for the rolling word
 */
export function BuddyWordmark({
  words = BUDDY_WORDS,
  intervalMs = 2600,
  animate = true,
  className = '',
  accentClassName = 'text-emerald-700 dark:text-emerald-400',
}) {
  const [state, setState] = useState({ index: 0, prev: null });
  const [width, setWidth] = useState(null);
  const wordRefs = useRef([]);
  const wrapRef = useRef(null);
  const indexRef = useRef(0);
  indexRef.current = state.index;

  // The current word's own rendered width (transforms and opacity don't
  // affect offsetWidth, so mid-roll reads are still right). A zero -- not
  // laid out yet -- leaves the width alone, which falls back to the widest
  // word: a gap at worst, never an overlap.
  const measure = useCallback(() => {
    const w = wordRefs.current[indexRef.current]?.offsetWidth ?? 0;
    if (w > 0) setWidth(w);
  }, []);

  // Before paint on every swap, so the width and the word change together.
  useIsomorphicLayoutEffect(() => {
    if (animate) measure();
  }, [animate, state.index, words, measure]);

  // Re-measure when the font metrics could have changed under us: a viewport
  // breakpoint flipping the size, a late font load, the mark itself resizing.
  useEffect(() => {
    if (!animate) return undefined;
    window.addEventListener('resize', measure);
    document.fonts?.ready?.then(measure);
    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(wrapRef.current);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [animate, measure]);

  useEffect(() => {
    if (!animate || words.length < 2) return undefined;
    const timer = setInterval(() => {
      setState((s) => ({ index: (s.index + 1) % words.length, prev: s.index }));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [animate, intervalMs, words.length]);

  if (!animate) {
    return (
      <span className={`inline-flex whitespace-nowrap ${className}`}>
        <span className={accentClassName}>{words[0]}</span>
        <span>&nbsp;Buddy</span>
      </span>
    );
  }

  const { index, prev } = state;

  return (
    // Both halves sit in one inline-flex line, top-aligned with the same font
    // and line-height, so their baselines coincide without any cross-box
    // baseline alignment being involved. Only the roll box clips (index.css),
    // and it carries its own room for descenders.
    <span
      ref={wrapRef}
      className={`inline-flex items-start whitespace-nowrap ${className}`}
      aria-label={`${words[index]} Buddy`}
    >
      {/* justify-items-start keeps every stacked word at its natural width
          (so it can be measured) instead of stretching to the grid. */}
      <span className="buddy-word-roll inline-grid justify-items-start" style={width ? { width } : undefined} aria-hidden="true">
        {words.map((word, j) => (
          <span
            key={word}
            ref={(el) => { wordRefs.current[j] = el; }}
            className={`col-start-1 row-start-1 whitespace-nowrap buddy-word ${accentClassName} ${
              j === index ? 'buddy-word-in' : j === prev ? 'buddy-word-out' : 'buddy-word-wait'
            }`}
          >
            {word}
          </span>
        ))}
      </span>
      <span aria-hidden="true">&nbsp;Buddy</span>
    </span>
  );
}

/**
 * The still wordmark for screens where a rolling word would compete with the
 * content: an emerald asterisk, then "Buddy". The asterisk is the footnote
 * mark -- the one word standing in for every kind of buddy the landing page
 * spells out.
 */
export function BuddyStar({ className = '', accentClassName = 'text-emerald-700 dark:text-emerald-400' }) {
  return (
    <span className={`inline-flex whitespace-nowrap ${className}`}>
      <span className={accentClassName}>*</span>
      <span>Buddy</span>
    </span>
  );
}

/** The logo tile: a serif B on emerald, the same mark everywhere it appears. */
export function BuddyMark({ className = 'w-9 h-9 text-lg', pulse = false }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-xl bg-emerald-700 text-white font-serif shadow-sm shadow-emerald-900/20 ${pulse ? 'buddy-breathe' : ''} ${className}`}
    >
      B
    </span>
  );
}
