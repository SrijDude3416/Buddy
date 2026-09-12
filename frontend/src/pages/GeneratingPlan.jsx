// ---------------------------------------------------------------------------
// The screen between onboarding and the first look.
//
// This is not a spinner with a fake progress bar. It renders whatever the
// optimizer run actually reports — stage, progress, and the objective/bound gap
// — and degrades honestly when the server hasn't reported anything yet:
//   - stages light up from the server's `stage` field; the local ticker only
//     animates the bar and is capped below 100% so it can't outrun the solver
//   - `infeasible` gets its own outcome, because "this genuinely can't be
//     scheduled in time" is information, not a failure to hide
//   - failure and timeout both offer retry and a way back to the answers
//   - the run id is shown once it exists, so a stuck solve is traceable to a
//     row in optimizer_runs
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { Check, CalendarClock, AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { useOptimizerRun } from '../hooks/useOptimizerRun.js';
import { Spinner } from '../components/ui/Spinner.jsx';

function StageRow({ stage, index, activeIndex, done }) {
  const isDone = done || index < activeIndex;
  const isActive = !done && index === activeIndex;

  return (
    <li className="flex items-center gap-3">
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isDone ? 'bg-emerald-600' : isActive ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-stone-200 dark:bg-stone-800'
        }`}
      >
        {isDone ? (
          <Check className="w-3 h-3 text-white" />
        ) : isActive ? (
          <Spinner className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
        ) : null}
      </span>
      <span
        className={`text-sm transition-colors ${
          isDone ? 'text-stone-500 dark:text-stone-400' : isActive ? 'text-stone-900 dark:text-stone-100 font-medium' : 'text-stone-400 dark:text-stone-600'
        }`}
      >
        {stage.label}
      </span>
    </li>
  );
}

export function GeneratingPlan({ runContext, onSolved, onBack }) {
  const { phase, run, error, fraction, stageIndex, stages, start, cancel, isBusy } = useOptimizerRun({ onSolved });

  // Kick the run once, on mount. A re-run is an explicit user action below.
  useEffect(() => {
    start({ runContext });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = Math.round(fraction * 100);

  if (phase === 'infeasible') {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400" />
          </span>
          <div>
            <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">This week is over-committed</h2>
            <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
              {run?.message ?? "Some of this genuinely can't fit before its deadline."} Nothing is scheduled yet — loosen
              one thing and Buddy will try again.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => start({ runContext })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Change my answers
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'failed' || phase === 'cancelled') {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">
            {phase === 'cancelled' ? 'Stopped' : "Couldn't build your week"}
          </h2>
          <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
            {phase === 'cancelled'
              ? 'The solve was cancelled. Nothing was saved.'
              : (error?.message ?? 'The solver did not come back.')}
          </p>
          {run?.run_id && <p className="text-xs text-stone-400 dark:text-stone-500 mt-2">Run {run.run_id}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => start({ runContext })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Change my answers
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-busy={isBusy}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center shrink-0">
          <CalendarClock className="w-5 h-5 text-white" />
        </span>
        <div>
          <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">Building your week</h2>
          <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
            Buddy is turning your answers into constraints and solving for the best fit. This usually takes a few
            seconds.
          </p>
        </div>
      </div>

      <div>
        <div className="h-1.5 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full bg-emerald-600 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-stone-400 dark:text-stone-500">{percent}%</span>
          {run?.run_id && <span className="text-xs text-stone-400 dark:text-stone-500">Run {run.run_id}</span>}
        </div>
      </div>

      <ul className="space-y-3">
        {stages.map((stage, i) => (
          <StageRow key={stage.key} stage={stage} index={i} activeIndex={stageIndex} done={phase === 'solved'} />
        ))}
      </ul>

      {/* The honest stat: CP-SAT reports a provable bound even when it can't
          prove optimality, so this is a real claim rather than a made-up number. */}
      {run?.gap !== null && run?.gap !== undefined && (
        <p className="text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg px-3 py-2">
          Provably within {(run.gap * 100).toFixed(1)}% of the best possible schedule for these constraints.
        </p>
      )}

      {isBusy && (
        <button type="button" onClick={cancel} className="text-sm text-stone-500 dark:text-stone-400 underline">
          Stop and change my answers
        </button>
      )}
    </div>
  );
}
