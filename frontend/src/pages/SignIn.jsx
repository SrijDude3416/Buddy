// The front door. Two ways in — your own planner, or a sample week — and the
// one-paragraph version of what makes Buddy different: the week is solved by
// an optimizer, and you change it by talking rather than by dragging blocks.
import { ArrowRight, Play } from 'lucide-react';
import { useAuth } from '../state/AuthProvider.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { BuddyMark, BuddyStar, BuddyWordmark } from '../components/ui/Brand.jsx';

const STEPS = [
  {
    title: 'Tell Buddy how you work',
    body: 'Five quick questions — your classes, when you focus, how long you like to sit. No forms, no due-date fields.',
  },
  {
    title: 'The math places every session',
    body: 'A CP-SAT solver fits your study sessions around fixed class times and deadlines, and reports how close to optimal it got.',
  },
  {
    title: 'Change it by talking',
    body: '"Keep Friday nights free" becomes a typed preference the solver re-runs. Buddy translates; you decide.',
  },
];

export function SignIn() {
  const { signIn, enterDemo, authError } = useAuth();

  return (
    <div className="min-h-screen buddy-backdrop bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <BuddyMark className="w-8 h-8 text-base" />
          <span className="font-serif text-lg"><BuddyStar /></span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-3xl text-center">
          <p className="buddy-rise text-sm font-medium text-emerald-700 dark:text-emerald-400">
            A study planner for CMU students
          </p>
          <h1 className="buddy-rise buddy-rise-2 font-serif text-5xl sm:text-7xl tracking-tight mt-3 leading-tight">
            <BuddyWordmark />
          </h1>
          <p className="buddy-rise buddy-rise-3 mt-5 text-base sm:text-lg text-stone-600 dark:text-stone-300 max-w-xl mx-auto">
            Your classes, deadlines and habits turned into a real optimization problem, solved into a week you can
            keep — and changed just by talking to it.
          </p>

          <div className="buddy-rise buddy-rise-4 mt-9 grid gap-3 sm:grid-cols-2 max-w-xl mx-auto text-left">
            <div className="rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 p-4 shadow-sm shadow-stone-900/5">
              <button
                type="button"
                onClick={signIn}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
                Get started
              </button>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-3 leading-relaxed">
                Pick your classes from the CMU catalog. Your plan and preferences are saved.
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 p-4 shadow-sm shadow-stone-900/5">
              <button
                type="button"
                onClick={enterDemo}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:border-emerald-600 dark:hover:border-emerald-500 text-stone-900 dark:text-stone-100 font-medium transition-colors"
              >
                <Play className="w-4 h-4" />
                Demo
              </button>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-3 leading-relaxed">
                A sample semester with six classes, already solved. Nothing you do here is saved.
              </p>
            </div>
          </div>

          {authError && (
            <p className="mt-4 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 max-w-xl mx-auto">
              {authError}
            </p>
          )}

          <ol className="mt-14 grid gap-6 sm:grid-cols-3 text-left max-w-3xl mx-auto">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-serif text-sm flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{step.title}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </main>

      <footer className="px-6 pb-6 text-center text-xs text-stone-400 dark:text-stone-500">
        Placement by Google OR-Tools CP-SAT · Feedback interpreted by OpenAI · Every decision stays yours.
      </footer>
    </div>
  );
}
