# Preference API integration

This application implements `PREFERENCE_API.md` as the client-to-LLM-to-scheduler boundary.

## Flow

1. The browser sends a natural-language preference to `POST /api/schedule/interpret`.
2. The server calls OpenAI Responses with six function tools only: `set_preferred_work_hours`, `set_daily_workload_limit`, `protect_time_block`, `set_break_habits`, `remove_preference`, and `list_current_preferences`.
3. The browser sends the returned typed operations to `POST /api/preferences`.
4. Next.js proxies that payload to `FASTAPI_PREFERENCES_PATH` (default `/preferences/operations`). This is intentionally configurable: the source specification defines the operation objects but not their persistence endpoint.
5. If that response has `runId`, the UI polls `GET /api/optimizer-runs/:id`; otherwise it starts `POST /api/optimizer-runs`.
6. On `completed`, the UI fetches `GET /api/plan` and renders the resulting plan.

## FastAPI contract

The documented backend routes are proxied without transformation:

- `POST /optimizer/runs` → `{ id, status, stage?, progress? }`
- `GET /optimizer/runs/:id` → `{ id, status, stage?, progress? }`
- `GET /plan` → `{ placed, unplaced, ... }`

`POST /preferences/operations` is the default only. Configure `FASTAPI_PREFERENCES_PATH` to the actual FastAPI persistence route. It receives `{ operations: PreferenceOperation[] }` and may return `{ runId?, warning?, preferences? }`.

## Safety rules carried from the specification

- Only the six documented preference operations are offered to the model.
- The model cannot invoke the solver directly.
- `strength` values are the bounded enum `gentle`, `moderate`, or `firm`; raw solver weights are never accepted from the model or frontend.
- Time, weekday, and numeric bounds are in the function schemas; the FastAPI service remains the final validator before persistence.
- `protect_time_block` is hard and deliberately has no strength argument.

## Environment

`OPENAI_API_KEY`, `OPENAI_MODEL`, and `FASTAPI_BASE_URL` are server-only. `FASTAPI_PREFERENCES_PATH` defaults to `/preferences/operations`.

## Frontend debug output

After each interpretation, the page shows a **Debug: complete pipeline payloads** panel. It includes the submitted input, complete OpenAI Responses object, extracted preference operations, FastAPI preference-write response, optimizer-run status, and returned plan. API keys and outbound request headers are never sent to the browser.
