// ---------------------------------------------------------------------------
// Chat state. The sidebar is shared across Plan, Classes and task detail, so its
// transcript and open/closed state live above all three.
//
// Every open is seeded with a context object ({ task_id, course_id, topic }) so
// the backend can resolve what is being discussed without parsing free text
// (SCHEMA.md, chat_messages.context).
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { chatApi } from '../lib/api/index.js';
import { isAborted } from '../lib/errors.js';
import { usePlan } from './PlanProvider.jsx';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { refresh, payload, setFromPayload } = usePlan();
  const inFlight = useRef(false);
  const requestRef = useRef(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const [lastChange, setLastChange] = useState(null);
  const [open, setOpen] = useState(false); // closed by default, never auto-opens
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(
    async (text, msgContext = null) => {
      const body = (text ?? '').trim();
      if (!body || inFlight.current) return;
      inFlight.current = true;

      const controller = new AbortController();
      requestRef.current = controller;
      setProgress({ stage: 'sending', message: 'Sending your feedback…', startedAt: Date.now() });
      setDraft(value => value.trim() === body ? '' : value);
      setSending(true);
      setError(null);
      // Show the user's own message immediately; the server echoes it back with
      // a real _id, which replaces this one.
      const pendingId = `pending_${Date.now()}`;
      setMessages((prev) => [...prev, { _id: pendingId, role: 'user', text: body, pending: true }]);

      try {
        const res = await chatApi.send(body, msgContext ?? context, { signal: controller.signal, onProgress: event => {
          if (controller.signal.aborted) return;
          setProgress(prev => event.type === 'proposal' ? { ...prev, proposal: event.message, operationCount: event.operationCount } : { ...prev, stage: event.stage, message: event.message });
        }, plan: payload, history: messages.filter(m => !m.pending).slice(-8).map(({ role, text }) => ({ role, text })) });
        if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        setMessages((prev) => [...prev.filter((m) => m._id !== pendingId), ...res.messages]);
        if (res.plan && res.plan_changed) {
          setLastChange({ before: payload, preferenceCalls: res.preference_calls });
          setFromPayload(res.plan);
        } else if (res.plan_changed) await refresh();
      } catch (err) {
        if (isAborted(err)) {
          setMessages(prev => [...prev.map(m => m._id === pendingId ? { ...m, pending: false } : m), { _id: `stopped-${Date.now()}`, role: 'assistant', text: 'Stopped. Your calendar is unchanged. You can edit your message and try again.' }]);
          setDraft(value => value || body);
        } else {
          setMessages((prev) => prev.filter((m) => m._id !== pendingId));
          setError(err);
          setDraft(value => value || body);
        }
      } finally {
        setProgress(null);
        requestRef.current = null;
        setSending(false);
        inFlight.current = false;
      }
    },
    [context, refresh, payload, messages, setFromPayload],
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
      lastChange,
      undo: () => {
        if (lastChange && !sending) {
          setFromPayload(lastChange.before);
          setLastChange(null);
          setMessages(prev => [...prev, { _id: `undo-${Date.now()}`, role: 'assistant', text: 'Undid the last schedule changes.' }]);
        }
      },
      messages,
      draft,
      setDraft,
      sending,
      progress,
      cancel: () => requestRef.current?.abort(),
      error,
      context,
      openWith,
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
      send,
      sendDraft: () => {
        const text = draft;
        return send(text);
      },
    }),
    [open, messages, draft, sending, progress, error, context, openWith, send, lastChange, setFromPayload],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
