// ---------------------------------------------------------------------------
// Onboarding: exactly 5 questions, every answer multiple-choice or dropdown,
// never free text (CLAUDE.md). Each option maps to typed preference entries
// from the catalog — that mapping is the whole "language -> math" translation
// at its simplest, and it lives here so it is inspectable rather than implied.
// ---------------------------------------------------------------------------

import { slotOf } from './preferenceCatalog.js';

export const QUESTIONS = [
  {
    // Sourced from the shared course catalog (GET /courses), not a hardcoded list,
    // so a pick carries the real course id, code and meeting_times forward.
    id: 'classes',
    prompt: 'Which classes are you taking this semester?',
    type: 'courses',
  },
  {
    id: 'focus',
    prompt: 'When are you usually most focused?',
    type: 'single',
    options: ['Early morning', 'Midday', 'Evening', 'Late night'],
  },
  {
    id: 'commitment',
    prompt: 'Do you have regular commitments outside class?',
    type: 'single',
    options: ['None', 'Part-time job', 'Research or lab', 'Clubs & orgs'],
  },
  {
    id: 'style',
    prompt: 'How do you like to work?',
    type: 'single',
    options: ['Short bursts (25-30 min)', 'Standard blocks (~1 hr)', 'Deep long sessions (2+ hrs)'],
  },
  {
    id: 'pressure',
    prompt: "What's weighing on you most right now?",
    type: 'single',
    options: ['An upcoming exam', 'A big project', 'Staying caught up day-to-day', 'Getting back on track'],
  },
];

/** Peak-focus window per answer, as [startHour, endHour]. */
export const FOCUS_WINDOW = {
  'Early morning': [7, 11],
  Midday: [11, 15],
  Evening: [17, 21],
  'Late night': [21, 24],
};

/** Blocks the user is unavailable, per outside-commitment answer. */
export const COMMITMENT_BLOCK = {
  None: null,
  'Part-time job': [16, 20],
  'Research or lab': [13, 17],
  'Clubs & orgs': [18, 20],
};

export const SESSION_MINUTES = {
  'Short bursts (25-30 min)': 30,
  'Standard blocks (~1 hr)': 60,
  'Deep long sessions (2+ hrs)': 120,
};

/**
 * The translation step. Onboarding answers in, typed preference objects out.
 * This is what gets POSTed to /preferences — the raw answers are never stored
 * anywhere else (SCHEMA.md: preferences entries with source "onboarding" already
 * are the durable record).
 */
export function preferencesFromOnboarding(answers) {
  const entries = [];

  const window = FOCUS_WINDOW[answers.focus] ?? FOCUS_WINDOW.Midday;
  entries.push({
    type: 'preferred_hours',
    value: { start_slot: slotOf(window[0]), end_slot: slotOf(window[1]) },
    weight: 1.0,
    source: 'onboarding',
  });

  const block = COMMITMENT_BLOCK[answers.commitment];
  if (block) {
    entries.push({
      type: 'avoid_block',
      value: { start_slot: slotOf(block[0]), end_slot: slotOf(block[1]), hard: false },
      weight: 0.8,
      source: 'onboarding',
    });
  }

  entries.push({
    type: 'session_length',
    value: { minutes: SESSION_MINUTES[answers.style] ?? 60 },
    weight: 1.0,
    source: 'onboarding',
  });

  return entries;
}

/**
 * `pressure` shapes the framing and the concrete actions of the first task
 * rather than a constraint, so it rides along as run metadata instead of
 * becoming a preference entry. Keeping it out of `preferences` keeps that
 * collection strictly optimizer input.
 *
 * `course_ids` are catalog ids — the backend resolves them into `enrollments`
 * and materializes fixed blocks from each course's `meeting_times`.
 */
export function runContextFromOnboarding(answers) {
  return {
    course_ids: answers.classes ?? [],
    pressure: answers.pressure ?? 'Staying caught up day-to-day',
  };
}

export function formatAnswer(answer, { courses = [] } = {}) {
  if (!Array.isArray(answer)) return answer;
  // The classes answer holds catalog ids; show codes, not raw ids.
  return answer
    .map((value) => {
      const course = courses.find((c) => c._id === value);
      return course ? `${course.code} ${course.name}` : value;
    })
    .join(', ');
}
