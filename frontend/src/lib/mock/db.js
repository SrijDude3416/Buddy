// ---------------------------------------------------------------------------
// In-memory stand-in for MongoDB. One module-level object, collection names and
// document shapes matching SCHEMA.md exactly, so the mock handlers read and
// write the same documents the real API routes will.
//
// Not persisted on purpose: a reload should replay onboarding, which is the flow
// most worth exercising while the backend is still being built.
// ---------------------------------------------------------------------------

export const db = {
  user: { _id: 'user_demo', name: 'Demo student', term: 'F25' },
  courses: [],
  syllabus_data: [],
  tasks: [],
  sessions: [],
  preferences: [],
  chat_messages: [],
  optimizer_runs: [],
};

let seq = 0;
export const nextId = (prefix) => `${prefix}_${(++seq).toString(36).padStart(4, '0')}`;

export function resetDb() {
  db.courses = [];
  db.syllabus_data = [];
  db.tasks = [];
  db.sessions = [];
  db.preferences = [];
  db.chat_messages = [];
  db.optimizer_runs = [];
}

export function latestRun() {
  return db.optimizer_runs[db.optimizer_runs.length - 1] ?? null;
}
