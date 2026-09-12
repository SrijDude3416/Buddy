// Five questions, chat-bubble framing, every answer a choice — never free text.
// The class question is a dropdown over the shared course catalog; the rest are
// multiple choice. On the last answer the typed preference entries are POSTed and
// the run starts.
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { QUESTIONS, formatAnswer } from '../lib/onboarding.js';
import { coursesApi } from '../lib/api/index.js';
import { useRequest } from '../hooks/useRequest.js';
import { BotBubble, UserBubble } from '../components/chat/Bubbles.jsx';
import { CourseSelect } from '../components/ui/CourseSelect.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { ErrorNotice } from '../components/ui/ErrorNotice.jsx';

export function Onboarding({ onComplete, submitting, submitError, onRetry, initialAnswers = {} }) {
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState(initialAnswers);

  const catalog = useRequest((opts) => coursesApi.catalog(opts));
  useEffect(() => {
    catalog.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const courses = catalog.data?.courses ?? [];

  const question = QUESTIONS[qIndex];
  const answeredSoFar = QUESTIONS.slice(0, qIndex);

  function advance(current) {
    if (qIndex < QUESTIONS.length - 1) {
      setQIndex(qIndex + 1);
    } else {
      onComplete(current);
    }
  }

  function handleSingle(qid, value) {
    const updated = { ...answers, [qid]: value };
    setAnswers(updated);
    advance(updated);
  }

  function toggleValue(qid, value) {
    setAnswers((prev) => {
      const existing = prev[qid] ?? [];
      const next = existing.includes(value) ? existing.filter((v) => v !== value) : [...existing, value];
      return { ...prev, [qid]: next };
    });
  }

  function removeValue(qid, value) {
    setAnswers((prev) => ({ ...prev, [qid]: (prev[qid] ?? []).filter((v) => v !== value) }));
  }

  const selectedIds = answers.classes ?? [];

  return (
    <div className="space-y-4">
      <p className="font-serif text-lg text-stone-900 dark:text-stone-100 mb-1">Setting up Buddy</p>
      <div className="flex items-center gap-1.5 mb-4" aria-label={`Question ${qIndex + 1} of ${QUESTIONS.length}`}>
        {QUESTIONS.map((q, i) => (
          <span
            key={q.id}
            className={`h-1.5 rounded-full transition-all ${
              i <= qIndex ? 'bg-emerald-700 dark:bg-emerald-500 w-6' : 'bg-stone-200 dark:bg-stone-800 w-3'
            }`}
          />
        ))}
      </div>

      {answeredSoFar.map((q) => (
        <div key={q.id} className="space-y-2">
          <BotBubble text={q.prompt} />
          <UserBubble text={formatAnswer(answers[q.id], { courses })} />
        </div>
      ))}

      <div className="space-y-3">
        <BotBubble text={question.prompt} />

        {question.type === 'courses' ? (
          <div className="pl-9 space-y-3">
            {catalog.isError ? (
              <ErrorNotice error={catalog.error} onRetry={() => catalog.run()} title="Couldn't load the course catalog" />
            ) : (
              <CourseSelect
                courses={courses}
                selectedIds={selectedIds}
                onToggle={(id) => toggleValue('classes', id)}
                onRemove={(id) => removeValue('classes', id)}
                loading={catalog.isLoading}
                disabled={submitting}
              />
            )}
            <button
              type="button"
              onClick={() => advance(answers)}
              disabled={!selectedIds.length || submitting}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-40"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 pl-9">
              {question.options.map((opt) => {
                const isMulti = question.type === 'multi';
                const selected = isMulti ? (answers[question.id] ?? []).includes(opt) : answers[question.id] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={submitting}
                    onClick={() => (isMulti ? toggleValue(question.id, opt) : handleSingle(question.id, opt))}
                    aria-pressed={selected}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-50 ${
                      selected
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700 hover:border-emerald-600'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {question.type === 'multi' && (
              <div className="pl-9">
                <button
                  type="button"
                  onClick={() => advance(answers)}
                  disabled={!(answers[question.id] ?? []).length || submitting}
                  className="mt-1 flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-40"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {submitting && (
        <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400 pl-9">
          <Spinner className="w-4 h-4" />
          <span className="text-sm">Saving your answers</span>
        </div>
      )}

      {submitError && (
        <div className="pl-9">
          <ErrorNotice error={submitError} onRetry={onRetry} compact />
        </div>
      )}
    </div>
  );
}
