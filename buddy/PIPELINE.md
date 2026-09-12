# Active demo pipeline

All chat uses `lib/chatgpt.ts`: OpenAI function calling with the six definitions
imported from `../backend/optimizer/tool_schemas.json`. The model chooses preference
API calls; the Python optimizer chooses event placements.

`GET /api/preferences` proxies Python `GET /preferences/defaults`, returning
`answers`, `catalog`, `mode`, `preferences`, `preference_calls`, and `plan`. The initial
plan is a cached real solve using the original static dataset. `POST /api/preferences`
translates onboarding choices into supported preference setters and runs CP-SAT.

`POST /api/chat/messages` (also `/api/schedule/interpret`) accepts:

```json
{
  "text": "Keep Friday evening free",
  "plan": "the complete current plan object, including preferences",
  "history": [{"role": "user", "text": "Earlier feedback"}]
}
```

The wrapper returns tool names and arguments. Next.js posts the current saved
preferences and these calls to Python `/preferences/operations`. That endpoint
validates arguments using the existing Pydantic tool models, applies the same
handlers as `/tools/*` to an isolated store, and calls `scheduler.build_and_solve`
once. No event mutation or alternative placement algorithm runs in JavaScript.

The final response contains:

- `message`, `messages`: conversational response and transcript entries.
- `preference_calls`: applied calls with `name`, `arguments`, `endpoint`, `method`, and handler `result`.
- `preferences`: canonical active setters, also included in `plan.preferences`.
- `plan`: full solver result adapted for the React calendar.
- `plan_changed`: whether a tool batch rebuilt the schedule.
- `mode: "openai"`, `scheduler: "CP-SAT"`.

The six tools are `set_preferred_work_hours`, `set_daily_workload_limit`,
`protect_time_block`, `set_break_habits`, `remove_preference`, and
`list_current_preferences`. No tools means a conversational reply with the current
plan unchanged. Tool arguments, not model-suggested endpoints or arbitrary URLs,
select the allowlisted Python handlers. Existing individual endpoints remain
available with their original in-memory store; the demo's batch store is per request.

The browser requests `Accept: application/x-ndjson` and receives:

1. `status` with stage `interpreting`, immediately.
2. `proposal` with the model's explanation and `operationCount`.
3. `status` with stage `scheduling`, when calls are present.
4. `result` with the complete final response, or `error`.

Only the final result updates calendar state. Undo restores calendar and preference
state together. Failed, cancelled, or incomplete streams do not commit changes.
Cancellation aborts the HTTP/provider request; a Python solve already running may
complete, but its isolated result is discarded. The UI keeps elapsed time and stage
feedback; no made-up live optimality percentage is displayed. Final metadata includes
CP-SAT status, solve duration, objective, best bound, and relative objective bound gap.

The Python service uses a 15-second solve budget by default, configurable via
`BUDDY_SOLVE_SECONDS`. Feasible results are accepted; infeasible or unknown results
return an error and preserve the browser's previous plan. Static tasks outside the
window or sessions the solver leaves out remain visible in the unscheduled list.
