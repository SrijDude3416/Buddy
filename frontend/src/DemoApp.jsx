import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, RefreshCw, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { ThemeProvider } from './state/ThemeProvider.jsx';
import { PlanProvider, usePlan } from './state/PlanProvider.jsx';
import { ChatProvider, useChat } from './state/ChatProvider.jsx';
import { AuthProvider, useAuth } from './state/AuthProvider.jsx';
import { preferencesApi, planApi } from './lib/api/index.js';
import { buildColorMap, colorFor } from './lib/courseColors.js';
import { Onboarding } from './pages/Onboarding.jsx';
import { PlanPage } from './pages/PlanPage.jsx';
import { TaskDetail } from './pages/TaskDetail.jsx';
import { SignIn } from './pages/SignIn.jsx';
import { ChatSidebar } from './components/chat/ChatSidebar.jsx';
import { ThemeToggle } from './components/ui/ThemeToggle.jsx';
import { UserMenu } from './components/ui/UserMenu.jsx';
import { Spinner } from './components/ui/Spinner.jsx';
import { ErrorNotice } from './components/ui/ErrorNotice.jsx';
import { BuddyMark, BuddyStar } from './components/ui/Brand.jsx';

const SUBTITLE = {
  welcome: 'Your week, solved by math you can talk to.',
  onboarding: 'Five quick questions. No forms.',
  calendar: 'Every session placed by the optimizer. Change anything by asking.',
};

/** The complement of CP-SAT's objective/bound gap, as a percentage string. */
function optimalityPercent(run) {
  if (!run || run.gap === null || run.gap === undefined) return null;
  return Math.max(0, Math.min(100, (1 - run.gap) * 100)).toFixed(1);
}

function Demo({ initial, onReset }) {
  const { mode } = useAuth();
  const { payload, setFromPayload } = usePlan();
  const { toggle, lastChange, undo, sending } = useChat();
  const [phase, setPhase] = useState('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [task, setTask] = useState(null);
  const [answers, setAnswers] = useState(initial.answers);
  const [recalculating, setRecalculating] = useState(false);
  async function confirm(next) {
    // The server already computed `initial.plan` once for these exact
    // answers on this page load (Python's GET /preferences/defaults --
    // itself a cache hit against MongoDB when nothing's changed, not a
    // fresh solve). Re-submitting the *same* answers through POST
    // /preferences would force a second, redundant ~15s CP-SAT solve for a
    // result the browser is already holding. Only actually solve again when
    // the answers changed (via "Customize").
    if (next === initial.answers) {
      setFromPayload(initial.plan);
      setNotice('');
      setPhase('calendar');
      return;
    }
    setBusy(true); setError(null); setAnswers(next);
    try {
      const result = await preferencesApi.confirm(next);
      setFromPayload(result.plan);
      setNotice(result.notice);
      setPhase('calendar');
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  // Forces a fresh CP-SAT solve with the CURRENT preferences and no new
  // operations -- no OpenAI round-trip, since nothing is being interpreted,
  // just re-run. The explicit escape hatch for when a page load's cached
  // plan (or the merged-in past) isn't what someone wants to see anymore.
  async function recalculate() {
    setRecalculating(true); setError(null);
    try {
      const result = await planApi.recalculate(payload.preferences, payload.courses.map(c => c._id));
      setFromPayload(result.plan);
      setNotice('Recalculated with your current preferences.');
    } catch (e) { setError(e); } finally { setRecalculating(false); }
  }

  // The welcome card previews the plan the server already solved. Same color
  // assignment the calendar will use (course order), so a class is the same
  // color here as it is on the grid a click later.
  const courses = initial.plan.courses;
  const colorMap = useMemo(() => buildColorMap(courses.map((c) => c._id)), [courses]);
  // The optimizer's task list also carries synthetic entries (one per meal
  // type, one per review-session occurrence, one per windowed commitment --
  // plan_payload.py) so the frontend has something to hang those sessions on.
  // They aren't assignments, so they don't count as ones here.
  const isSynthetic = (id) => /^(review|meal|commitment)_/.test(id ?? '');
  const assignments = initial.plan.tasks.filter((t) => t.course_id && !isSynthetic(t._id)).length;
  const studySessions = initial.plan.sessions.filter(
    (s) => s.type === 'flexible' && s.task_id && !/^(meal|commitment)_/.test(s.task_id),
  ).length;
  const optimality = optimalityPercent(initial.plan.run);
  const isDemo = mode === 'demo';

  return <main className="min-h-screen p-4 sm:p-6 text-stone-900 dark:text-stone-100">
    <div className={phase === 'calendar' ? 'max-w-6xl mx-auto' : 'max-w-xl mx-auto py-6 sm:py-10'}>
      <header className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <BuddyMark />
          <div className="min-w-0">
            {/* The rolling word is the landing hero's moment; in the app the mark stays still. */}
            <h1 className="font-serif text-2xl leading-tight tracking-tight"><BuddyStar /></h1>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 truncate">{SUBTITLE[phase]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <UserMenu />
          {phase === 'calendar' && (
            // The only way to change the schedule: talk to Buddy.
            <button
              type="button"
              onClick={toggle}
              aria-label="Open chat with Buddy"
              title="Ask Buddy to change your schedule"
              className="flex items-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 text-sm font-medium shadow-sm shadow-emerald-900/20 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Ask Buddy</span>
            </button>
          )}
        </div>
      </header>

      {phase === 'welcome' && <section className="space-y-6 buddy-rise">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {isDemo ? 'Demo week · September 12–25, 2026' : 'Your week · September 12–25, 2026'}
          </p>
          <h2 className="font-serif text-3xl tracking-tight mt-1">
            {isDemo ? 'Your demo week is already solved.' : 'Your week is already solved.'}
          </h2>
          <p className="text-sm text-stone-600 dark:text-stone-300 mt-2 leading-relaxed">
            Buddy loaded {courses.length} classes and placed every study session with CP-SAT around the fixed class
            times. Open the calendar as it is, or change how you work first.
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 shadow-sm shadow-stone-900/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
            <p className="text-sm font-medium text-stone-500 dark:text-stone-400">
              {courses.length} CMU classes on this plan
            </p>
          </div>
          <ul className="px-4 py-3 space-y-2">
            {courses.map((c) => {
              const color = colorFor(colorMap, c._id);
              return (
                <li key={c._id} className="flex items-center gap-2.5 text-sm">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />
                  <span className="text-stone-800 dark:text-stone-100 truncate">{c.name}</span>
                </li>
              );
            })}
          </ul>
          <div className="grid grid-cols-3 divide-x divide-stone-100 dark:divide-stone-800 border-t border-stone-100 dark:border-stone-800">
            <div className="px-4 py-3">
              <p className="font-serif text-2xl text-stone-900 dark:text-stone-100 leading-none">{assignments}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">assignments</p>
            </div>
            <div className="px-4 py-3">
              <p className="font-serif text-2xl text-stone-900 dark:text-stone-100 leading-none">{studySessions}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">study sessions placed</p>
            </div>
            <div className="px-4 py-3">
              <p className="font-serif text-2xl text-emerald-700 dark:text-emerald-400 leading-none">{optimality ? `${optimality}%` : '—'}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">provably optimal</p>
            </div>
          </div>
          <p className="px-4 py-2.5 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-400 dark:text-stone-500">
            {isDemo ? 'Sample data · nothing you do here is saved' : 'Live data from MongoDB · your changes are saved'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy}
            onClick={() => confirm(answers)}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white px-4 py-2.5 text-sm font-medium shadow-sm shadow-emerald-900/20 transition-colors"
          >
            {busy && <Spinner className="w-4 h-4" />}
            {busy ? 'Loading your calendar…' : 'Confirm preferences & view calendar'}
          </button>
          <button
            disabled={busy}
            onClick={() => setPhase('onboarding')}
            className="rounded-lg border border-stone-300 dark:border-stone-700 hover:border-emerald-600 dark:hover:border-emerald-500 px-4 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-200 transition-colors"
          >
            Customize
          </button>
        </div>
        {error && <ErrorNotice error={error} onRetry={() => confirm(answers)} />}
      </section>}

      {phase === 'onboarding' && <div className="buddy-rise"><Onboarding initialAnswers={answers} onComplete={confirm} submitting={busy} submitError={error} onRetry={() => confirm(answers)} /></div>}

      {phase === 'calendar' && <>
        {/* The one status line the chat leaves behind: what the optimizer just did, and the way back. */}
        {lastChange && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/80 dark:bg-emerald-950/60 px-4 py-2.5 text-sm text-emerald-900 dark:text-emerald-100">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" />
              Calendar rebuilt by CP-SAT · {lastChange.preferenceCalls.length} preference API call{lastChange.preferenceCalls.length === 1 ? '' : 's'} applied.
            </span>
            <button
              type="button"
              disabled={sending}
              onClick={undo}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200 hover:underline disabled:opacity-50"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo last schedule change
            </button>
          </div>
        )}
        {error && <ErrorNotice error={error} onRetry={recalculate} />}
        {task ? <TaskDetail taskId={task} onBack={() => setTask(null)} /> : <PlanPage onOpenTask={setTask} />}

        {/* Demo scaffolding, kept to one quiet strip. Everything here is about
            the harness, not the student's week — it should never compete with
            the calendar for attention. */}
        <footer className="mt-8 pt-4 border-t border-stone-200 dark:border-stone-800 space-y-2 text-xs text-stone-500 dark:text-stone-400">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Demo week: September 12–25, 2026</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span>{initial.mode === 'openai' ? 'OpenAI + CP-SAT enabled' : 'OpenAI key not configured'}</span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span>{isDemo ? 'Demo session · nothing is saved' : 'Preferences saved to MongoDB'}</span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                disabled={sending || recalculating}
                onClick={recalculate}
                title="Run the optimizer again with the current preferences"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-100 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recalculating ? 'animate-spin' : ''}`} />
                {recalculating ? 'Recalculating…' : 'Recalculate'}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={onReset}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-100 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {isDemo ? 'Reset demo' : 'Reload calendar'}
              </button>
            </span>
          </div>
          {notice && <details><summary className="cursor-pointer">How your preferences were applied</summary><p className="mt-1">{notice}</p></details>}
          {payload.unplaced?.length > 0 && <details><summary className="cursor-pointer">{payload.unplaced.length} unscheduled or outside-window blocks in the source plan</summary><ul className="mt-1">{payload.unplaced.map(b => <li key={b.id}>{b.title}</li>)}</ul></details>}
        </footer>
        <ChatSidebar />
      </>}
    </div>
  </main>;
}

/**
 * The signed-in app. Mounted only past the gate, which is the point: the first
 * preferences/optimizer call cannot fire before we know who is asking.
 */
function DemoShell() {
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInitial(null); setError(null);
    preferencesApi.list({ signal: controller.signal }).then(setInitial).catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [version]);
  if (error) {
    return (
      <div className="max-w-xl mx-auto p-6 sm:p-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BuddyMark className="w-8 h-8 text-base" />
            <span className="font-serif text-lg"><BuddyStar /></span>
          </div>
          <UserMenu />
        </div>
        <ErrorNotice error={error} onRetry={() => setVersion(v => v + 1)} title="Couldn't load your week" />
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center buddy-rise">
          <BuddyMark pulse className="w-12 h-12 text-2xl" />
          <p className="font-serif text-xl mt-4">Solving your week</p>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 flex items-center justify-center gap-2">
            <Spinner className="w-3.5 h-3.5" />
            Loading your classes and the last solved plan from the optimizer
          </p>
        </div>
      </div>
    );
  }
  return <PlanProvider key={version} initialPayload={initial.plan}><ChatProvider><Demo initial={initial} onReset={() => setVersion(v => v + 1)} /></ChatProvider></PlanProvider>;
}

/**
 * The auth gate. Nothing decision-shaped renders until /api/auth/session
 * answers, so a signed-in user never sees a flash of the sign-in screen and a
 * signed-out one never sees a half-loaded calendar.
 *
 * When the deployment runs in demo mode (BUDDY_ALLOW_DEMO=1, or a dev machine
 * with no Google credentials) that route hands back a fixed demo student and
 * this gate passes straight through — which is what keeps the zero-config
 * walkthrough, and the Playwright suite, working exactly as before.
 */
function Gate() {
  const { status, error, refresh } = useAuth();

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><Spinner className="w-5 h-5 text-stone-400" /></div>;
  }
  // Reaching the API failed outright — different from being signed out, and a
  // sign-in button here would just fail the same way.
  if (status === 'error') {
    return <div className="min-h-screen flex items-center justify-center p-6"><div className="w-full max-w-sm"><ErrorNotice error={error} onRetry={refresh} title="Can't reach Buddy" /></div></div>;
  }
  if (status !== 'signedIn') return <SignIn />;
  return <DemoShell />;
}

export default function DemoApp() {
  return <ThemeProvider><AuthProvider><Gate /></AuthProvider></ThemeProvider>;
}
