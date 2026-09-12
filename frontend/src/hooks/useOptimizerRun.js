// ---------------------------------------------------------------------------
// The engine behind the loading screen.
//
// Lifecycle: POST a run, poll it until terminal, then GET the plan. Written for
// the real thing rather than for the mock:
//   - server-reported `stage` and `progress` win whenever they are present; the
//     local ticker only fills gaps and never runs past 90%, so the bar can't
//     claim to be further along than the solver actually is
//   - polling backs off, aborts on unmount, and stops on a terminal status
//   - a hard timeout surfaces a retry instead of spinning forever
//   - `infeasible` is a distinct outcome, not an error: it means this genuinely
//     cannot be scheduled in time, which is worth showing rather than hiding
//   - a minimum display time keeps a fast solve from flashing the screen
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { optimizerApi, planApi } from '../lib/api/index.js';
import { config } from '../lib/config.js';
import { isAborted } from '../lib/errors.js';

export const RUN_STAGES = [
  { key: 'ingesting', label: 'Reading your syllabi and Canvas data' },
  { key: 'decomposing', label: 'Splitting assignments into sessions' },
  { key: 'compiling', label: 'Compiling your preferences into constraints' },
  { key: 'solving', label: 'Solving for the best placement' },
  { key: 'finalizing', label: 'Writing your week' },
];

const TERMINAL = new Set(['solved', 'infeasible', 'failed', 'cancelled']);
const MIN_VISIBLE_MS = 1200;

export function useOptimizerRun({ onSolved } = {}) {
  // idle | starting | running | solved | infeasible | failed | cancelled
  const [phase, setPhase] = useState('idle');
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [localFraction, setLocalFraction] = useState(0);

  const controllerRef = useRef(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const onSolvedRef = useRef(onSolved);
  onSolvedRef.current = onSolved;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // Local ticker. Purely cosmetic motion for the stretch where the server has
  // not reported anything yet; capped so it can never overtake real progress.
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'running') return undefined;
    const id = setInterval(() => {
      if (!mountedRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      setLocalFraction(Math.min(0.9, elapsed / Math.max(1, config.mockSolveMs)));
    }, 120);
    return () => clearInterval(id);
  }, [phase]);

  const start = useCallback(async ({ runContext, reset = true } = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;

    startedAtRef.current = Date.now();
    setPhase('starting');
    setError(null);
    setRun(null);
    setElapsedMs(0);
    setLocalFraction(0);

    const alive = () => mountedRef.current && !signal.aborted;

    try {
      let current = await optimizerApi.start({ runContext, reset, signal });
      if (!alive()) return;
      setRun(current);
      setPhase('running');

      let interval = config.runPollIntervalMs;
      while (!TERMINAL.has(current.status)) {
        if (Date.now() - startedAtRef.current > config.runTimeoutMs) {
          throw Object.assign(new Error('The solver is taking longer than expected.'), {
            code: 'run_timeout',
            retryable: true,
          });
        }
        await sleep(interval, signal);
        if (!alive()) return;
        current = await optimizerApi.get(current.run_id, { signal });
        if (!alive()) return;
        setRun(current);
        // Gentle backoff: a long solve shouldn't hammer the endpoint.
        interval = Math.min(interval * 1.25, 4000);
      }

      // Don't flash: if the whole thing took almost no time, hold briefly.
      const held = Date.now() - startedAtRef.current;
      if (held < MIN_VISIBLE_MS) await sleep(MIN_VISIBLE_MS - held, signal);
      if (!alive()) return;

      if (current.status !== 'solved') {
        setPhase(current.status);
        return;
      }

      const planPayload = await planApi.get({ signal });
      if (!alive()) return;
      setPhase('solved');
      onSolvedRef.current?.(planPayload, current);
    } catch (err) {
      if (isAborted(err) || !mountedRef.current) return;
      setError(err);
      setPhase('failed');
    }
  }, []);

  const cancel = useCallback(async () => {
    const runId = run?.run_id;
    controllerRef.current?.abort();
    setPhase('cancelled');
    if (runId) {
      // Best effort — the run is already abandoned client-side.
      try {
        await optimizerApi.cancel(runId);
      } catch {
        /* ignore */
      }
    }
  }, [run?.run_id]);

  // Server progress wins; the local ticker only fills in.
  const serverFraction = typeof run?.progress === 'number' ? run.progress : null;
  const fraction = phase === 'solved' ? 1 : Math.max(serverFraction ?? 0, localFraction);

  const stageKey = run?.stage ?? RUN_STAGES[0].key;
  const stageIndex = Math.max(0, RUN_STAGES.findIndex((s) => s.key === stageKey));

  return {
    phase,
    run,
    error,
    elapsedMs,
    fraction,
    stageIndex: phase === 'solved' ? RUN_STAGES.length - 1 : stageIndex,
    stages: RUN_STAGES,
    start,
    cancel,
    isBusy: phase === 'starting' || phase === 'running',
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { aborted: true }));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(Object.assign(new Error('aborted'), { aborted: true }));
      },
      { once: true },
    );
  });
}
