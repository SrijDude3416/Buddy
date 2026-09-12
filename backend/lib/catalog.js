// ---------------------------------------------------------------------------
// The shared course catalog. This is seed data for the `courses` and
// `syllabus_data` collections — shared/static, identical for every user, and
// replaced wholesale by the Canvas pipeline's output when that lands.
// ---------------------------------------------------------------------------

const mt = (type, days, start, end, location) => ({
  type,
  days,
  start_time: start,
  end_time: end,
  location,
});

export const COURSE_CATALOG = [
  {
    _id: 'course_15122', code: '15-122', section: 'A', name: 'Principles of Imperative Computation',
    term: 'F25', canvas_course_id: 'canvas_15122', department: 'Computer Science', units: 12,
    meeting_times: [mt('lecture', [1, 3], '10:00', '10:50', 'GHC 4401'), mt('recitation', [5], '10:00', '10:50', 'GHC 5222')],
  },
  {
    _id: 'course_15150', code: '15-150', section: 'A', name: 'Functional Programming',
    term: 'F25', canvas_course_id: 'canvas_15150', department: 'Computer Science', units: 10,
    meeting_times: [mt('lecture', [2, 4], '09:30', '10:50', 'DH 2210'), mt('recitation', [5], '13:00', '13:50', 'GHC 4102')],
  },
  {
    _id: 'course_15213', code: '15-213', section: 'B', name: 'Computer Systems',
    term: 'F25', canvas_course_id: 'canvas_15213', department: 'Computer Science', units: 12,
    meeting_times: [mt('lecture', [1, 3], '13:00', '14:20', 'RMCH MCCONOMY'), mt('recitation', [5], '11:00', '11:50', 'WEH 5304')],
  },
  {
    _id: 'course_15445', code: '15-445', section: 'A', name: 'Database Systems',
    term: 'F25', canvas_course_id: 'canvas_15445', department: 'Computer Science', units: 12,
    meeting_times: [mt('lecture', [2, 4], '15:30', '16:50', 'GHC 4401')],
  },
  {
    _id: 'course_10301', code: '10-301', section: 'A', name: 'Introduction to Machine Learning',
    term: 'F25', canvas_course_id: 'canvas_10301', department: 'Machine Learning', units: 12,
    meeting_times: [mt('lecture', [1, 3], '11:00', '12:20', 'POS 152'), mt('recitation', [5], '15:00', '15:50', 'GHC 4211')],
  },
  {
    _id: 'course_21259', code: '21-259', section: 'C', name: 'Calculus in Three Dimensions',
    term: 'F25', canvas_course_id: 'canvas_21259', department: 'Mathematics', units: 9,
    meeting_times: [mt('lecture', [1, 2, 3, 4], '09:00', '09:50', 'WEH 7500')],
  },
  {
    _id: 'course_21241', code: '21-241', section: 'A', name: 'Matrices and Linear Transformations',
    term: 'F25', canvas_course_id: 'canvas_21241', department: 'Mathematics', units: 10,
    meeting_times: [mt('lecture', [1, 3, 5], '12:00', '12:50', 'WEH 7500')],
  },
  {
    _id: 'course_09217', code: '09-217', section: 'A', name: 'Organic Chemistry I',
    term: 'F25', canvas_course_id: 'canvas_09217', department: 'Chemistry', units: 9,
    meeting_times: [mt('lecture', [1, 3, 5], '14:30', '15:20', 'DH 2210'), mt('lab', [4], '13:30', '17:20', 'DH 3000')],
  },
  {
    _id: 'course_03121', code: '03-121', section: 'A', name: 'Modern Biology',
    term: 'F25', canvas_course_id: 'canvas_03121', department: 'Biological Sciences', units: 9,
    meeting_times: [mt('lecture', [2, 4], '11:00', '12:20', 'MI 348')],
  },
  {
    _id: 'course_33121', code: '33-121', section: 'A', name: 'Physics I for Science Students',
    term: 'F25', canvas_course_id: 'canvas_33121', department: 'Physics', units: 12,
    meeting_times: [mt('lecture', [1, 3], '10:00', '11:20', 'DH A302'), mt('recitation', [2], '09:00', '09:50', 'DH 1112')],
  },
  {
    _id: 'course_85102', code: '85-102', section: 'A', name: 'Introduction to Psychology',
    term: 'F25', canvas_course_id: 'canvas_85102', department: 'Psychology', units: 9,
    meeting_times: [mt('lecture', [2, 4], '13:30', '14:50', 'BH A51')],
  },
  {
    _id: 'course_76101', code: '76-101', section: 'K', name: 'Interpretation and Argument',
    term: 'F25', canvas_course_id: 'canvas_76101', department: 'English', units: 9,
    meeting_times: [mt('lecture', [2, 4], '16:30', '17:50', 'BH 235A')],
  },
  {
    _id: 'course_70122', code: '70-122', section: 'A', name: 'Introduction to Accounting',
    term: 'F25', canvas_course_id: 'canvas_70122', department: 'Business', units: 9,
    meeting_times: [mt('lecture', [1, 3], '08:00', '09:20', 'TEP 2118')],
  },
  {
    _id: 'course_18100', code: '18-100', section: 'A', name: 'Introduction to Electrical Engineering',
    term: 'F25', canvas_course_id: 'canvas_18100', department: 'Electrical Engineering', units: 12,
    meeting_times: [mt('lecture', [2, 4], '10:00', '11:20', 'HH B103'), mt('lab', [5], '14:00', '16:50', 'HH 1305')],
  },
  {
    _id: 'course_51171', code: '51-171', section: 'A', name: 'Design Fundamentals',
    term: 'F25', canvas_course_id: 'canvas_51171', department: 'Design', units: 10,
    meeting_times: [mt('lecture', [1, 4], '15:00', '17:50', 'MM 303')],
  },
  {
    _id: 'course_82191', code: '82-191', section: 'A', name: 'Elementary Japanese I',
    term: 'F25', canvas_course_id: 'canvas_82191', department: 'Modern Languages', units: 12,
    meeting_times: [mt('lecture', [1, 2, 3, 4], '12:30', '13:20', 'POS 145')],
  },
];

/** Each assignment type a course seeds a task from, kept per-department-ish. */
export const ASSIGNMENT_KINDS = {
  'Computer Science': ['Programming assignment', 'Written homework', 'Midterm'],
  'Machine Learning': ['Homework', 'Written homework', 'Midterm'],
  Mathematics: ['Problem set', 'Quiz', 'Midterm'],
  Chemistry: ['Problem set', 'Lab report', 'Midterm'],
  'Biological Sciences': ['Reading quiz', 'Problem set', 'Midterm'],
  Physics: ['Problem set', 'Lab report', 'Midterm'],
  Psychology: ['Reading response', 'Quiz', 'Midterm'],
  English: ['Essay draft', 'Peer review', 'Final essay'],
  Business: ['Problem set', 'Case write-up', 'Midterm'],
  'Electrical Engineering': ['Lab prep', 'Problem set', 'Midterm'],
  Design: ['Studio project', 'Critique prep', 'Portfolio review'],
  'Modern Languages': ['Vocabulary quiz', 'Writing practice', 'Oral exam'],
};

export function assignmentKindsFor(department) {
  return ASSIGNMENT_KINDS[department] ?? ['Problem set', 'Quiz', 'Midterm'];
}
