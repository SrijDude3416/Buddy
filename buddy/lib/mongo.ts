// ---------------------------------------------------------------------------
// The class-catalog Atlas connection.
//
// This is a *different* cluster from the one backend/lib/mongo.js and
// backend/optimizer/mongo_loader.py share (MONGODB_URI/MONGODB_DB). It holds one
// collection, `schedule`, with one document per class. Its variables are prefixed
// so the two can never be confused for each other, and it gets its own client and
// its own globalThis key so neither cluster's connection state can leak into the
// other's.
//
// One MongoClient per process, cached across hot reloads and warm invocations —
// creating a client per request exhausts a free-tier connection limit almost
// immediately. A *failed* connect clears the cache so the next request retries
// instead of being stuck behind a dead promise.
// ---------------------------------------------------------------------------

import { MongoClient, type Collection } from 'mongodb';

/** Weekday abbreviations, matching the optimizer's Weekday literal exactly. */
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/** One lecture or recitation section a student can be enrolled in. */
export type Section = {
  id: string; // stable within a course; what the picker sends back
  kind: 'lecture' | 'recitation';
  section: string; // the catalog's subcategory letter, e.g. "A"
  days: Weekday[];
  start_time: string | null; // "09:00", 24-hour; null when the catalog says TBA
  end_time: string | null;
  location: string | null;
  instructors: string | null;
  /** False for a TBA section: real, enrollable, but impossible to put on a calendar. */
  scheduled: boolean;
};

/** One `schedule` document, as far as this app is concerned. */
export type ScheduleClass = {
  course_id: string;
  course_title: string;
  department: string | null;
  units: string | null;
  lecture: Section[];
  recitation: Section[];
};

// The catalog writes weekdays as one letter each; U is Sunday and R is Thursday,
// which is why this can't be a naive first-letter match. Verified against all
// 2,496 sections in the collection: no other character appears.
const DAY_LETTERS: Record<string, Weekday> = {
  U: 'Sun', M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat',
};

/**
 * "MWF" -> ["Mon","Wed","Fri"]. "TBA" and anything unrecognized -> [].
 *
 * A single stray character rejects the whole string rather than contributing the
 * letters it does recognize: "TBA" would otherwise read as Tuesday, which is how a
 * class with no announced time ends up drawn on the calendar on the wrong day. Not
 * placing a class is recoverable; placing it wrongly is not.
 */
export function parseDays(days: unknown): Weekday[] {
  if (typeof days !== 'string') return [];
  const out: Weekday[] = [];
  for (const ch of days.trim().toUpperCase()) {
    const day = DAY_LETTERS[ch];
    if (!day) return [];
    if (!out.includes(day)) out.push(day);
  }
  return out;
}

/** "01:00PM" -> "13:00". Returns null for "" or anything off-pattern. */
export function parseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/**
 * Titles arrive as "Modern Biology (MODERN BIOLOGY)" — the parenthetical is the
 * registrar's abbreviated name, noise in a picker. Dropped only when it is
 * genuinely a shouted abbreviation, so a real parenthetical ("Physics (Honors)")
 * survives untouched.
 */
export function cleanTitle(title: string): string {
  const trimmed = title.trim();
  const stripped = trimmed.replace(/\s*\([^a-z)]*\)$/, '').trim();
  return stripped || trimmed;
}

function toSection(raw: Record<string, unknown>, kind: Section['kind'], index: number): Section {
  const days = parseDays(raw.days);
  const start = parseTime(raw.begin_time);
  const end = parseTime(raw.end_time);
  const room = [raw.building, raw.room].filter(v => typeof v === 'string' && v && v !== 'TBA' && v !== 'DNM');
  const label = typeof raw.subcategory === 'string' && raw.subcategory.trim() ? raw.subcategory.trim() : String(index + 1);
  return {
    id: `${kind}-${label}`,
    kind,
    section: label,
    days,
    start_time: start,
    end_time: end,
    location: room.length ? room.join(' ') : null,
    instructors: typeof raw.instructors === 'string' && raw.instructors.trim() ? raw.instructors.trim() : null,
    scheduled: Boolean(days.length && start && end),
  };
}

/**
 * Sections of one kind, with exact repeats collapsed. The OCR pipeline that
 * produced this collection sometimes emits the same row twice (two courses in
 * 794 do this), which would otherwise show the student a choice between two
 * identical options.
 */
/**
 * Doha sections. The catalog covers every CMU campus, but this app is a
 * Pittsburgh timetable: a Qatar section's Sun–Thu week and its own academic
 * calendar describe a different student's semester, and offering it in the
 * picker alongside the Pittsburgh sections of the same course is a way to
 * silently build the wrong schedule. Matched on both fields the catalog uses,
 * since `location` alone is occasionally blank.
 */
function isOtherCampus(raw: Record<string, unknown>): boolean {
  const location = typeof raw.location === 'string' ? raw.location.trim().toUpperCase() : '';
  const calendar = typeof raw.calendar === 'string' ? raw.calendar : '';
  return location === 'DOH' || /qatar/i.test(calendar);
}

/** The units string off the first section that states one, e.g. "9 units". */
function unitsOf(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const s of raw) {
    const units = (s as Record<string, unknown>)?.units;
    if (typeof units === 'string' && units.trim()) return units.trim();
  }
  return null;
}

function toSections(raw: unknown, kind: Section['kind']): Section[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Section[] = [];
  raw.forEach((doc, i) => {
    if (!doc || typeof doc !== 'object') return;
    if (isOtherCampus(doc as Record<string, unknown>)) return;
    const section = toSection(doc as Record<string, unknown>, kind, i);
    const key = `${section.section}|${section.days.join('')}|${section.start_time}|${section.end_time}|${section.location}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(section);
  });
  return out;
}

const CLIENT_KEY = '__buddyScheduleMongoClientPromise';
const globalForMongo = globalThis as typeof globalThis & {
  [CLIENT_KEY]?: Promise<MongoClient>;
};

export function isScheduleConfigured(): boolean {
  return Boolean(process.env.SCHEDULE_MONGODB_URI && process.env.SCHEDULE_MONGODB_DB);
}

function getClient(): Promise<MongoClient> {
  if (!globalForMongo[CLIENT_KEY]) {
    const uri = process.env.SCHEDULE_MONGODB_URI;
    if (!uri) {
      return Promise.reject(new Error('SCHEDULE_MONGODB_URI is not set'));
    }
    globalForMongo[CLIENT_KEY] = new MongoClient(uri, {
      // Keep the pool small: many concurrent invocations each holding a big pool
      // is how a free-tier cluster runs out of connections.
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8000,
    })
      .connect()
      .catch((err) => {
        // Don't cache a failed connection.
        globalForMongo[CLIENT_KEY] = undefined;
        throw err;
      });
  }
  return globalForMongo[CLIENT_KEY];
}

async function scheduleCollection(): Promise<Collection> {
  const dbName = process.env.SCHEDULE_MONGODB_DB;
  if (!dbName) throw new Error('SCHEDULE_MONGODB_DB is not set');
  const client = await getClient();
  return client.db(dbName).collection(process.env.SCHEDULE_MONGODB_COLLECTION || 'schedule');
}

/**
 * `schedule` documents -> classes, deduplicated by course_id and sorted by it.
 *
 * The dedupe is insurance rather than a known need: the picker keys its list on
 * course_id, so a repeated id would mean two React children with the same key and
 * one class silently unselectable. Documents missing either field are skipped —
 * a class with no id can't be sent to the optimizer and one with no title can't
 * be read by a human. Pure, so it can be tested without a cluster.
 */
export function normalizeScheduleDocs(docs: Record<string, unknown>[]): ScheduleClass[] {
  const byId = new Map<string, ScheduleClass>();
  for (const doc of docs) {
    const rawId = doc.course_id;
    const courseId = (typeof rawId === 'string' ? rawId : rawId == null ? '' : String(rawId)).trim();
    const courseTitle = typeof doc.course_title === 'string' ? doc.course_title.trim() : '';
    if (!courseId || !courseTitle) continue;
    const lecture = toSections(doc.lecture, 'lecture');
    const recitation = toSections(doc.recitation, 'recitation');
    const next: ScheduleClass = {
      course_id: courseId,
      course_title: cleanTitle(courseTitle),
      department: typeof doc.department === 'string' && doc.department.trim() ? doc.department.trim() : null,
      // Units are a property of the section in this catalog, not of the course.
      // Every section of a course carries the same value, so the first one speaks
      // for all of them.
      units: unitsOf(doc.lecture) ?? unitsOf(doc.recitation),
      lecture,
      recitation,
    };
    // A course_id can span several documents — the source pipeline emits one file
    // per cross-listing, and the copies carry identical sections. Keep whichever
    // copy describes the most sections rather than blindly the first, so a thinner
    // duplicate can never hide a section the student needs to pick.
    const seen = byId.get(courseId);
    if (seen && seen.lecture.length + seen.recitation.length >= next.lecture.length + next.recitation.length) continue;
    byId.set(courseId, next);
  }
  return [...byId.values()].sort((a, b) => a.course_id.localeCompare(b.course_id));
}

/** The section a student picked, as the optimizer's meeting-time shape. */
export function toMeetingTime(section: Section) {
  return {
    days: section.days,
    start_time: section.start_time as string,
    end_time: section.end_time as string,
    location: section.location,
  };
}

/**
 * A class onto the catalog contract in frontend/src/lib/endpoints.js, plus the
 * section lists the picker needs. `meeting_times` stays empty on purpose: which
 * times this course actually contributes depends on the section the student
 * picks, and that hasn't happened yet at catalog time.
 */
export function toCatalogEntry(cls: ScheduleClass) {
  return {
    _id: cls.course_id, // the id that travels on to the optimizer as course_ids
    code: cls.course_id,
    name: cls.course_title,
    section: null,
    term: null,
    department: cls.department,
    units: cls.units,
    meeting_times: [],
    lecture: cls.lecture,
    recitation: cls.recitation,
  };
}

/** Every class in `schedule`. Throws if the cluster isn't configured or reachable. */
export async function listScheduleClasses(): Promise<ScheduleClass[]> {
  const collection = await scheduleCollection();
  const docs = await collection
    .find({}, { projection: { _id: 0, course_id: 1, course_title: 1, department: 1, lecture: 1, recitation: 1 } })
    .toArray();
  return normalizeScheduleDocs(docs);
}
