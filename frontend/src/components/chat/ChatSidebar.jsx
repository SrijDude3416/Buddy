// Shared across Plan, Classes and task detail. Opens on request only, never
// auto-opens, and is always seeded with a context object rather than bare text.
import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useChat } from '../../state/ChatProvider.jsx';
import { Spinner } from '../ui/Spinner.jsx';
import { ErrorNotice } from '../ui/ErrorNotice.jsx';

function ChatProgress({ progress, cancel }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const steps = ['Feedback received', 'Understanding your feedback', 'Rebuilding schedule in optimizer'];
  const active = { sending: 0, interpreting: 1, scheduling: 2 }[progress.stage] ?? 0;
  return <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 p-3 space-y-3" aria-label="Buddy progress">
    <p role="status" className="text-sm text-emerald-900 dark:text-emerald-100">{progress.message}</p>
    <ol className="space-y-2 text-xs">
      {steps.map((label, i) => <li key={label} className={`flex gap-2 items-center ${i > active ? 'text-stone-400' : 'text-emerald-800 dark:text-emerald-200'}`}>
        {i < active ? <span aria-hidden="true">✓</span> : i === active ? <Spinner className="w-3 h-3" /> : <span aria-hidden="true">○</span>}
        <span>{i === 0 && progress.stage === 'sending' ? 'Sending feedback' : label}</span>
      </li>)}
    </ol>
    {progress.proposal && <div className="text-xs border-t border-emerald-200 dark:border-emerald-900 pt-2">
      <p className="font-medium mb-1">Buddy’s interpretation · preferences for the optimizer</p>
      <p>{progress.proposal}</p>
    </div>}
    <div className="flex justify-between items-center text-xs text-stone-500">
      <span aria-hidden="true">{elapsed}s elapsed</span>
      <button type="button" onClick={cancel} className="underline text-stone-700 dark:text-stone-200">Stop request</button>
    </div>
    {elapsed >= 8 && <p className="text-xs text-stone-500">Still working. Your calendar stays unchanged until the optimizer finishes. You can draft your next message below.</p>}
  </div>;
}

export function ChatSidebar() {
  const { open, close, messages, draft, setDraft, sendDraft, sending, error, context, send, lastChange, undo, progress, cancel } = useChat();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages.length, sending, progress?.stage, progress?.proposal]);

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={close} aria-hidden="true" />}
      <aside
        aria-hidden={!open}
        inert={!open}
        className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 z-50 flex flex-col transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full invisible'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800">
          <div>
            <p className="font-serif text-lg text-stone-900 dark:text-stone-100">Buddy</p>
            {context?.topic && <p className="text-xs text-stone-400 dark:text-stone-500">On: {context.topic}</p>}
          </div>
          <button type="button" onClick={close} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300" aria-label="Close chat">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {messages.length === 0 && !sending && (
            <p className="text-sm text-stone-400 dark:text-stone-500">
              Tell Buddy how you work. Applied changes appear in your calendar.
            </p>
          )}
          {messages.length === 0 && ["I prefer studying in the evening", "Keep Friday 7 PM to midnight free", "Limit Sunday study time to 90 minutes", "I need longer breaks during study stretches"].map(text => (
            <button key={text} type="button" disabled={sending} onClick={() => send(text)} className="block text-left text-xs rounded-lg border border-stone-300 dark:border-stone-700 px-3 py-2 w-full">{text}</button>
          ))}
          {messages.map((m) => (
            <div key={m._id} className={m.role === 'user' ? 'text-right' : ''}>
              <span
                className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${
                  m.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200'
                } ${m.pending ? 'opacity-60' : ''}`}
              >
                {m.text}
              </span>
              {m.mode && <p className="text-[10px] text-stone-500 mt-1">OpenAI → Preferences API → CP-SAT</p>}
              {m.preference_calls?.length > 0 && <details className="mt-2 text-xs text-left border border-emerald-300 rounded-lg p-2">
                <summary className="cursor-pointer">{m.preference_calls.length} preference API calls</summary>
                <pre className="whitespace-pre-wrap break-all mt-2 max-h-64 overflow-auto">{JSON.stringify(m.preference_calls, null, 2)}</pre>
              </details>}
            </div>
          ))}
          {sending && progress && <ChatProgress progress={progress} cancel={cancel} />}
          {error && <ErrorNotice error={error} compact />}
        </div>

        {lastChange && <button type="button" disabled={sending} onClick={undo} className="text-sm text-emerald-700 dark:text-emerald-300 py-2">Undo last schedule change</button>}
        <div className="p-3 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2">
          <input
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendDraft()}
            placeholder={sending ? "Draft your next message" : "Message Buddy"}
            aria-label="Message Buddy"
            className="flex-1 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button
            type="button"
            onClick={sendDraft}
            disabled={sending || !draft.trim()}
            className="p-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shrink-0 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
