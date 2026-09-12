import React, { useState } from 'react';
import {
  ChevronRight, ArrowLeft, ThumbsDown, Send, Target,
  Lock, MessageCircle, X, BookOpen, Circle, CheckCircle2
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data & personalization logic (stands in for the backend)
// ---------------------------------------------------------------------------

const QUESTIONS = [
  { id: 'classes', prompt: 'Which classes are you taking this semester?', type: 'multi',
    options: ['ML Systems', 'Organic Chemistry', 'Calc III', 'Intro to Psych', 'Data Structures'] },
  { id: 'focus', prompt: 'When are you usually most focused?', type: 'single',
    options: ['Early morning', 'Midday', 'Evening', 'Late night'] },
  { id: 'commitment', prompt: 'Do you have regular commitments outside class?', type: 'single',
    options: ['None', 'Part-time job', 'Research or lab', 'Clubs & orgs'] },
  { id: 'style', prompt: 'How do you like to work?', type: 'single',
    options: ['Short bursts (25-30 min)', 'Standard blocks (~1 hr)', 'Deep long sessions (2+ hrs)'] },
  { id: 'pressure', prompt: "What's weighing on you most right now?", type: 'single',
    options: ['An upcoming exam', 'A big project', 'Staying caught up day-to-day', 'Getting back on track'] }
];

const DAYS = ['Today', 'Tomorrow', 'Wed', 'Thu', 'Fri'];

const TIME_BY_FOCUS = {
  'Early morning': ['8:00 AM', '9:15 AM', '10:30 AM'],
  Midday: ['12:00 PM', '1:15 PM', '2:30 PM'],
  Evening: ['5:30 PM', '6:45 PM', '8:00 PM'],
  'Late night': ['9:30 PM', '10:45 PM', '11:30 PM']
};

const LECTURE_TIMES = ['9:00 AM', '11:00 AM', '1:00 PM'];

const DURATION_BY_STYLE = {
  'Short bursts (25-30 min)': 25,
  'Standard blocks (~1 hr)': 55,
  'Deep long sessions (2+ hrs)': 120
};

const PRESSURE_SESSIONS = {
  'An upcoming exam': [
    'Skim lecture notes and flag confusing topics',
    'Work through 10 practice problems from the study guide',
    'Timed practice test under exam conditions'
  ],
  'A big project': ['Outline sections and requirements', 'Draft the core section', 'Polish, proofread, and submit'],
  'Staying caught up day-to-day': ["Review this week's readings", 'Clear any missing homework', 'Quick recap before next class'],
  'Getting back on track': ['List everything currently overdue', 'Tackle the single most urgent item', "Check in on what's left"]
};

const GENERIC_SESSIONS = ['Work through the problem set', 'Review and check your answers'];

const OPENER_BY_PRESSURE = {
  'An upcoming exam': 'Exam prep',
  'A big project': 'Project work',
  'Staying caught up day-to-day': 'Weekly catch-up',
  'Getting back on track': 'Reset & triage'
};

const CLASS_MONTHS = [
  { month: 'Sep', unit: 'Unit 1: Foundations', topics: ['Syllabus & tools', 'Core definitions', 'Problem-solving basics'] },
  { month: 'Oct', unit: 'Unit 2: Core methods', topics: ['Key technique', 'Applied examples', 'Midterm review'] },
  { month: 'Nov', unit: 'Unit 3: Advanced topics', topics: ['Extensions', 'Case studies', 'Project checkpoint'] },
  { month: 'Dec', unit: 'Unit 4: Synthesis', topics: ['Cumulative review', 'Final prep', 'Wrap-up'] }
];

const INTENSITY_COLOR = { high: 'bg-amber-500', medium: 'bg-emerald-500', low: 'bg-stone-400' };
const INTENSITY_HEX = { high: '#F59E0B', medium: '#10B981', low: '#A8A29E' };
const FIXED_HEX = '#57534E';

function timeToMinutes(t) {
  const [time, ampm] = t.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function shiftTime(time) {
  const alt = {
    '8:00 AM': '9:00 AM', '9:15 AM': '10:00 AM',
    '12:00 PM': '1:00 PM', '1:15 PM': '2:00 PM',
    '5:30 PM': '6:30 PM', '6:45 PM': '7:30 PM',
    '9:30 PM': '10:15 PM'
  };
  return alt[time] || time;
}

function formatAnswer(a) {
  return Array.isArray(a) ? a.join(', ') : a;
}

function getTodayItems(tasks, fixedBlocks) {
  const todayFixed = fixedBlocks
    .filter((b) => b.day === 'Today')
    .map((b) => ({ kind: 'fixed', time: b.time, block: b }));
  const todaySessions = [];
  tasks.forEach((t) => {
    t.sessions.forEach((s) => {
      if (s.day === 'Today') todaySessions.push({ kind: 'session', time: s.time, task: t, session: s });
    });
  });
  return [...todayFixed, ...todaySessions].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

function buildPlan(answers) {
  const classes = answers.classes && answers.classes.length ? answers.classes : ['Coursework'];
  const times = TIME_BY_FOCUS[answers.focus] || TIME_BY_FOCUS.Midday;
  const duration = DURATION_BY_STYLE[answers.style] || 55;
  const pressure = answers.pressure || 'Staying caught up day-to-day';
  const opener = OPENER_BY_PRESSURE[pressure];

  const goals = [];
  const tasks = [];
  const fixedBlocks = [];
  const classTimelines = [];

  classes.slice(0, 3).forEach((c, i) => {
    const goalId = `goal-${i}`;
    goals.push({
      id: goalId,
      title: c,
      progress: [35, 60, 20][i % 3],
      deadlineLabel: ['Quiz', 'Problem set', 'Midterm'][i % 3],
      daysAway: [3, 6, 14][i % 3]
    });

    fixedBlocks.push({
      id: `fixed-${i}`,
      goalId,
      goalTitle: c,
      title: `${c} lecture`,
      day: i === 0 ? 'Today' : DAYS[(i + 1) % DAYS.length],
      time: LECTURE_TIMES[i % LECTURE_TIMES.length],
      duration: 50,
      locked: true
    });

    const actions = i === 0 ? PRESSURE_SESSIONS[pressure] : GENERIC_SESSIONS;
    const sessions = actions.map((action, s) => ({
      id: `${goalId}-t-s${s}`,
      order: s + 1,
      action,
      day: DAYS[(i + s) % DAYS.length],
      time: times[s % times.length],
      duration,
      intensity: ['high', 'medium', 'low'][(i + s) % 3],
      done: false
    }));

    tasks.push({
      id: `task-${i}`,
      goalId,
      goalTitle: c,
      title: i === 0 ? `${opener}: ${c}` : `${c} homework`,
      sessions
    });

    classTimelines.push({ goalId, goalTitle: c, months: CLASS_MONTHS });
  });

  return { goals, tasks, fixedBlocks, classTimelines };
}

function nextPendingSession(task) {
  return task.sessions.find((s) => !s.done) || task.sessions[0];
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function BotBubble({ text }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">B</div>
      <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%]">{text}</div>
    </div>
  );
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="bg-emerald-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%]">{text}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 1: onboarding
// ---------------------------------------------------------------------------

function Onboarding({ qIndex, answers, onSingleSelect, onMultiToggle, onMultiContinue }) {
  const question = QUESTIONS[qIndex];
  const answeredSoFar = QUESTIONS.slice(0, qIndex);

  return (
    <div className="space-y-4">
      <p className="font-serif text-lg text-stone-900 mb-1">Setting up Buddy</p>
      <div className="flex items-center gap-1.5 mb-4">
        {QUESTIONS.map((q, i) => (
          <span key={q.id} className={`h-1.5 rounded-full transition-all ${i <= qIndex ? 'bg-emerald-700 w-6' : 'bg-stone-200 w-3'}`} />
        ))}
      </div>

      {answeredSoFar.map((q) => (
        <div key={q.id} className="space-y-2">
          <BotBubble text={q.prompt} />
          <UserBubble text={formatAnswer(answers[q.id])} />
        </div>
      ))}

      <div className="space-y-3">
        <BotBubble text={question.prompt} />
        <div className="flex flex-wrap gap-2 pl-9">
          {question.options.map((opt) => {
            const isMulti = question.type === 'multi';
            const selected = isMulti ? (answers[question.id] || []).includes(opt) : answers[question.id] === opt;
            return (
              <button
                key={opt}
                onClick={() => (isMulti ? onMultiToggle(question.id, opt) : onSingleSelect(question.id, opt))}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selected ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-stone-700 border-stone-300 hover:border-emerald-600'
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
              onClick={onMultiContinue}
              disabled={!(answers[question.id] || []).length}
              className="mt-1 flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-40"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: first look — radial day / goal swimlanes / list, same plan
// ---------------------------------------------------------------------------

function RadialDayView({ items }) {
  const DAY_START = 360; // 6:00 AM in minutes
  const SPAN = 1080; // 6am to midnight
  const r = 90;
  const circumference = 2 * Math.PI * r;

  function frac(minutes) {
    return Math.min(1, Math.max(0, (minutes - DAY_START) / SPAN));
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <svg viewBox="0 0 240 240" width="220" height="220">
        <circle cx="120" cy="120" r={r} fill="none" stroke="#E7E5E4" strokeWidth="18" />
        {items.map((item, i) => {
          const start = timeToMinutes(item.time);
          const duration = item.kind === 'fixed' ? item.block.duration : item.session.duration;
          const startFrac = frac(start);
          const lenFrac = Math.max(0, Math.min(1 - startFrac, duration / SPAN));
          const color = item.kind === 'fixed' ? FIXED_HEX : INTENSITY_HEX[item.session.intensity];
          return (
            <circle
              key={i}
              cx="120"
              cy="120"
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="18"
              strokeDasharray={`${lenFrac * circumference} ${circumference}`}
              strokeDashoffset={-startFrac * circumference}
              transform="rotate(-90 120 120)"
            />
          );
        })}
      </svg>
      <div className="flex items-center gap-4 text-xs text-stone-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-stone-600 inline-block" />Fixed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />High focus</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Lighter</span>
      </div>
    </div>
  );
}

function GoalSwimlanes({ goals, tasks, fixedBlocks }) {
  return (
    <div className="space-y-4">
      {goals.map((g) => {
        const goalSessions = tasks
          .filter((t) => t.goalId === g.id)
          .flatMap((t) => t.sessions);
        const goalFixed = fixedBlocks.filter((b) => b.goalId === g.id);
        return (
          <div key={g.id}>
            <p className="text-sm font-medium text-stone-700 mb-1.5">{g.title}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {DAYS.map((day) => {
                const dayFixed = goalFixed.filter((b) => b.day === day);
                const daySessions = goalSessions.filter((s) => s.day === day);
                return (
                  <div key={day} className="bg-stone-50 border border-stone-200 rounded-lg p-1.5 min-h-10 flex flex-col gap-1">
                    {dayFixed.map((b) => (
                      <div key={b.id} className="flex items-center gap-1 bg-stone-700 rounded px-1.5 py-0.5">
                        <Lock className="w-2.5 h-2.5 text-stone-300 shrink-0" />
                        <span className="text-xs text-stone-100 truncate">{b.title}</span>
                      </div>
                    ))}
                    {daySessions.map((s) => (
                      <div key={s.id} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${INTENSITY_COLOR[s.intensity]}`} />
                        <span className="text-xs text-stone-600 truncate">{s.action}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-5 gap-1.5 px-0.5">
        {DAYS.map((d) => (
          <span key={d} className="text-xs text-stone-400 text-center">{d}</span>
        ))}
      </div>
    </div>
  );
}

function FirstLook({ plan, log, feedback, setFeedback, onSend, onRegenerate, onContinue }) {
  const [view, setView] = useState('radial'); // radial | goals | list
  const todayItems = getTodayItems(plan.tasks, plan.fixedBlocks);

  return (
    <div className="space-y-5">
      <style>{`
        @keyframes floatIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .session-enter { animation: floatIn 0.45s ease-out both; }
      `}</style>

      <div>
        <h2 className="font-serif text-2xl text-stone-900">Here's a first look</h2>
        <p className="text-stone-500 text-sm mt-1">Same plan, three ways to see it. Tell Buddy what to change below.</p>
      </div>

      <div className="flex items-center gap-1 bg-stone-200 rounded-lg p-1 w-fit">
        {[['radial', 'Radial'], ['goals', 'Goals'], ['list', 'List']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'radial' && <RadialDayView items={todayItems} />}
      {view === 'goals' && <GoalSwimlanes goals={plan.goals} tasks={plan.tasks} fixedBlocks={plan.fixedBlocks} />}
      {view === 'list' && (
        <div className="space-y-2">
          {plan.tasks.map((t, i) => {
            const s = nextPendingSession(t);
            return (
              <div
                key={`${t.id}::${s.time}::${s.duration}`}
                className="session-enter bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-3"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${INTENSITY_COLOR[s.intensity]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">{s.action}</p>
                  <p className="text-xs text-stone-500">{t.goalTitle} · {s.day} · {s.time} · {s.duration} min</p>
                </div>
                <button onClick={() => onRegenerate(t.id, s.id)} className="text-stone-400 hover:text-stone-600 p-1">
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-stone-200 pt-4 space-y-2">
        {log.map((m, i) => (
          <div key={i} className={m.from === 'user' ? 'text-right' : ''}>
            <span className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${m.from === 'user' ? 'bg-emerald-700 text-white' : 'bg-stone-200 text-stone-700'}`}>
              {m.text}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            placeholder="e.g. move chem earlier in the day"
            className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button onClick={onSend} className="p-2 rounded-lg bg-stone-900 text-white">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      <button onClick={onContinue} className="w-full py-3 rounded-lg bg-emerald-700 text-white font-medium">
        Looks good — build my week
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main hub: header (tabs + chat toggle)
// ---------------------------------------------------------------------------

function MainHeader({ page, setPage, onToggleChat }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-1 bg-stone-200 rounded-lg p-1">
        {['plan', 'classes'].map((p) => {
          const active = page === p || (p === 'plan' && page === 'task');
          return (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                active ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      <button onClick={onToggleChat} className="p-2 rounded-lg bg-white border border-stone-200 text-stone-600 hover:border-emerald-600">
        <MessageCircle className="w-5 h-5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan page — short-term detail + long-term relative placement
// ---------------------------------------------------------------------------

function PlanPage({ tasks, fixedBlocks, goals, onOpenTask }) {
  const todayItems = getTodayItems(tasks, fixedBlocks);

  const weekCounts = DAYS.map((day) => {
    const fixedCount = fixedBlocks.filter((b) => b.day === day).length;
    const sessionCount = tasks.reduce((sum, t) => sum + t.sessions.filter((s) => s.day === day).length, 0);
    return fixedCount + sessionCount;
  });

  const sortedGoals = [...goals].sort((a, b) => a.daysAway - b.daysAway);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-stone-900">Today</h2>
        <p className="text-stone-500 text-sm mt-1">{todayItems.length} thing{todayItems.length !== 1 ? 's' : ''} on the books</p>
      </div>

      <div className="space-y-2">
        {todayItems.map((item, i) =>
          item.kind === 'fixed' ? (
            <div key={`fixed-${i}`} className="bg-stone-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <Lock className="w-4 h-4 text-stone-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100 truncate">{item.block.title}</p>
                <p className="text-xs text-stone-400">{item.block.time} · {item.block.duration} min · can't be moved</p>
              </div>
            </div>
          ) : (
            <button
              key={`session-${i}`}
              onClick={() => onOpenTask(item.task.id)}
              className="w-full text-left bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-emerald-600 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${INTENSITY_COLOR[item.session.intensity]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-900 truncate">{item.session.action}</p>
                <p className="text-xs text-stone-500">{item.task.goalTitle} · {item.session.time} · {item.session.duration} min</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-400" />
            </button>
          )
        )}
        {todayItems.length === 0 && (
          <p className="text-sm text-stone-400 bg-white border border-dashed border-stone-300 rounded-xl px-4 py-6 text-center">
            Nothing on the books today.
          </p>
        )}
      </div>

      <div className="border-t border-stone-200 pt-5">
        <p className="text-sm font-medium text-stone-700 mb-3">This week</p>
        <div className="flex gap-2">
          {DAYS.map((day, i) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`w-full h-8 rounded-lg ${
                  weekCounts[i] === 0 ? 'bg-stone-100' : weekCounts[i] <= 2 ? 'bg-emerald-200' : 'bg-amber-300'
                }`}
              />
              <span className="text-xs text-stone-500">{day}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-stone-200 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-stone-500" />
          <h3 className="font-serif text-lg text-stone-900">Coming up</h3>
        </div>
        <div className="space-y-3">
          {sortedGoals.map((g) => (
            <div key={g.id} className="bg-white border border-stone-200 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-stone-900">{g.title}</p>
                <span className="text-xs text-stone-500">
                  {g.deadlineLabel} in {g.daysAway} day{g.daysAway !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${g.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classes page — auxiliary unit/topic breakdown
// ---------------------------------------------------------------------------

function ClassesPage({ classTimelines, onAskResources }) {
  const [activeGoalId, setActiveGoalId] = useState(classTimelines[0]?.goalId);
  const active = classTimelines.find((c) => c.goalId === activeGoalId) || classTimelines[0];

  if (!active) {
    return <p className="text-sm text-stone-400">No classes yet — finish setup to see this.</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-stone-900">Classes</h2>
        <p className="text-stone-500 text-sm mt-1">See what's ahead before you're cramming for it.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {classTimelines.map((c) => (
          <button
            key={c.goalId}
            onClick={() => setActiveGoalId(c.goalId)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              c.goalId === active.goalId ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-stone-700 border-stone-300'
            }`}
          >
            {c.goalTitle}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {active.months.map((m) => (
          <div key={m.month} className="bg-white border border-stone-200 rounded-xl px-4 py-3">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xs font-medium text-stone-400">{m.month}</span>
              <p className="text-sm font-medium text-stone-900">{m.unit}</p>
            </div>
            <div className="space-y-1.5">
              {m.topics.map((topic) => (
                <div key={topic} className="flex items-center justify-between gap-2 py-1">
                  <p className="text-sm text-stone-600">{topic}</p>
                  <button
                    onClick={() => onAskResources(active.goalTitle, topic)}
                    className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 shrink-0"
                  >
                    <BookOpen className="w-3.5 h-3.5" /> Resources
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task detail — multi-session, no due-date form
// ---------------------------------------------------------------------------

function TaskDetail({ task, goal, onToggleSession, onBack, onAskBuddy }) {
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700">
        <ArrowLeft className="w-4 h-4" /> Back to today
      </button>

      <div>
        <span className="inline-block text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full mb-2">
          {goal ? goal.title : 'General'}
        </span>
        <h2 className="font-serif text-2xl text-stone-900">{task.title}</h2>
        <p className="text-stone-500 text-sm mt-1">{task.sessions.length} sessions · Buddy picked what to do in each one</p>
      </div>

      <div className="space-y-2">
        {task.sessions.map((s) => (
          <div key={s.id} className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <button onClick={() => onToggleSession(s.id)} className="mt-0.5 shrink-0">
              {s.done ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Circle className="w-5 h-5 text-stone-300" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${s.done ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{s.action}</p>
              <p className="text-xs text-stone-500 mt-0.5">{s.day} · {s.time} · {s.duration} min</p>
            </div>
            <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${INTENSITY_COLOR[s.intensity]}`} />
          </div>
        ))}
      </div>

      <button
        onClick={() => onAskBuddy(`Can we adjust "${task.title}"?`)}
        className="w-full py-3 rounded-lg border border-stone-300 text-stone-700 font-medium flex items-center justify-center gap-2"
      >
        <MessageCircle className="w-4 h-4" /> Ask Buddy about this
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat sidebar — the "on request" panel, shared across the main hub
// ---------------------------------------------------------------------------

function ChatSidebar({ open, log, value, onChange, onSend, onClose }) {
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-white border-l border-stone-200 z-50 flex flex-col transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <p className="font-serif text-lg text-stone-900">Buddy</p>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {log.length === 0 && (
            <p className="text-sm text-stone-400">Ask Buddy to move something, or ask for help on a topic from Classes.</p>
          )}
          {log.map((m, i) => (
            <div key={i} className={m.from === 'user' ? 'text-right' : ''}>
              <span className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${m.from === 'user' ? 'bg-emerald-700 text-white' : 'bg-stone-200 text-stone-700'}`}>
                {m.text}
              </span>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-stone-200 flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            placeholder="Message Buddy"
            className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button onClick={onSend} className="p-2 rounded-lg bg-stone-900 text-white shrink-0">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export default function App() {
  const [phase, setPhase] = useState('onboarding'); // onboarding -> generating -> main
  const [page, setPage] = useState('plan'); // plan | classes | task (within main)
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [plan, setPlan] = useState({ goals: [], tasks: [], fixedBlocks: [], classTimelines: [] });
  const [genFeedback, setGenFeedback] = useState('');
  const [genLog, setGenLog] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatValue, setChatValue] = useState('');
  const [chatLog, setChatLog] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  function advance(currentAnswers) {
    if (qIndex < QUESTIONS.length - 1) {
      setQIndex(qIndex + 1);
    } else {
      // In production: POST /api/user/preferences { ...currentAnswers }
      setPlan(buildPlan(currentAnswers));
      setPhase('generating');
    }
  }

  function handleSingleSelect(qid, value) {
    const updated = { ...answers, [qid]: value };
    setAnswers(updated);
    advance(updated);
  }

  function handleMultiToggle(qid, value) {
    setAnswers((prev) => {
      const existing = prev[qid] || [];
      const next = existing.includes(value) ? existing.filter((v) => v !== value) : [...existing, value];
      return { ...prev, [qid]: next };
    });
  }

  function handleMultiContinue() {
    advance(answers);
  }

  function regenerateSession(taskId, sessionId) {
    // In production: POST /api/calendar/session/:id/regenerate
    setPlan((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              sessions: t.sessions.map((s) =>
                s.id === sessionId ? { ...s, time: shiftTime(s.time), duration: Math.max(20, s.duration - 10) } : s
              )
            }
      )
    }));
  }

  function sendGenFeedback() {
    if (!genFeedback.trim()) return;
    // In production: POST /api/chat { message } -> chatbot response + updated plan
    const msg = genFeedback;
    setGenLog((prev) => [...prev, { from: 'user', text: msg }]);
    setGenFeedback('');
    setTimeout(() => {
      setGenLog((prev) => [...prev, { from: 'bot', text: 'Got it — nudging things around.' }]);
      setPlan((prev) => {
        if (prev.tasks.length === 0) return prev;
        const t = prev.tasks[Math.floor(Math.random() * prev.tasks.length)];
        const s = nextPendingSession(t);
        return {
          ...prev,
          tasks: prev.tasks.map((task) =>
            task.id !== t.id
              ? task
              : { ...task, sessions: task.sessions.map((sess) => (sess.id === s.id ? { ...sess, time: shiftTime(sess.time) } : sess)) }
          )
        };
      });
    }, 700);
  }

  function openChat(seedMessage) {
    setChatOpen(true);
    if (!seedMessage) return;
    setChatLog((prev) => [...prev, { from: 'user', text: seedMessage }]);
    setTimeout(() => {
      const isResource = seedMessage.toLowerCase().includes('resource');
      const reply = isResource
        ? "Found a couple of starting points — a worked-examples set and a short explainer video. I'll drop links in once this is wired up."
        : 'Got it — I moved things around a bit.';
      setChatLog((prev) => [...prev, { from: 'bot', text: reply }]);
      if (!isResource) {
        setPlan((prev) => {
          if (prev.tasks.length === 0) return prev;
          const t = prev.tasks[Math.floor(Math.random() * prev.tasks.length)];
          const s = nextPendingSession(t);
          return {
            ...prev,
            tasks: prev.tasks.map((task) =>
              task.id !== t.id
                ? task
                : { ...task, sessions: task.sessions.map((sess) => (sess.id === s.id ? { ...sess, time: shiftTime(sess.time) } : sess)) }
            )
          };
        });
      }
    }, 700);
  }

  function sendChat() {
    if (!chatValue.trim()) return;
    const msg = chatValue;
    setChatValue('');
    openChat(msg);
  }

  function toggleSession(taskId, sessionId) {
    setPlan((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id !== taskId ? t : { ...t, sessions: t.sessions.map((s) => (s.id === sessionId ? { ...s, done: !s.done } : s)) }
      )
    }));
  }

  const selectedTask = plan.tasks.find((t) => t.id === selectedTaskId);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 font-sans flex items-start justify-center p-6">
      <div className="w-full max-w-xl">
        {phase === 'onboarding' && (
          <Onboarding
            qIndex={qIndex}
            answers={answers}
            onSingleSelect={handleSingleSelect}
            onMultiToggle={handleMultiToggle}
            onMultiContinue={handleMultiContinue}
          />
        )}

        {phase === 'generating' && (
          <FirstLook
            plan={plan}
            log={genLog}
            feedback={genFeedback}
            setFeedback={setGenFeedback}
            onSend={sendGenFeedback}
            onRegenerate={regenerateSession}
            onContinue={() => setPhase('main')}
          />
        )}

        {phase === 'main' && (
          <>
            <MainHeader page={page} setPage={setPage} onToggleChat={() => setChatOpen((o) => !o)} />

            {page === 'plan' && (
              <PlanPage
                tasks={plan.tasks}
                fixedBlocks={plan.fixedBlocks}
                goals={plan.goals}
                onOpenTask={(id) => {
                  setSelectedTaskId(id);
                  setPage('task');
                }}
              />
            )}

            {page === 'classes' && (
              <ClassesPage
                classTimelines={plan.classTimelines}
                onAskResources={(className, topic) => openChat(`Find resources on "${topic}" for ${className}`)}
              />
            )}

            {page === 'task' && selectedTask && (
              <TaskDetail
                task={selectedTask}
                goal={plan.goals.find((g) => g.id === selectedTask.goalId)}
                onToggleSession={(sessionId) => toggleSession(selectedTask.id, sessionId)}
                onBack={() => setPage('plan')}
                onAskBuddy={openChat}
              />
            )}

            <ChatSidebar
              open={chatOpen}
              log={chatLog}
              value={chatValue}
              onChange={setChatValue}
              onSend={sendChat}
              onClose={() => setChatOpen(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
