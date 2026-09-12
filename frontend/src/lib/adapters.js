// ---------------------------------------------------------------------------
// Schema documents -> view models.
//
// The API returns SCHEMA.md collections. The UI wants goals with progress bars,
// tasks with ordered sessions, and one chronological timeline mixing fixed and
// flexible time. Everything derived here is computed at read time — progress,
// days-to-deadline and the load strip are never stored (SCHEMA.md).
// ---------------------------------------------------------------------------

import { dayLabel, timeLabel, minutesIntoDay, dayOffset, relativeDeadline } from './time.js';
import { buildColorMap } from './courseColors.js';

function toSessionView(session, course, referenceDate) {
  return {
    id: session._id,
    taskId: session.task_id,
    courseId: session.course_id ?? null,
    courseTitle: course?.name ?? null,
    type: session.type,
    action: session.action,
    intensity: session.intensity,
    durationMin: session.duration_min,
    locked: session.locked,
    completed: session.completed,
    start: session.start,
    end: session.end,
    dayLabel: dayLabel(session.start, referenceDate),
    dayOffset: dayOffset(session.start, referenceDate),
    timeLabel: timeLabel(session.start),
    minutesIntoDay: minutesIntoDay(session.start),
  };
}

/**
 * @param {{courses: array, tasks: array, sessions: array, run: object|null}} payload
 */
export function toPlanView(payload) {
  const referenceDate = payload?.windowStart ? new Date(payload.windowStart) : new Date();
  const courses = payload?.courses ?? [];
  const rawTasks = payload?.tasks ?? [];
  const rawSessions = payload?.sessions ?? [];
  const courseById = new Map(courses.map((c) => [c._id, c]));

  const sessionViews = rawSessions.map((s) => toSessionView(s, courseById.get(s.course_id), referenceDate));

  // Fixed blocks: no task_id, immovable, same timeline as everything else.
  const fixedBlocks = sessionViews
    .filter((s) => s.type === 'fixed')
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const sessionsByTask = new Map();
  sessionViews
    .filter((s) => s.type === 'flexible' && s.taskId)
    .forEach((s) => {
      if (!sessionsByTask.has(s.taskId)) sessionsByTask.set(s.taskId, []);
      sessionsByTask.get(s.taskId).push(s);
    });

  const tasks = rawTasks.map((t) => {
    const sessions = (sessionsByTask.get(t._id) ?? []).sort((a, b) => new Date(a.start) - new Date(b.start));
    return {
      id: t._id,
      courseId: t.course_id,
      courseTitle: courseById.get(t.course_id)?.name ?? 'General',
      // display_title is generated once server-side so all three views agree.
      title: t.display_title || t.source_assignment,
      status: t.status,
      dueAt: t.due_at,
      dueLabel: relativeDeadline(t.due_at, referenceDate),
      priorityWeight: t.priority_weight,
      estDurationMin: t.est_duration_min,
      sessions: sessions.map((s, i) => ({ ...s, order: i + 1 })),
    };
  });

  // "Goal" is a course — no goals collection, just an aggregation.
  const goals = courses.map((course) => {
    const courseTasks = tasks.filter((t) => t.courseId === course._id);
    const courseSessions = courseTasks.flatMap((t) => t.sessions);
    const done = courseSessions.filter((s) => s.completed).length;
    const nextDue = courseTasks
      .map((t) => t.dueAt)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];

    return {
      id: course._id,
      title: course.name,
      code: course.code,
      progress: courseSessions.length ? Math.round((done / courseSessions.length) * 100) : 0,
      deadlineLabel: courseTasks[0]?.title ?? 'Coursework',
      daysAway: nextDue ? dayOffset(nextDue, referenceDate) : null,
      dueLabel: nextDue ? relativeDeadline(nextDue, referenceDate) : null,
    };
  });

  const flexibleSessions = tasks.flatMap((t) =>
    t.sessions.map((s) => ({ ...s, taskTitle: t.title, taskId: t.id })),
  );

  // One color per class, assigned from the course order so it is stable across
  // every view that renders it.
  const colorMap = buildColorMap(courses.map((c) => c._id));

  return {
    goals,
    tasks,
    fixedBlocks,
    flexibleSessions,
    colorMap,
    run: payload?.run ?? null,
    windowStart: payload?.windowStart,
    isEmpty: tasks.length === 0 && fixedBlocks.length === 0,
  };
}

/**
 * One chronologically-sorted timeline for a given day offset. Fixed and flexible
 * share the pool and are ordered by real time, not by type.
 */
export function timelineForDay(plan, offset = 0) {
  const items = [
    ...plan.fixedBlocks.filter((b) => b.dayOffset === offset).map((b) => ({ kind: 'fixed', item: b })),
    ...plan.flexibleSessions.filter((s) => s.dayOffset === offset).map((s) => ({ kind: 'session', item: s })),
  ];
  return items.sort((a, b) => a.item.minutesIntoDay - b.item.minutesIntoDay);
}

/**
 * Load per day for the week strip, split by kind. Keeping fixed and flexible
 * separate avoids the MVP's understatement of how locked-in a heavy class day
 * feels versus a heavy self-directed one.
 */
export function loadByDay(plan, days) {
  return days.map(({ offset, label }) => {
    const fixedMin = plan.fixedBlocks
      .filter((b) => b.dayOffset === offset)
      .reduce((sum, b) => sum + b.durationMin, 0);
    const flexibleMin = plan.flexibleSessions
      .filter((s) => s.dayOffset === offset)
      .reduce((sum, s) => sum + s.durationMin, 0);
    return { offset, label, fixedMin, flexibleMin, totalMin: fixedMin + flexibleMin };
  });
}

export function nextPendingSession(task) {
  return task.sessions.find((s) => !s.completed) ?? task.sessions[0] ?? null;
}

/** Every placed item for a day, fixed and flexible, as one list. */
export function itemsForDay(plan, offset) {
  return [
    ...plan.fixedBlocks.filter((b) => b.dayOffset === offset),
    ...plan.flexibleSessions.filter((s) => s.dayOffset === offset),
  ].sort((a, b) => a.minutesIntoDay - b.minutesIntoDay);
}

/**
 * The hour range the calendar needs to show: tight enough to be readable, wide
 * enough that nothing placed falls outside it.
 */
export function visibleHourRange(plan, offsets, { min = 8, max = 22 } = {}) {
  const items = offsets.flatMap((offset) => itemsForDay(plan, offset));
  if (!items.length) return { startHour: min, endHour: max };
  const earliest = Math.min(...items.map((i) => Math.floor(i.minutesIntoDay / 60)));
  const latest = Math.max(...items.map((i) => Math.ceil((i.minutesIntoDay + i.durationMin) / 60)));
  return { startHour: Math.min(min, earliest), endHour: Math.max(max, latest) };
}

/**
 * Lay out a day's items into side-by-side columns so overlapping blocks stay
 * readable instead of covering each other. Sessions never overlap by
 * construction today, but a locked block plus a re-solve can produce one, and a
 * calendar that hides a conflict is worse than one that shows it.
 */
export function assignLanes(items) {
  const lanes = [];
  const placed = items.map((item) => {
    const start = item.minutesIntoDay;
    const end = start + item.durationMin;
    let lane = lanes.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(end);
    } else {
      lanes[lane] = end;
    }
    return { item, lane };
  });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

/** Sessions grouped by the goal (course) they serve — rows are goals, not days. */
export function sessionsByGoalForDay(plan, offset) {
  return plan.goals.map((goal) => {
    const sessions = plan.flexibleSessions
      .filter((s) => s.courseId === goal.id && s.dayOffset === offset)
      .sort((a, b) => a.minutesIntoDay - b.minutesIntoDay);
    const fixed = plan.fixedBlocks
      .filter((b) => b.courseId === goal.id && b.dayOffset === offset)
      .sort((a, b) => a.minutesIntoDay - b.minutesIntoDay);
    return {
      goal,
      sessions,
      fixed,
      totalMin: [...sessions, ...fixed].reduce((sum, s) => sum + s.durationMin, 0),
      doneCount: sessions.filter((s) => s.completed).length,
    };
  });
}
