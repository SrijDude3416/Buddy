# Buddy — frontend

React + Tailwind app for the Study Buddy layer. Runs entirely on dummy data today;
every request already goes through the same client that will talk to the real
backend, so switching over is one environment variable.

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:5173
npm run smoke:all    # headless checks: data layer + every page renders
```

## The gate

Every network call in the app goes through `request()` in `src/lib/apiClient.js`.
It reads one flag:

| `VITE_API_MODE` | behaviour |
|---|---|
| `mock` (default) | routed to a handler in `src/lib/mock/handlers.js`, with simulated latency, jitter and optional injected failures. No network. |
| `live` | real `fetch` against `VITE_API_BASE_URL`, with auth header, timeout, abort and normalized errors. |

Both paths return parsed JSON and throw the same `ApiError`, so nothing above the
client can tell which one it is talking to.

**To move onto a real backend:** set `VITE_API_MODE=live` and `VITE_API_BASE_URL`.
No component, hook, page or service file changes.

## Where the seams are

```
src/lib/endpoints.js     the API contract — every route, method and path, in one table
src/lib/api/index.js     service functions the app calls (never fetch directly)
src/lib/apiClient.js     the gate: mock vs live
src/lib/mock/            the dummy backend — db.js (schema-shaped), handlers.js, planFactory.js
src/lib/adapters.js      schema documents -> view models (progress, day labels, timelines)
src/hooks/               useRequest (one-shot) and useOptimizerRun (the loading screen)
src/state/               PlanProvider (plan + mutations), ChatProvider (sidebar)
```

`endpoints.js` and `mock/handlers.js` are keyed by the same names, so the contract
and the stand-in implementation cannot drift apart silently. When a route goes
live, its mock handler simply stops being reached — leave it as the reference for
what the backend owes the frontend.

### Routes the backend needs to serve

| name | method | path |
|---|---|---|
| `listCourseCatalog` | GET | `/courses` |
| `createPreferences` | POST | `/preferences` |
| `listPreferences` | GET | `/preferences` |
| `startOptimizerRun` | POST | `/optimizer/runs` |
| `getOptimizerRun` | GET | `/optimizer/runs/:runId` |
| `cancelOptimizerRun` | POST | `/optimizer/runs/:runId/cancel` |
| `getPlan` | GET | `/plan` |
| `patchSession` | PATCH | `/sessions/:sessionId` |
| `nudgeSession` | POST | `/sessions/:sessionId/nudge` |
| `getCourseBreakdown` | GET | `/courses/:courseId/breakdown` |
| `listChatMessages` | GET | `/chat/messages` |
| `sendChatMessage` | POST | `/chat/messages` |

All payloads are the `SCHEMA.md` collection shapes, unmodified — `sessions` carry
`type`, `action`, `intensity`, `duration_min`, `locked` and `completed`; fixed
blocks have `task_id: null`. Display strings (day labels, clock times, progress
percentages, "in 12 days") are derived client-side in `adapters.js` and are never
expected from the API.

## The main hub layout

```
[ Plan | Classes ]                      [light/dark/system] [Ask Buddy]

┌──────────────────────────────────────┬──────────────────┐
│  Calendar — real hour axis, blocks    │  Class colors    │
│  positioned by sessions.start and     │  + progress      │
│  sized by duration_min. Week or day.  │  + next deadline │
└──────────────────────────────────────┴──────────────────┘
  Goal swimlanes — rows are goals, not days, for the selected day
  Coming up — relative deadlines only
```

- **Calendar** (`components/plan/CalendarView.jsx`) is read-only by design: no
  drag-to-move, no click-to-create. Clicking a session opens its task; fixed class
  blocks render dark with a lock and aren't clickable. Placement changes only through
  the chat. A "now" line tracks today, and genuinely overlapping blocks split into
  side-by-side lanes rather than hiding one behind the other.
- **Goal swimlanes** (`components/plan/GoalSwimlanes.jsx`) sit underneath on the same
  time axis, but pivoted: one lane per class, every session under the goal it serves.
  A class with nothing that day still gets an empty lane. Clicking a day header in the
  calendar re-scopes the swimlanes.
- **Class legend** (`components/plan/ClassLegend.jsx`) is the shared color key and also
  carries per-class progress and next deadline.

### Theme

Three states — light, dark, and system — via `state/ThemeProvider.jsx`. "System" really
follows `prefers-color-scheme` and keeps following it when the OS flips; an explicit
choice persists in `localStorage` and wins until cleared. Tailwind runs in
`darkMode: 'class'` and the provider stamps `.dark` on `<html>`, so **every surface needs
its `dark:` pair** — a component with only light classes is a bug.

### Class colors

`lib/courseColors.js` holds an 8-entry palette; `toPlanView` assigns one entry per course
from the course order into `plan.colorMap`, so a class's color is identical in the
calendar, the swimlanes, the legend and the session dots, and never shifts between
renders. Class strings are written out in full rather than composed at runtime — Tailwind
only generates classes it can see literally in the source.

### Class picker

The onboarding class question is a multi-select dropdown over `GET /courses`
(`components/ui/CourseSelect.jsx`). Still not free text: typing only filters, and the only
committable values are real catalog entries — so a pick carries its `_id`, `code` and
`meeting_times` forward, which is what makes the calendar's fixed blocks real class times
rather than invented ones. Swap `lib/mock/catalog.js` for the Canvas-populated collection
and nothing else changes.

## The loading screen

`src/pages/GeneratingPlan.jsx`, driven by `src/hooks/useOptimizerRun.js`. It is
built for buffered data rather than for a fixed animation:

- POST a run, poll `GET /optimizer/runs/:id` until a terminal status, then GET the plan
- the server's `stage` and `progress` always win; the local ticker only animates
  the bar and is capped at 90%, so it can never claim to be further along than
  the solver actually is
- polling backs off (1.25× up to 4s), aborts on unmount, and stops on terminal status
- `infeasible` is its own outcome — "this genuinely can't be scheduled in time"
  is information worth surfacing, not an error to swallow
- a hard timeout, a cancel button and a retry path, and the run id on screen so a
  stuck solve is traceable to a row in `optimizer_runs`
- a minimum visible time so a fast solve doesn't flash

A real backend only has to report `{ run_id, status, stage, progress }` from
`POST /optimizer/runs` and the same plus `{ objective_value, best_bound, gap }`
from the GET. Valid statuses: `queued`, `running`, `solved`, `infeasible`,
`failed`, `cancelled`. Valid stages are listed in `RUN_STAGES` in the hook.

## Mock-mode knobs

Set these in `.env` to exercise states that are otherwise hard to reach:

| variable | effect |
|---|---|
| `VITE_MOCK_LATENCY` | simulated round trip, ms — raise it to see loading states |
| `VITE_MOCK_ERROR_RATE` | `0`–`1`, fraction of requests that fail — exercises error + retry UI |
| `VITE_MOCK_SOLVE_MS` | how long the fake solve takes |
| `VITE_MOCK_INFEASIBLE` | `1` makes the next run come back infeasible |

## Tests

`npm run smoke` (57 checks) drives catalog → onboarding → preferences → run → plan →
session actions → chat through the real client in mock mode and asserts the schema
invariants: fixed sessions have no `task_id` and are locked, fixed blocks only land on
their course's actual meeting weekdays and start times, `est_duration_min` is the rollup
of its sessions, nothing overlaps anything else, each class gets a distinct palette
color, swimlane rows are goals with only that goal's sessions, and a resource request
never becomes a preference entry.

`npm run smoke:render` (23 checks) mounts every page and every new layout component with
real mock data, and asserts the dark variants and class colors actually reach the markup.

`npm run smoke:all` runs both. Neither needs a browser.
