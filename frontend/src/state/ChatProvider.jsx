// ---------------------------------------------------------------------------
// Chat state. The sidebar is shared across Plan, Classes and task detail, so its
// transcript and open/closed state live above all three.
//
// Every open is seeded with a context object ({ task_id, course_id, topic }) so
// the backend can resolve what is being discussed without parsing free text
// (SCHEMA.md, chat_messages.context).
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { chatApi } from '../lib/api/index.js';
import { isAborted } from '../lib/errors.js';
import { usePlan } from './PlanProvider.jsx';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { refresh } = usePlan();
  const [open, setOpen] = useState(false); // closed by default, never auto-opens
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(
    async (text, msgContext = null) => {
      const body = (text ?? '').trim();
      if (!body || sending) return;

      setSending(true);
      setError(null);
      // Show the user's own message immediately; the server echoes it back with
      // a real _id, which replaces this one.
      const pendingId = `pending_${Date.now()}`;
      setMessages((prev) => [...prev, { _id: pendingId, role: 'user', text: body, pending: true }]);

      try {
        const res = await chatApi.send(body, msgContext ?? context);
        setMessages((prev) => [...prev.filter((m) => m._id !== pendingId), ...res.messages]);
        if (res.plan_changed) await refresh();
      } catch (err) {
        if (!isAborted(err)) {
          setMessages((prev) => prev.filter((m) => m._id !== pendingId));
          setError(err);
        }
      } finally {
        setSending(false);
      }
    },
    [context, refresh, sending],
  );

  /** Open the sidebar seeded with context, optionally sending a first message. */
  const openWith = useCallback(
    ({ seed = null, context: nextContext = null } = {}) => {
      setContext(nextContext);
      setOpen(true);
      if (seed) send(seed, nextContext);
    },
    [send],
  );

  const value = useMemo(
    () => ({
      open,
      messages,
      draft,
      setDraft,
      sending,
      error,
      context,
      openWith,
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
      send,
      sendDraft: () => {
        const text = draft;
        setDraft('');
        return send(text);
      },
    }),
    [open, messages, draft, sending, error, context, openWith, send],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
