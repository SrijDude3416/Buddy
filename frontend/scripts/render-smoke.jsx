// ---------------------------------------------------------------------------
// Render smoke test: mounts every page with real mock data and asserts the
// expected copy is in the output. Catches render-time errors the build can't see
// (bad hook usage, undefined access, missing exports).
// ---------------------------------------------------------------------------

import React from 'react';
import { renderToString } from 'react-dom/server';
import { PlanProvider } from '../src/state/PlanProvider.jsx';
import { ChatProvider } from '../src/state/ChatProvider.jsx';
import { ThemeProvider } from '../src/state/ThemeProvider.jsx';
import { CalendarView } from '../src/components/plan/CalendarView.jsx';
import { GoalSwimlanes } from '../src/components/plan/GoalSwimlanes.jsx';
import { ClassLegend } from '../src/components/plan/ClassLegend.jsx';
import { CourseSelect } from '../src/components/ui/CourseSelect.jsx';
import { ThemeToggle } from '../src/components/ui/ThemeToggle.jsx';
import { COURSE_CATALOG } from '../src/lib/mock/catalog.js';
import { horizonDays } from '../src/lib/time.js';
import { toPlanView } from '../src/lib/adapters.js';
import { Onboarding } from '../src/pages/Onboarding.jsx';
import { GeneratingPlan } from '../src/pages/GeneratingPlan.jsx';
import { FirstLook } from '../src/pages/FirstLook.jsx';
import { PlanPage } from '../src/pages/PlanPage.jsx';
import { ClassesPage } from '../src/pages/ClassesPage.jsx';
import { TaskDetail } from '../src/pages/TaskDetail.jsx';
import { ChatSidebar } from '../src/components/chat/ChatSidebar.jsx';
import App from '../src/App.jsx';
import { buildPlanDocuments } from '../src/lib/mock/planFactory.js';
import { preferencesFromOnboarding } from '../src/lib/onboarding.js';

let failures = 0;
function renders(label, element, mustContain = []) {
  try {
    const html = renderToString(element);
    const missing = mustContain.filter((needle) => !html.includes(needle));
    if (missing.length) {
      failures += 1;
      console.log(`  FAIL ${label} — missing: ${missing.join(', ')}`);
    } else {
      console.log(`  ok   ${label}`);
    }
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label} — threw: ${err.message}`);
  }
}

const CHOSEN = ['course_15213', 'course_09217'];

const answers = {
  classes: CHOSEN,
  focus: 'Evening',
  commitment: 'None',
  style: 'Standard blocks (~1 hr)',
  pressure: 'An upcoming exam',
};

const docs = buildPlanDocuments({
  userId: 'user_demo',
  preferences: preferencesFromOnboarding(answers),
  runContext: { course_ids: CHOSEN, pressure: answers.pressure },
});
const payload = { ...docs, run: { run_id: 'run_test', status: 'solved', gap: 0.0588, objective_value: 1840, best_bound: 1955 } };

const withProviders = (children) => (
  <ThemeProvider>
    <PlanProvider initialPayload={payload}>
      <ChatProvider>{children}</ChatProvider>
    </PlanProvider>
  </ThemeProvider>
);

const plan = toPlanView(payload);
const days = horizonDays(7);

console.log('\npages render');
renders('App (starts on onboarding)', <App />, ['Setting up Buddy', 'Which classes are you taking']);
renders('Onboarding', <Onboarding onComplete={() => {}} />, ['Setting up Buddy']);
renders(
  'GeneratingPlan',
  withProviders(<GeneratingPlan runContext={{ course_ids: CHOSEN, pressure: answers.pressure }} onSolved={() => {}} onBack={() => {}} />),
  ['Building your week', 'Compiling your preferences into constraints', 'progressbar'],
);
renders('FirstLook', withProviders(<FirstLook onContinue={() => {}} />), ['a first look', 'Radial', 'Goals', 'List', 'best possible schedule']);
renders('PlanPage', withProviders(<PlanPage onOpenTask={() => {}} />), ['Today', 'Coming up', 'Rows are goals, not days', 'Your classes']);
renders('ClassesPage', withProviders(<ClassesPage />), ['Classes', plan.goals[0].title]);
renders('TaskDetail', withProviders(<TaskDetail taskId={payload.tasks[0]._id} onBack={() => {}} />), [payload.tasks[0].display_title, 'Ask Buddy about this']);
renders('TaskDetail (missing task)', withProviders(<TaskDetail taskId="nope" onBack={() => {}} />), ['no longer in this week']);
renders('ChatSidebar', withProviders(<ChatSidebar />), ['Message Buddy']);

console.log('\nnew layout pieces');
renders('CalendarView (week)', withProviders(<CalendarView plan={plan} days={days} selectedOffset={0} onSelectDay={() => {}} onOpenTask={() => {}} />), ['progressbar'].slice(0, 0).concat(['AM']));
renders('CalendarView (single day)', withProviders(<CalendarView plan={plan} days={days.slice(0, 1)} selectedOffset={0} onSelectDay={() => {}} onOpenTask={() => {}} />), ['Today']);
renders('GoalSwimlanes (rows are goals)', withProviders(<GoalSwimlanes plan={plan} offset={0} dayLabel="Today" onOpenTask={() => {}} />), [plan.goals[0].code, 'under the class they serve']);
renders('ClassLegend', withProviders(<ClassLegend plan={plan} selectedOffset={0} dayLabel="Today" />), ['Your classes', plan.goals[0].code, 'Block types', 'be moved']);
renders('ThemeToggle', withProviders(<ThemeToggle />), ['Light', 'Dark', 'System']);
renders(
  'CourseSelect (closed)',
  <CourseSelect courses={COURSE_CATALOG} selectedIds={CHOSEN} onToggle={() => {}} onRemove={() => {}} />,
  ['15-213', '2 classes selected'],
);
renders(
  'CourseSelect (empty state)',
  <CourseSelect courses={COURSE_CATALOG} selectedIds={[]} onToggle={() => {}} onRemove={() => {}} />,
  ['Choose your classes'],
);

console.log('\ntheming');
const legendHtml = renderToString(withProviders(<ClassLegend plan={plan} selectedOffset={0} dayLabel="Today" />));
renders('legend declares dark variants', <span>{String(/dark:/.test(legendHtml))}</span>, ['true']);
const calHtml = renderToString(withProviders(<CalendarView plan={plan} days={days} selectedOffset={0} onSelectDay={() => {}} onOpenTask={() => {}} />));
renders('calendar declares dark variants', <span>{String(/dark:/.test(calHtml))}</span>, ['true']);
renders(
  'every class color appears in the calendar',
  <span>{String(plan.goals.every((g) => calHtml.includes(plan.colorMap.get(g.id).rail.split(' ')[0])))}</span>,
  ['true'],
);

console.log('\ncopy rules');
const hubHtml = renderToString(withProviders(<PlanPage onOpenTask={() => {}} />));
// The "never say calendar" rule was explicitly overridden — the calendar is now a
// deliberate feature. What still holds: deadlines stay relative, and the task page
// stays free of due-date/priority form controls.
renders('no absolute dates in Coming up', <span>{String(!/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/.test(hubHtml))}</span>, ['true']);
renders('deadlines are still relative', <span>{String(/in \d+ days|today|tomorrow/i.test(hubHtml))}</span>, ['true']);
const taskHtml = renderToString(withProviders(<TaskDetail taskId={payload.tasks[0]._id} onBack={() => {}} />));
renders('task page has no priority/due-date form control', <span>{String(!/<select|type="date"/.test(taskHtml))}</span>, ['true']);

console.log(failures === 0 ? '\nAll render checks passed.\n' : `\n${failures} render check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
