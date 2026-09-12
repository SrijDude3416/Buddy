// A task is an ordered list of sessions, each carrying a concrete action and its
// own intensity. Leads with why, not a due-date form: no priority dropdown, no
// date field. Rescheduling happens by talking to Buddy.
import { ArrowLeft, CheckCircle2, Circle, MessageCircle } from 'lucide-react';
import { INTENSITY_COLOR, INTENSITY_LABEL } from '../lib/constants.js';
import { colorFor } from '../lib/courseColors.js';
import { hasEnded } from '../lib/time.js';
import { useNow } from '../hooks/useNow.js';
import { usePlan } from '../state/PlanProvider.jsx';
import { useChat } from '../state/ChatProvider.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';

export function TaskDetail({ taskId, onBack }) {
  const { plan, toggleSessionComplete, actionError, clearActionError } = usePlan();
  const { openWith } = useChat();
  const now = useNow();

  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
          <ArrowLeft className="w-4 h-4" /> Back to today
        </button>
        <p className="text-sm text-stone-400 dark:text-stone-500">That task is no longer in this week's plan.</p>
      </div>
    );
  }

  const doneCount = task.sessions.filter((s) => s.completed).length;
  const totalMin = task.sessions.reduce((sum, s) => sum + s.durationMin, 0);
  // The same color this task's class carries on the calendar and in the key.
  const color = colorFor(plan.colorMap, task.courseId);

  return (
    <div className="space-y-5 max-w-3xl buddy-rise">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
        <ArrowLeft className="w-4 h-4" /> Back to today
      </button>

      <div className={`rounded-2xl border px-5 py-4 ${color.tint} ${color.border}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />
          <span className={`text-xs font-medium ${color.subtext}`}>{task.courseTitle}</span>
        </div>
        <h2 className={`font-serif text-2xl tracking-tight ${color.text}`}>{task.title}</h2>
        <p className={`text-sm mt-1.5 ${color.subtext}`}>
          Due {task.dueLabel} · {task.sessions.length} session{task.sessions.length !== 1 ? 's' : ''}
          {totalMin ? ` · ${Math.round((totalMin / 60) * 10) / 10}h total` : ''}
          {doneCount > 0 ? ` · ${doneCount} done` : ''}
        </p>
        <p className={`text-xs mt-1 opacity-80 ${color.subtext}`}>
          Buddy split this into sessions and picked what to do in each one. Check one off when it's done.
        </p>
      </div>

      {actionError && <ErrorNotice error={actionError} onRetry={clearActionError} compact />}

      <ol className="space-y-2">
        {task.sessions.map((session, i) => {
          // A session crosses out on its own once its scheduled time has
          // passed -- the calendar slot already happened whether or not the
          // student ever tapped the checkbox. `completed` itself still drives
          // the icon (that's the real, stored, user-controlled "did I do
          // this" signal); `isPast` only changes how an unchecked-but-past
          // session reads, the same distinction CalendarView's blocks make.
          const isPast = !session.completed && hasEnded(session.end, now);
          const crossedOut = session.completed || isPast;
          return (
            <li key={session.id} className="bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm shadow-stone-900/5">
              <button
                type="button"
                onClick={() => toggleSessionComplete(session.id)}
                className="mt-0.5 shrink-0"
                aria-label={session.completed ? 'Mark not done' : 'Mark done'}
              >
                {session.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className={`w-5 h-5 ${isPast ? 'text-stone-200 dark:text-stone-700' : 'text-stone-300 dark:text-stone-600'}`} />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${crossedOut ? 'text-stone-400 dark:text-stone-500 line-through' : 'text-stone-900 dark:text-stone-100'}`}>
                  <span className="text-stone-400 dark:text-stone-500 tabular-nums mr-1.5">{i + 1}.</span>
                  {session.action}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  {session.dayLabel} · {session.timeLabel} · {session.durationMin} min · {INTENSITY_LABEL[session.intensity]}
                  {isPast ? ' · already passed' : ''}
                </p>
              </div>
              <span
                className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${INTENSITY_COLOR[session.intensity]}`}
                title={INTENSITY_LABEL[session.intensity]}
              />
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() =>
          openWith({
            seed: `Can we adjust "${task.title}"?`,
            context: { task_id: task.id, course_id: task.courseId },
          })
        }
        className="w-full py-3 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 font-medium flex items-center justify-center gap-2 hover:border-emerald-600 dark:hover:border-emerald-500 transition-colors"
      >
        <MessageCircle className="w-4 h-4" /> Ask Buddy about this
      </button>
    </div>
  );
}
