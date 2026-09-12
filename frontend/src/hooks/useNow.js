import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs` (default one minute) so
 * anything derived from "has this already happened" — a session's own
 * automatic cross-out once its scheduled end passes — updates live while a
 * page sits open, instead of only on the next unrelated re-render. Real
 * wall-clock time, not the plan's own (fixed) `windowStart` anchor: the
 * point is to track what the person looking at the screen actually
 * experiences as "already happened," not the demo week's simulated date.
 */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
