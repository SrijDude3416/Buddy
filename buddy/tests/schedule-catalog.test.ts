import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScheduleDocs, toCatalogEntry, isScheduleConfigured, parseDays, parseTime, cleanTitle, toMeetingTime } from '../lib/mongo';

const lec = (over: Record<string, unknown> = {}) => ({
  subcategory: 'A', sect_type: 'L', days: 'MWF', begin_time: '09:00AM', end_time: '09:50AM',
  building: 'GHC', room: '4401', instructors: 'Wisniewski, B (bwisniew)', ...over,
});

test('schedule documents become a deduplicated, sorted class list', () => {
  const classes = normalizeScheduleDocs([
    { course_id: '21241', course_title: 'Matrices and Linear Transformations' },
    { course_id: '15122', course_title: 'Principles of Imperative Computation' },
    { course_id: '21241', course_title: 'Matrices (duplicate row)' },
  ]);
  assert.deepEqual(classes.map(c => c.course_id), ['15122', '21241']);
  assert.equal(classes[1].course_title, 'Matrices and Linear Transformations');
});

test('a duplicate course_id keeps whichever copy describes the most sections', () => {
  // The source pipeline emits one file per cross-listing; a thinner copy must not
  // hide sections the student has to choose between.
  const [cls] = normalizeScheduleDocs([
    { course_id: '03121', course_title: 'Modern Biology', lecture: [lec()] },
    { course_id: '03121', course_title: 'Modern Biology', lecture: [lec(), lec({ subcategory: 'B', begin_time: '02:00PM', end_time: '02:50PM' })] },
  ]);
  assert.equal(cls.lecture.length, 2);
});

test('documents that cannot be picked or read are skipped, not rendered blank', () => {
  const classes = normalizeScheduleDocs([
    { course_title: 'No id at all' },
    { course_id: '15150' },
    { course_id: '   ', course_title: 'Blank id' },
    { course_id: '15213', course_title: '   ' },
    { course_id: '  15151  ', course_title: '  Math Foundations  ' },
    { course_id: 15251, course_title: 'Numeric id' },
  ] as Record<string, unknown>[]);
  assert.deepEqual(classes.map(c => c.course_id), ['15151', '15251']);
});

test('day letters map to weekdays, with U as Sunday and R as Thursday', () => {
  assert.deepEqual(parseDays('MWF'), ['Mon', 'Wed', 'Fri']);
  assert.deepEqual(parseDays('TR'), ['Tue', 'Thu']);
  assert.deepEqual(parseDays('UTR'), ['Sun', 'Tue', 'Thu']); // Qatar campus week
  assert.deepEqual(parseDays('MTWRF'), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual(parseDays('TBA'), []); // no schedulable day survives
  assert.deepEqual(parseDays(undefined), []);
});

test('12-hour catalog times become 24-hour, including both noon and midnight', () => {
  assert.equal(parseTime('09:00AM'), '09:00');
  assert.equal(parseTime('01:00PM'), '13:00');
  assert.equal(parseTime('12:00PM'), '12:00'); // noon is 12, not 24
  assert.equal(parseTime('12:30AM'), '00:30'); // midnight is 00, not 12
  assert.equal(parseTime('11:59PM'), '23:59');
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('TBA'), null);
});

test('a shouted registrar abbreviation is dropped but a real parenthetical is kept', () => {
  assert.equal(cleanTitle('Modern Biology (MODERN BIOLOGY)'), 'Modern Biology');
  assert.equal(cleanTitle('Spatial Concepts (SPTL CNCP NON-ARCTSI)'), 'Spatial Concepts');
  assert.equal(cleanTitle('Physics (Honors)'), 'Physics (Honors)');
  assert.equal(cleanTitle('(ALL CAPS ONLY)'), '(ALL CAPS ONLY)'); // never empty the title
});

test('sections parse into pickable options, and TBA ones are marked unschedulable', () => {
  const [cls] = normalizeScheduleDocs([{
    course_id: '03121', course_title: 'Modern Biology (MODERN BIOLOGY)', department: 'Biological Sciences',
    lecture: [lec(), lec({ subcategory: 'B', days: 'TR', begin_time: '02:00PM', end_time: '03:20PM' })],
    recitation: [lec({ subcategory: 'Z', days: 'TBA', begin_time: '', end_time: '', building: 'DNM', room: 'DNM' })],
  }]);
  assert.equal(cls.course_title, 'Modern Biology');
  assert.deepEqual(cls.lecture.map(s => s.id), ['lecture-A', 'lecture-B']);
  assert.deepEqual(cls.lecture[1].days, ['Tue', 'Thu']);
  assert.equal(cls.lecture[1].start_time, '14:00');
  assert.equal(cls.lecture[0].location, 'GHC 4401');
  assert.equal(cls.lecture[0].scheduled, true);
  // Real and enrollable, but it can never be drawn on a calendar.
  assert.equal(cls.recitation[0].scheduled, false);
  assert.equal(cls.recitation[0].location, null); // DNM is a placeholder, not a room
});

test('repeated identical section rows collapse into one option', () => {
  // Two courses in the collection carry the same row twice; a student must not be
  // shown a choice between two identical sections.
  const [cls] = normalizeScheduleDocs([{ course_id: '76494', course_title: 'Healthcare Communications', lecture: [lec(), lec()] }]);
  assert.equal(cls.lecture.length, 1);
});

test('Doha sections are left out, so a Pittsburgh picker never offers a Qatar week', () => {
  const [cls] = normalizeScheduleDocs([{
    course_id: '03121', course_title: 'Modern Biology',
    lecture: [
      lec({ location: 'PIT', calendar: 'Pgh Fall Full F26' }),
      lec({ subcategory: 'W', days: 'UTR', begin_time: '11:30AM', end_time: '12:20PM', location: 'DOH', calendar: 'Qatar Fall Full F26' }),
      // Blank location, so the calendar string is the only thing identifying it.
      lec({ subcategory: 'X', days: 'UT', begin_time: '08:00AM', end_time: '08:50AM', location: '', calendar: 'Qatar Fall Full F26' }),
    ],
  }]);
  assert.deepEqual(cls.lecture.map(s => s.section), ['A']);
});

test('a chosen section converts to the optimizer meeting-time shape', () => {
  const [cls] = normalizeScheduleDocs([{ course_id: '15122', course_title: 'Imperative Computation', lecture: [lec()] }]);
  assert.deepEqual(toMeetingTime(cls.lecture[0]), {
    days: ['Mon', 'Wed', 'Fri'], start_time: '09:00', end_time: '09:50', location: 'GHC 4401',
  });
});

test('a class maps onto the catalog contract the picker expects', () => {
  const [cls] = normalizeScheduleDocs([{
    course_id: '15122', course_title: 'Principles of Imperative Computation',
    // Units live on the section in this catalog, never on the course document.
    department: 'Computer Science', lecture: [lec({ units: '12 units' })],
  }]);
  const entry = toCatalogEntry(cls);
  // _id is what POST /api/preferences forwards to the optimizer as course_ids.
  assert.equal(entry._id, '15122');
  assert.equal(entry.code, '15122');
  assert.equal(entry.name, 'Principles of Imperative Computation');
  assert.equal(entry.department, 'Computer Science');
  assert.equal(entry.units, '12 units');
  assert.equal(entry.lecture.length, 1);
  // Empty on purpose: which times this course contributes depends on the pick.
  assert.deepEqual(entry.meeting_times, []);
});

test('the cluster counts as configured only when both URI and database are set', () => {
  const original = { uri: process.env.SCHEDULE_MONGODB_URI, db: process.env.SCHEDULE_MONGODB_DB };
  try {
    delete process.env.SCHEDULE_MONGODB_URI; delete process.env.SCHEDULE_MONGODB_DB;
    assert.equal(isScheduleConfigured(), false);
    process.env.SCHEDULE_MONGODB_URI = 'mongodb+srv://example';
    assert.equal(isScheduleConfigured(), false, 'a URI with no database is not configured');
    process.env.SCHEDULE_MONGODB_DB = 'buddy';
    assert.equal(isScheduleConfigured(), true);
  } finally {
    if (original.uri === undefined) delete process.env.SCHEDULE_MONGODB_URI; else process.env.SCHEDULE_MONGODB_URI = original.uri;
    if (original.db === undefined) delete process.env.SCHEDULE_MONGODB_DB; else process.env.SCHEDULE_MONGODB_DB = original.db;
  }
});
