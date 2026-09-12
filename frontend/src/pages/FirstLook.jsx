// The same generated plan through three switchable views, with one feedback box
// under the switcher that works regardless of which view is showing.
// Deliberately visually continuous with the hub but stripped down — no Classes
// tab, no sidebar, no drill-down.
import { useState } from 'react';
import { Send } from 'lucide-react';
import { PillTabs } from '../components/ui/PillTabs.jsx';
import { RadialDayView } from '../components/plan/RadialDayView.jsx';
import { GoalSwimlanes } from '../components/plan/GoalSwimlanes.jsx';
import { SessionList } from '../components/plan/SessionList.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';
import { timelineForDay } from '../lib/adapters.js';
import { usePlan } from '../state/PlanProvider.jsx';
import { chatApi } from '../lib/api/index.js';

const VIEWS = [
  { key: 'radial', label: 'Radial' },
  { key: 'goals', label: 'Goals' },
  { key: 'list', label: 'List' },
];

export function FirstLook({ onContinue }) {
  const { plan, nudgeSession, refresh, actionError, clearActionError } = usePlan();
  const [view, setView] = useState('radial');
  const [feedback, setFeedback] = useState('');
  const [log, setLog] = useState([]);
  const [sending, setSending] = useState(false);
  const [nudgingId, setNudgingId] = useState(null);

  const todayItems = timelineForDay(plan, 0);

  async function sendFeedback() {
    const text = feedback.trim();
    if (!text || sending) return;
    setSending(true);
    setFeedback('');
    setLog((prev) => [...prev, { role: 'user', text }]);
    try {
      const res = await chatApi.send(text, { stage: 'first_look' });
      const reply = res.messages.find((m) => m.role === 'bot');
      if (reply) setLog((prev) => [...prev, { role: 'bot', text: reply.text }]);
      if (res.plan_changed) await refresh();
    } catch (err) {
      setLog((prev) => [...prev, { role: 'bot', text: `Couldn't apply that: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  async function handleNudge(sessionId) {
    setNudgingId(sessionId);
    await nudgeSession(sessionId);
    setNudgingId(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">Here's a first look</h2>
        <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">Same plan, three ways to see it. Tell Buddy what to change below.</p>
      </div>

      {plan.run?.gap !== null && plan.run?.gap !== undefined && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Provably within {(plan.run.gap * 100).toFixed(1)}% of the best possible schedule for your constraints.
        </p>
      )}

      <PillTabs tabs={VIEWS} value={view} onChange={setView} />

      {view === 'radial' && <RadialDayView items={todayItems} />}
      {view === 'goals' && <GoalSwimlanes plan={plan} offset={0} dayLabel="Today" />}
      {view === 'list' && <SessionList plan={plan} onNudge={handleNudge} nudgingId={nudgingId} />}

      {actionError && <ErrorNotice error={actionError} onRetry={clearActionError} compact />}

      <div className="border-t border-stone-200 dark:border-stone-800 pt-4 space-y-2">
        {log.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <span
              className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${
                m.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200'
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendFeedback()}
            placeholder="e.g. move chem earlier in the day"
            aria-label="Tell Buddy what to change"
            className="flex-1 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button
            type="button"
            onClick={sendFeedback}
            disabled={sending || !feedback.trim()}
            className="p-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 disabled:opacity-40"
            aria-label="Send feedback"
          >
            {sending ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="w-full py-3 rounded-lg bg-emerald-700 text-white font-medium"
      >
        Looks good — build my week
      </button>
    </div>
  );
}
