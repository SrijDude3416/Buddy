// A task is an ordered list of sessions, each carrying a concrete action and its
// own intensity. Leads with why, not a due-date form: no priority dropdown, no
// date field. Rescheduling happens by talking to Buddy.
import { ArrowLeft, CheckCircle2, Circle, MessageCircle } from 'lucide-react';
import { INTENSITY_COLOR, INTENSITY_LABEL } from '../lib/constants.js';
import { usePlan } from '../state/PlanProvider.jsx';
import { useChat } from '../state/ChatProvider.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';

export function TaskDetail({ taskId, onBack }) {
  const { plan, toggleSessionComplete, actionError, clearActionError } = usePlan();
  const { openWith } = useChat();

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

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
        <ArrowLeft className="w-4 h-4" /> Back to today
      </button>

      <div>
        <span className="inline-block text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full mb-2">
          {task.courseTitle}
        </span>
        <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">{task.title}</h2>
        <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
          {task.sessions.length} session{task.sessions.length !== 1 ? 's' : ''} · Buddy picked what to do in each one
          {doneCount > 0 ? ` · ${doneCount} done` : ''}
        </p>
        <p className="text-stone-400 dark:text-stone-500 text-xs mt-1">Due {task.dueLabel}</p>
      </div>

      {actionError && <ErrorNotice error={actionError} onRetry={clearActionError} compact />}

      <div className="space-y-2">
        {task.sessions.map((session) => (
          <div key={session.id} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3 flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleSessionComplete(session.id)}
              className="mt-0.5 shrink-0"
              aria-label={session.completed ? 'Mark not done' : 'Mark done'}
            >
              {session.completed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle className="w-5 h-5 text-stone-300 dark:text-stone-600" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${session.completed ? 'text-stone-400 dark:text-stone-500 line-through' : 'text-stone-900 dark:text-stone-100'}`}>
                {session.action}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                {session.dayLabel} · {session.timeLabel} · {session.durationMin} min · {INTENSITY_LABEL[session.intensity]}
              </p>
            </div>
            <span
              className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${INTENSITY_COLOR[session.intensity]}`}
              title={INTENSITY_LABEL[session.intensity]}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          openWith({
            seed: `Can we adjust "${task.title}"?`,
            context: { task_id: task.id, course_id: task.courseId },
          })
        }
        className="w-full py-3 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 font-medium flex items-center justify-center gap-2 hover:border-emerald-600"
      >
        <MessageCircle className="w-4 h-4" /> Ask Buddy about this
      </button>
    </div>
  );
}
