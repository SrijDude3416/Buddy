// The sign-in screen. One button, because there is one way in: a CMU Andrew
// account. Andrew accounts are Google Workspace, so this is CMU's own directory
// doing the authenticating — the app never sees or stores a password.

import { LogIn, AlertTriangle } from 'lucide-react';
import { useAuth } from '../state/AuthProvider.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { isMock } from '../lib/config.js';

export function SignIn() {
  const { signIn, mode, authError, clearAuthError } = useAuth();
  // The server told us it has no Google credentials. Showing "Continue with CMU"
  // here would just bounce the person back with an error — say so instead.
  const unconfigured = mode === 'unconfigured';

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white font-serif text-2xl flex items-center justify-center mx-auto">
            B
          </div>
          <h1 className="font-serif text-3xl text-stone-900 dark:text-stone-100">Buddy</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Your semester, worked out. Sign in with your CMU account to get started.
          </p>
        </div>

        {authError && (
          <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-amber-900 dark:text-amber-200">{authError}</p>
              <button
                type="button"
                onClick={clearAuthError}
                className="text-xs font-medium text-amber-900 dark:text-amber-200 underline mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={signIn}
          disabled={unconfigured}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg bg-emerald-700 enabled:hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          <LogIn className="w-4 h-4" />
          {isMock() ? 'Continue as a demo student' : 'Continue with CMU'}
        </button>

        <p className="text-xs text-stone-400 dark:text-stone-500 text-center">
          {unconfigured
            ? 'Sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET, or BUDDY_ALLOW_DEMO=1 to run the no-login demo.'
            : isMock()
              ? 'Running on dummy data — no account needed. Set VITE_API_MODE=live for real CMU sign-in.'
              : 'Restricted to andrew.cmu.edu accounts. Buddy never sees your password.'}
        </p>
      </div>
    </div>
  );
}
