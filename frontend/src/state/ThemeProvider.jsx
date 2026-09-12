// ---------------------------------------------------------------------------
// Theme: light / dark / system.
//
// "system" is a real third state, not a default that silently becomes light — it
// follows prefers-color-scheme and keeps following it when the OS flips. An
// explicit choice is stored and wins until cleared.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'buddy.theme';

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Private windows and blocked site data both throw here.
    return 'system';
  }
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Keep following the OS while the preference is "system".
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [resolved]);

  const choose = useCallback((next) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is a convenience here — the in-memory preference still applies.
    }
  }, []);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      isDark: resolved === 'dark',
      choose,
      toggle: () => choose(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [preference, resolved, choose],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
