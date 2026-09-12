// Auxiliary feature: pick a class, see a month-by-month unit/topic breakdown.
// Each topic's "Resources" action opens the chat sidebar seeded with that topic
// as context, so the backend never has to parse intent out of free text.
import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { coursesApi } from '../lib/api/index.js';
import { useRequest } from '../hooks/useRequest.js';
import { usePlan } from '../state/PlanProvider.jsx';
import { useChat } from '../state/ChatProvider.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';

export function ClassesPage() {
  const { plan } = usePlan();
  const { openWith } = useChat();
  const [activeCourseId, setActiveCourseId] = useState(plan.goals[0]?.id ?? null);

  const breakdown = useRequest((courseId, opts) => coursesApi.breakdown(courseId, opts));

  useEffect(() => {
    if (!activeCourseId && plan.goals[0]) setActiveCourseId(plan.goals[0].id);
  }, [activeCourseId, plan.goals]);

  useEffect(() => {
    if (activeCourseId) breakdown.run(activeCourseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCourseId]);

  if (!plan.goals.length) {
    return <p className="text-sm text-stone-400 dark:text-stone-500">No classes yet — finish setup to see this.</p>;
  }

  const units = breakdown.data?.unit_breakdown ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-stone-900 dark:text-stone-100">Classes</h2>
        <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">See what's ahead before you're cramming for it.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {plan.goals.map((goal) => (
          <button
            key={goal.id}
            type="button"
            onClick={() => setActiveCourseId(goal.id)}
            aria-pressed={goal.id === activeCourseId}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              goal.id === activeCourseId
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700 hover:border-emerald-600'
            }`}
          >
            {goal.title}
          </button>
        ))}
      </div>

      {breakdown.isLoading && (
        <div className="space-y-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-2.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {breakdown.isError && (
        <ErrorNotice
          error={breakdown.error}
          onRetry={() => breakdown.run(activeCourseId)}
          title="Couldn't load this class"
        />
      )}

      {breakdown.isSuccess && (
        <div className="space-y-4">
          {units.map((unit) => (
            <div key={`${unit.month}-${unit.label}`} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs font-medium text-stone-400 dark:text-stone-500">{unit.month}</span>
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{unit.label}</p>
              </div>
              <div className="space-y-1.5">
                {unit.topics.map((topic) => (
                  <div key={topic.name} className="flex items-center justify-between gap-2 py-1">
                    <p className="text-sm text-stone-600 dark:text-stone-300">{topic.name}</p>
                    <button
                      type="button"
                      onClick={() =>
                        openWith({
                          seed: `Find resources on "${topic.name}" for ${breakdown.data.course_name}`,
                          context: { course_id: activeCourseId, topic: topic.name },
                        })
                      }
                      className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 shrink-0"
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Resources
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
