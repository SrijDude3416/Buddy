// Flat cards, one per task's next session, with a thumbs-down that nudges only
// that session.
import { ThumbsDown } from 'lucide-react';
import { INTENSITY_COLOR } from '../../lib/constants.js';
import { nextPendingSession } from '../../lib/adapters.js';
import { Spinner } from '../ui/Spinner.jsx';

export function SessionList({ plan, onNudge, nudgingId }) {
  if (!plan.tasks.length) {
    return <p className="text-sm text-stone-400 dark:text-stone-500 text-center py-8">No work scheduled yet.</p>;
  }

  return (
    <div className="space-y-2">
      {plan.tasks.map((task, i) => {
        const session = nextPendingSession(task);
        if (!session) return null;
        return (
          <div
            key={task.id}
            className="animate-floatIn bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${INTENSITY_COLOR[session.intensity]}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{session.action}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {task.courseTitle} · {session.dayLabel} · {session.timeLabel} · {session.durationMin} min
              </p>
            </div>
            {onNudge && (
              <button
                type="button"
                onClick={() => onNudge(session.id)}
                disabled={nudgingId === session.id}
                aria-label={`Nudge "${session.action}"`}
                className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 p-1 disabled:opacity-50"
              >
                {nudgingId === session.id ? <Spinner className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
