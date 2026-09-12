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
import { SectionPicker } from '../components/ui/SectionPicker.jsx';
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
  const catalogSource = catalog.data?.source;

  // Pre-selected classes come from the server and may predate the current catalog —
  // an id that isn't in it reads as "6 classes selected" with no chips to remove.
  // Drop those once the catalog resolves so the count and the chips always agree.
  useEffect(() => {
    if (!catalog.isSuccess) return;
    const ids = new Set(courses.map((c) => c._id));
    setAnswers((prev) => {
      const selected = prev.classes ?? [];
      const kept = selected.filter((id) => ids.has(id));
      return kept.length === selected.length ? prev : { ...prev, classes: kept };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.isSuccess, courses]);

  const selectedIds = answers.classes ?? [];
  const selectedCourses = selectedIds.map((id) => courses.find((c) => c._id === id)).filter(Boolean);

  // A course offering exactly one lecture (or one recitation) isn't a choice, but
  // the plan still needs to know it's the one — resolve those silently so the user
  // only ever sees the sections that genuinely fork.
  useEffect(() => {
    if (!selectedCourses.length) return;
    setAnswers((prev) => {
      const sections = { ...(prev.sections ?? {}) };
      let changed = false;
      for (const course of selectedCourses) {
        const current = sections[course._id] ?? {};
        const next = { ...current };
        for (const kind of ['lecture', 'recitation']) {
          const options = course[kind] ?? [];
          const stillValid = options.some((s) => s.id === current[kind]);
          if (options.length === 1) {
            if (next[kind] !== options[0].id) { next[kind] = options[0].id; changed = true; }
          } else if (current[kind] && !stillValid) {
            delete next[kind]; changed = true;
          }
        }
        if (changed) sections[course._id] = next;
      }
      // Drop section choices for classes no longer selected.
      for (const id of Object.keys(sections)) {
        if (!selectedIds.includes(id)) { delete sections[id]; changed = true; }
      }
      return changed ? { ...prev, sections } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, selectedIds.join(',')]);

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

  function selectSection(courseId, kind, sectionId) {
    setAnswers((prev) => ({
      ...prev,
      sections: { ...(prev.sections ?? {}), [courseId]: { ...(prev.sections?.[courseId] ?? {}), [kind]: sectionId } },
    }));
  }

  // Every fork the student hasn't resolved yet. Continue waits on these: a plan
  // built from the wrong lecture is worse than one that made you pick.
  const unresolved = selectedCourses.filter((course) =>
    ['lecture', 'recitation'].some(
      (kind) => (course[kind] ?? []).length > 1 && !answers.sections?.[course._id]?.[kind],
    ),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 mb-1">
        <p className="font-serif text-2xl tracking-tight text-stone-900 dark:text-stone-100">Setting up Buddy</p>
        <p className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">Question {qIndex + 1} of {QUESTIONS.length}</p>
      </div>
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
              <>
                <CourseSelect
                  courses={courses}
                  selectedIds={selectedIds}
                  onToggle={(id) => toggleValue('classes', id)}
                  onRemove={(id) => removeValue('classes', id)}
                  loading={catalog.isLoading}
                  disabled={submitting}
                />
                {/* The catalog has a live source; say so when it isn't the real one. */}
                {catalogSource && catalogSource !== 'mongodb' && (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Showing the built-in class list — the Atlas course catalog isn&apos;t reachable.
                  </p>
                )}
                <SectionPicker
                  courses={selectedCourses}
                  selections={answers.sections ?? {}}
                  onSelect={selectSection}
                  disabled={submitting}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => advance(answers)}
              disabled={!selectedIds.length || unresolved.length > 0 || submitting}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-40"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
            {unresolved.length > 0 && (
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Pick a section for {unresolved.map((c) => c.code).join(', ')} to continue.
              </p>
            )}
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
                    className={`px-3.5 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-50 shadow-sm shadow-stone-900/5 ${
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
