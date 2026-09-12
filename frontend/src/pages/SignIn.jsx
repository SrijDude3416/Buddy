import { ArrowRight } from 'lucide-react';
import { useAuth } from '../state/AuthProvider.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';

export function SignIn() {
  const { signIn, enterDemo } = useAuth();

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
            Your semester, worked out. Open your study planner or explore a demo week.
          </p>
        </div>

        <button
          type="button"
          onClick={signIn}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg bg-emerald-700 enabled:hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          Get started
        </button>

        <button type="button" onClick={enterDemo} className="w-full py-3 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-900 font-medium">Demo</button>
        <p className="text-xs text-stone-400 dark:text-stone-500 text-center">
          Get started with your planner, or try Demo with sample classes and tasks.
        </p>
      </div>
    </div>
  );
}
