// The signed-in user's avatar and sign-out, in the hub header.

import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../state/AuthProvider.jsx';

export function UserMenu() {
  const { user, mode, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;
  const initials = (user.name ?? user.email).slice(0, 1).toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        aria-expanded={open}
        className="w-9 h-9 rounded-full overflow-hidden bg-emerald-700 text-white text-sm font-medium flex items-center justify-center hover:ring-2 hover:ring-emerald-500/50"
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initials
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-lg overflow-hidden z-40">
          <div className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-800">
            <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{user.name}</p>
            <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{user.email}</p>
          </div>
          {/* In demo mode the session route hands back the demo student
              regardless of cookies, so a "Sign out" here would clear a cookie
              and change nothing on the next load. Say what is true instead. */}
          {mode === 'demo' ? (
            <p className="px-3 py-2.5 text-xs text-stone-500 dark:text-stone-400">
              Demo mode — CMU sign-in isn&apos;t configured on this deployment.
            </p>
          ) : (
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
