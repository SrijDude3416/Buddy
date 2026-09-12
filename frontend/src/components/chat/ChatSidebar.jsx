// Shared across Plan, Classes and task detail. Opens on request only, never
// auto-opens, and is always seeded with a context object rather than bare text.
import { useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';
import { useChat } from '../../state/ChatProvider.jsx';
import { Spinner } from '../ui/Spinner.jsx';
import { ErrorNotice } from '../ui/ErrorNotice.jsx';

export function ChatSidebar() {
  const { open, close, messages, draft, setDraft, sendDraft, sending, error, context } = useChat();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages.length, sending]);

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={close} aria-hidden="true" />}
      <aside
        aria-hidden={!open}
        className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 z-50 flex flex-col transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
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
              Ask Buddy to move something, or ask for help on a topic from Classes.
            </p>
          )}
          {messages.map((m) => (
            <div key={m._id} className={m.role === 'user' ? 'text-right' : ''}>
              <span
                className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${
                  m.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200'
                } ${m.pending ? 'opacity-60' : ''}`}
              >
                {m.text}
              </span>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
              <Spinner className="w-3.5 h-3.5" />
              <span className="text-xs">Buddy is thinking</span>
            </div>
          )}
          {error && <ErrorNotice error={error} compact />}
        </div>

        <div className="p-3 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendDraft()}
            placeholder="Message Buddy"
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
