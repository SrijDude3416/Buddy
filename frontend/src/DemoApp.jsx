import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { ThemeProvider } from './state/ThemeProvider.jsx';
import { PlanProvider, usePlan } from './state/PlanProvider.jsx';
import { ChatProvider, useChat } from './state/ChatProvider.jsx';
import { preferencesApi, planApi } from './lib/api/index.js';
import { Onboarding } from './pages/Onboarding.jsx';
import { PlanPage } from './pages/PlanPage.jsx';
import { TaskDetail } from './pages/TaskDetail.jsx';
import { ChatSidebar } from './components/chat/ChatSidebar.jsx';
import { ThemeToggle } from './components/ui/ThemeToggle.jsx';
import { ErrorNotice } from './components/ui/ErrorNotice.jsx';

function Demo({ initial, onReset }) {
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
        <div className="flex items-center gap-2"><ThemeToggle />{phase === 'calendar' && <button type="button" onClick={toggle} className="flex gap-2 items-center rounded-lg bg-emerald-700 text-white px-3 py-2" aria-label="Open chat with Buddy"><MessageCircle className="w-4 h-4" />Ask Buddy</button>}</div>
      </header>
      {phase === 'welcome' && <section className="space-y-5">
        <h2 className="font-serif text-2xl">Start with your demo week</h2>
        <p className="text-sm text-stone-600 dark:text-stone-300">Your classes and study blocks are loaded from the preferences API. Confirm these settings or customize them first.</p>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 space-y-2 text-sm">
          <p><strong>{initial.plan.courses.length} CMU classes</strong> · September 12–25, 2026</p>
          {initial.plan.courses.map(c => <p key={c._id}>{c.name}</p>)}
          <hr className="border-stone-200 dark:border-stone-800" />
          <p>Default work window: 8 AM–5 PM · 15-minute breaks</p>
          <p>Calendar source: existing CP-SAT solver and static test data</p>
        </div>
        <div className="flex gap-3"><button disabled={busy} onClick={() => confirm(answers)} className="rounded-lg bg-emerald-700 text-white px-4 py-2">{busy ? 'Loading your calendar…' : 'Confirm preferences & view calendar'}</button><button disabled={busy} onClick={() => setPhase('onboarding')} className="text-sm underline">Customize</button></div>
        {error && <ErrorNotice error={error} onRetry={() => confirm(answers)} />}
      </section>}
      {phase === 'onboarding' && <Onboarding initialAnswers={answers} onComplete={confirm} submitting={busy} submitError={error} onRetry={() => confirm(answers)} />}
      {phase === 'calendar' && <>
        <div className="mb-4 text-xs text-stone-500 space-y-2">
          <p>Demo week: September 12–25, 2026 · {initial.mode === 'openai' ? 'OpenAI + CP-SAT enabled' : 'OpenAI key not configured'} · Changes stay in this tab.</p>
          {notice && <details><summary className="cursor-pointer">How your preferences were applied</summary><p className="mt-1">{notice}</p></details>}
          <button disabled={sending} onClick={onReset} className="underline mr-4">Reset demo</button>
          <button disabled={sending || recalculating} onClick={recalculate} className="underline mr-4">{recalculating ? 'Recalculating…' : 'Recalculate'}</button>
          {lastChange && <button disabled={sending} onClick={undo} className="underline text-emerald-700 dark:text-emerald-300">Undo last schedule change</button>}
        </div>
        {lastChange && <p role="status" className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 text-sm">Calendar rebuilt by CP-SAT · {lastChange.preferenceCalls.length} preference API calls applied.</p>}
        {payload.run?.engine === 'CP-SAT' && <p className="text-xs text-stone-500 mb-4">Optimizer: {payload.run.solverStatus} · {payload.run.solve_seconds?.toFixed(1)}s solve time{payload.run.gap != null ? ` · ${(payload.run.gap * 100).toFixed(1)}% objective bound gap` : ''}</p>}
        {error && <ErrorNotice error={error} onRetry={recalculate} />}
        {task ? <TaskDetail taskId={task} onBack={() => setTask(null)} /> : <PlanPage onOpenTask={setTask} />}
        {payload.unplaced?.length > 0 && <details className="mt-6 text-sm text-stone-500"><summary className="cursor-pointer">{payload.unplaced.length} unscheduled or outside-window blocks in the source plan</summary><ul className="mt-2">{payload.unplaced.map(b => <li key={b.id}>{b.title}</li>)}</ul></details>}
        <ChatSidebar />
      </>}
    </div>
  </main>;
}

export default function DemoApp() {
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInitial(null); setError(null);
    preferencesApi.list({ signal: controller.signal }).then(setInitial).catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [version]);
  return <ThemeProvider>{error ? <div className="max-w-xl mx-auto p-8"><ErrorNotice error={error} onRetry={() => setVersion(v => v + 1)} /></div> : !initial ? <p className="p-8 text-stone-500">Loading preferences and building the calendar in the optimizer…</p> : <PlanProvider key={version} initialPayload={initial.plan}><ChatProvider><Demo initial={initial} onReset={() => setVersion(v => v + 1)} /></ChatProvider></PlanProvider>}</ThemeProvider>;
}
