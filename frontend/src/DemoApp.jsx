import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { ThemeProvider } from './state/ThemeProvider.jsx';
import { PlanProvider, usePlan } from './state/PlanProvider.jsx';
import { ChatProvider, useChat } from './state/ChatProvider.jsx';
import { AuthProvider, useAuth } from './state/AuthProvider.jsx';
import { preferencesApi, planApi } from './lib/api/index.js';
import { Onboarding } from './pages/Onboarding.jsx';
import { PlanPage } from './pages/PlanPage.jsx';
import { TaskDetail } from './pages/TaskDetail.jsx';
import { SignIn } from './pages/SignIn.jsx';
import { ChatSidebar } from './components/chat/ChatSidebar.jsx';
import { ThemeToggle } from './components/ui/ThemeToggle.jsx';
import { UserMenu } from './components/ui/UserMenu.jsx';
import { Spinner } from './components/ui/Spinner.jsx';
import { ErrorNotice } from './components/ui/ErrorNotice.jsx';

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
  return <main className="min-h-screen p-4 sm:p-6 text-stone-900 dark:text-stone-100">
    <div className={phase === 'calendar' ? 'max-w-6xl mx-auto' : 'max-w-xl mx-auto py-10'}>
      <header className="flex items-center justify-between gap-3 mb-6">
        <div><h1 className="font-serif text-3xl">Buddy</h1><p className="text-sm text-stone-500">A study plan that listens.</p></div>
        <div className="flex items-center gap-2"><ThemeToggle /><UserMenu />{phase === 'calendar' && <button type="button" onClick={toggle} className="flex gap-2 items-center rounded-lg bg-emerald-700 text-white px-3 py-2" aria-label="Open chat with Buddy"><MessageCircle className="w-4 h-4" />Ask Buddy</button>}</div>
      </header>
      {phase === 'welcome' && <section className="space-y-5">
        <h2 className="font-serif text-2xl">{mode === 'demo' ? 'Start with your demo week' : 'Start with your week'}</h2>
        <p className="text-sm text-stone-600 dark:text-stone-300">Your classes and study blocks are loaded from the preferences API. Confirm these settings or customize them first.</p>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 space-y-2 text-sm">
          <p><strong>{initial.plan.courses.length} CMU classes</strong> · September 12–25, 2026</p>
          {initial.plan.courses.map(c => <p key={c._id}>{c.name}</p>)}
          <hr className="border-stone-200 dark:border-stone-800" />
          <p>Default work window: 8 AM–5 PM · 15-minute breaks</p>
          <p>Calendar source: {mode === 'demo' ? 'Demo data' : 'MongoDB'}</p>
        </div>
        <div className="flex gap-3"><button disabled={busy} onClick={() => confirm(answers)} className="rounded-lg bg-emerald-700 text-white px-4 py-2">{busy ? 'Loading your calendar…' : 'Confirm preferences & view calendar'}</button><button disabled={busy} onClick={() => setPhase('onboarding')} className="text-sm underline">Customize</button></div>
        {error && <ErrorNotice error={error} onRetry={() => confirm(answers)} />}
      </section>}
      {phase === 'onboarding' && <Onboarding initialAnswers={answers} onComplete={confirm} submitting={busy} submitError={error} onRetry={() => confirm(answers)} />}
      {phase === 'calendar' && <>
        {/* Demo scaffolding, kept to one quiet line. Everything here is about the
            harness, not the student's week — it should never compete with the
            calendar for attention. */}
        {lastChange && <p role="status" className="mb-4 px-3 py-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 text-sm">Calendar rebuilt by CP-SAT · {lastChange.preferenceCalls.length} preference API calls applied.</p>}
        {error && <ErrorNotice error={error} onRetry={recalculate} />}
        {task ? <TaskDetail taskId={task} onBack={() => setTask(null)} /> : <PlanPage onOpenTask={setTask} />}
        <div className="mt-8 pt-4 border-t border-stone-200 dark:border-stone-800 text-xs text-stone-400 dark:text-stone-600 space-y-2">
          <p>
            <button disabled={sending} onClick={onReset} className="underline">{mode === 'demo' ? 'Reset demo' : 'Reload calendar'}</button>
            {' · '}<button disabled={sending || recalculating} onClick={recalculate} className="underline">{recalculating ? 'Recalculating…' : 'Recalculate'}</button>
            {lastChange && <> · <button disabled={sending} onClick={undo} className="underline">Undo last schedule change</button></>}
            {' · '}Demo week: September 12–25, 2026 · {initial.mode === 'openai' ? 'OpenAI + CP-SAT enabled' : 'OpenAI key not configured'} · {mode === 'demo' ? 'Demo session' : 'Preferences saved to MongoDB'}.
          </p>
          {notice && <details><summary className="cursor-pointer">How your preferences were applied</summary><p className="mt-1">{notice}</p></details>}
          {payload.unplaced?.length > 0 && <details><summary className="cursor-pointer">{payload.unplaced.length} unscheduled or outside-window blocks in the source plan</summary><ul className="mt-1">{payload.unplaced.map(b => <li key={b.id}>{b.title}</li>)}</ul></details>}
        </div>
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
  if (error) return <div className="max-w-xl mx-auto p-8"><UserMenu /><ErrorNotice error={error} onRetry={() => setVersion(v => v + 1)} /></div>;
  if (!initial) return <p className="p-8 text-stone-500">Loading preferences and building the calendar in the optimizer…</p>;
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
