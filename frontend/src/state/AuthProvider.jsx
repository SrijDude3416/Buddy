// Restores the selected live/demo experience; no authentication is required.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../lib/api/index.js';
import { isAborted } from '../lib/errors.js';

const AuthContext = createContext(null);

/** Pull ?auth_error / ?signed_in off the URL, then clean it out of the history. */
function consumeAuthParams() {
  if (typeof window === 'undefined') return { error: null, justSignedIn: false };
  const params = new URLSearchParams(window.location.search);
  const error = params.get('auth_error');
  const justSignedIn = params.get('signed_in') === '1';
  if (error || justSignedIn) {
    params.delete('auth_error');
    params.delete('signed_in');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }
  return { error, justSignedIn };
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | signedIn | signedOut | error
  const [user, setUser] = useState(null);
  // 'oauth' | 'demo' | 'unconfigured' — what the server says it can actually do.
  // Defaults to 'oauth' so a backend that doesn't report it behaves as before.
  const [mode, setMode] = useState('oauth');
  const [error, setError] = useState(null);
  // A message from the OAuth round trip, e.g. a non-CMU account being refused.
  const [authError, setAuthError] = useState(() => consumeAuthParams().error);

  const check = useCallback(async () => {
    setError(null);
    try {
      const { user: nextUser, auth_mode: nextMode } = await authApi.session();
      setUser(nextUser);
      if (nextMode) setMode(nextMode);
      setStatus(nextUser ? 'signedIn' : 'signedOut');
    } catch (err) {
      if (isAborted(err)) return;
      // Can't reach the API at all — distinct from "signed out", and worth saying
      // so rather than showing a sign-in button that won't work either.
      setError(err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const enter = useCallback((nextMode) => {
    document.cookie = `buddy_mode=${nextMode}; Path=/; SameSite=Lax`;
    document.cookie = 'buddy_demo=; Path=/; Max-Age=0; SameSite=Lax';
    setUser({ id: nextMode, name: nextMode === 'demo' ? 'Demo student' : 'Your planner', email: '' });
    setMode(nextMode);
    setStatus('signedIn');
  }, []);
  const signIn = useCallback(() => enter('live'), [enter]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the request fails, drop local state — staying "signed in" after
      // the user asked to leave is the worse failure.
    }
    document.cookie = 'buddy_demo=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'buddy_mode=; Path=/; Max-Age=0; SameSite=Lax';
    setUser(null);
    setStatus('signedOut');
    await check();
  }, [check]);

  const value = useMemo(
    () => ({
      status,
      user,
      mode,
      error,
      authError,
      clearAuthError: () => setAuthError(null),
      isLoading: status === 'loading',
      isSignedIn: status === 'signedIn',
      enterDemo: () => enter('demo'),
      signIn,
      signOut,
      refresh: check,
    }),
    [status, user, mode, error, authError, signIn, signOut, check, enter],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
