// ---------------------------------------------------------------------------
// Plan state. Holds the last /plan payload plus the view model derived from it,
// and owns every mutation that goes back to the server. Components read the
// view model and call these actions; none of them touch the API directly.
//
// Every action is optimistic-then-reconciled: apply locally so the UI stays
// responsive, send the request, then take the server's document as truth. A
// failure rolls back and surfaces a message rather than leaving a lie on screen.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { planApi, sessionsApi } from '../lib/api/index.js';
import { toPlanView } from '../lib/adapters.js';
import { isAborted } from '../lib/errors.js';

const PlanContext = createContext(null);

const EMPTY = { courses: [], tasks: [], sessions: [], run: null };

export function PlanProvider({ children, initialPayload = null }) {
  const [payload, setPayload] = useState(initialPayload ?? EMPTY);
  const [status, setStatus] = useState(initialPayload ? 'success' : 'idle');
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus((s) => (s === 'success' ? 'refreshing' : 'loading'));
    setError(null);
    try {
      const next = await planApi.get({ signal: controller.signal });
      setPayload(next);
      setStatus('success');
      return next;
    } catch (err) {
      if (isAborted(err)) return null;
      setError(err);
      setStatus('error');
      return null;
    }
  }, []);

  const setFromPayload = useCallback((next) => {
    setPayload(next ?? EMPTY);
    setStatus('success');
    setError(null);
  }, []);

  /** Replace one session document in place, from a server response. */
  const mergeSession = useCallback((session) => {
    setPayload((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s._id === session._id ? session : s)),
    }));
  }, []);

  const toggleSessionComplete = useCallback(
    async (sessionId) => {
      const before = payload.sessions.find((s) => s._id === sessionId);
      if (!before) return;
      const next = !before.completed;

      setPayload((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s._id === sessionId ? { ...s, completed: next } : s)),
      }));
      setActionError(null);

      try {
        const res = await sessionsApi.patch(sessionId, { completed: next });
        mergeSession(res.session);
      } catch (err) {
        if (isAborted(err)) return;
        // Roll back rather than leave the checkbox lying.
        setPayload((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) => (s._id === sessionId ? before : s)),
        }));
        setActionError(err);
      }
    },
    [payload.sessions, mergeSession],
  );

  const nudgeSession = useCallback(
    async (sessionId) => {
      setActionError(null);
      try {
        const res = await sessionsApi.nudge(sessionId);
        mergeSession(res.session);
        return res;
      } catch (err) {
        if (!isAborted(err)) setActionError(err);
        return null;
      }
    },
    [mergeSession],
  );

  const plan = useMemo(() => toPlanView(payload), [payload]);

  const value = useMemo(
    () => ({
      plan,
      payload,
      status,
      error,
      actionError,
      clearActionError: () => setActionError(null),
      refresh,
      setFromPayload,
      toggleSessionComplete,
      nudgeSession,
    }),
    [plan, payload, status, error, actionError, refresh, setFromPayload, toggleSessionComplete, nudgeSession],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used inside <PlanProvider>');
  return ctx;
}
