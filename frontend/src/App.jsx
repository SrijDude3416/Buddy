// ---------------------------------------------------------------------------
// App shell and phase machine.
//
//   onboarding -> (POST /preferences) -> generating -> first_look -> hub
//
// `generating` is a real gate, not a transition: nothing downstream renders until
// an optimizer run reaches a terminal status, so this shell behaves the same
// whether the solve takes 200ms against dummy data or 20s against CP-SAT.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { PillTabs } from './components/ui/PillTabs.jsx';
import { ChatSidebar } from './components/chat/ChatSidebar.jsx';
import { Onboarding } from './pages/Onboarding.jsx';
import { GeneratingPlan } from './pages/GeneratingPlan.jsx';
import { FirstLook } from './pages/FirstLook.jsx';
import { PlanPage } from './pages/PlanPage.jsx';
import { ClassesPage } from './pages/ClassesPage.jsx';
import { TaskDetail } from './pages/TaskDetail.jsx';
import { PlanProvider, usePlan } from './state/PlanProvider.jsx';
import { ChatProvider, useChat } from './state/ChatProvider.jsx';
import { ThemeProvider } from './state/ThemeProvider.jsx';
import { ThemeToggle } from './components/ui/ThemeToggle.jsx';
import { preferencesApi } from './lib/api/index.js';
import { preferencesFromOnboarding, runContextFromOnboarding } from './lib/onboarding.js';
import { isAborted } from './lib/errors.js';
import { config } from './lib/config.js';

const HUB_TABS = [
  { key: 'plan', label: 'Plan' },
  { key: 'classes', label: 'Classes' },
];

function HubHeader({ page, setPage }) {
  const { toggle } = useChat();
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <PillTabs tabs={HUB_TABS} value={page === 'task' ? 'plan' : page} onChange={setPage} />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {/* The only way to change the schedule: talk to Buddy. */}
        <button
          type="button"
          onClick={toggle}
          aria-label="Open chat with Buddy"
          title="Ask Buddy to change your schedule"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:border-emerald-600 transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="hidden sm:inline text-sm font-medium">Ask Buddy</span>
        </button>
      </div>
    </div>
  );
}

function Hub() {
  const [page, setPage] = useState('plan');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  return (
    <>
      <HubHeader page={page} setPage={setPage} />
      {page === 'plan' && (
        <PlanPage
          onOpenTask={(taskId) => {
            setSelectedTaskId(taskId);
            setPage('task');
          }}
        />
      )}
      {page === 'classes' && <ClassesPage />}
      {page === 'task' && <TaskDetail taskId={selectedTaskId} onBack={() => setPage('plan')} />}
      <ChatSidebar />
    </>
  );
}

function Shell() {
  const { setFromPayload } = usePlan();
  // onboarding | generating | first_look | hub
  const [phase, setPhase] = useState('onboarding');
  const [answers, setAnswers] = useState({});
  const [runContext, setRunContext] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Onboarding answers become typed preference entries, are persisted, and only
  // then does the run start. A failure here keeps the user on onboarding with a
  // retry rather than dropping them into a solve with nothing saved.
  const submitOnboarding = useCallback(
    async (finalAnswers) => {
      setAnswers(finalAnswers);
      setSubmitting(true);
      setSubmitError(null);
      try {
        const entries = preferencesFromOnboarding(finalAnswers);
        await preferencesApi.create(entries, { replaceSource: 'onboarding' });
        setRunContext(runContextFromOnboarding(finalAnswers));
        setPhase('generating');
      } catch (err) {
        if (!isAborted(err)) setSubmitError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const handleSolved = useCallback(
    (planPayload) => {
      setFromPayload(planPayload);
      setPhase('first_look');
    },
    [setFromPayload],
  );

  // The hub needs the width for a calendar; onboarding and the first look stay
  // narrow and centered.
  const wide = phase === 'hub';

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans flex items-start justify-center p-4 sm:p-6">
      <div className={`w-full ${wide ? 'max-w-6xl' : 'max-w-xl'}`}>
        {phase === 'onboarding' && (
          <Onboarding
            onComplete={submitOnboarding}
            submitting={submitting}
            submitError={submitError}
            onRetry={() => submitOnboarding(answers)}
            initialAnswers={answers}
          />
        )}

        {phase === 'generating' && (
          <GeneratingPlan
            runContext={runContext}
            onSolved={handleSolved}
            onBack={() => setPhase('onboarding')}
          />
        )}

        {phase === 'first_look' && <FirstLook onContinue={() => setPhase('hub')} />}

        {phase === 'hub' && <Hub />}

        {config.apiMode === 'mock' && (
          <p className="mt-8 text-xs text-stone-400 dark:text-stone-600 text-center">
            Running on dummy data · set VITE_API_MODE=live to hit the real backend
          </p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <PlanProvider>
        <ChatProvider>
          <Shell />
        </ChatProvider>
      </PlanProvider>
    </ThemeProvider>
  );
}
