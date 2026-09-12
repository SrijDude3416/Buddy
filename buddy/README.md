# Buddy schedule optimizer

See [PIPELINE.md](./PIPELINE.md) for the Preference API operation catalog, the complete LLM-to-FastAPI request flow, and backend endpoint contracts.

A Vercel-ready Next.js App Router template for this pipeline:

```text
Browser UI
  -> POST /api/schedule/interpret
  -> OpenAI Responses API / ChatGPT (server only)
  -> { chatResponse, operations }
  -> POST /api/optimization-jobs
  -> FastAPI (future) -> MongoDB (future) -> { id }
  -> GET /api/optimization-jobs/:id
  -> display stored/optimized result in the UI
```

## What is included

- A client UI in `app/page.tsx` that submits a natural-language schedule request and displays the conversation reply, generated operations, and final job data.
- A server-side OpenAI route in `app/api/schedule/interpret/route.ts`. The OpenAI key never reaches the browser.
- Structured ChatGPT output with this temporary contract:

  ```ts
  type GeminiInterpretation = {
    chatResponse: string;
    operations: Array<{
      type: string;
      payload: Record<string, unknown>;
    }>;
  };
  ```

- Next.js proxy routes for the future FastAPI backend:
  - `POST /api/optimization-jobs`
  - `GET /api/optimization-jobs/:id`
- FastAPI adapter code isolated in `lib/fastapi.ts`.

## Intentionally unfinished pieces

The schedule-specific ChatGPT prompt is **not written**, per the project requirement. Add it only in `lib/chatgpt.ts`, at the marked `TODO`. The raw user message is currently sent without an application instruction.

The FastAPI/MongoDB service is also not implemented. This frontend currently assumes these future endpoints:

| Method | Future FastAPI endpoint | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/optimization-jobs` | `{ operations: ScheduleOperation[] }` | `{ id: string, status?: string }` |
| `GET` | `/optimization-jobs/{id}` | — | `{ id: string, status?: string, result?: unknown }` |

If your backend uses different paths or response shapes, update only `lib/fastapi.ts` and (if necessary) `lib/types.ts`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `OPENAI_API_KEY` to an OpenAI API key.
3. Set `FASTAPI_BASE_URL` when the backend exists. It defaults to `http://localhost:8000` in the example.
4. Install and start:

   ```bash
   npm install
   npm run dev
   ```

Open `http://localhost:3000`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes for interpretation | Server-only OpenAI credential. Do not rename it with a `NEXT_PUBLIC_` prefix. |
| `OPENAI_MODEL` | No | OpenAI model name; defaults to `gpt-5-mini`. |
| `FASTAPI_BASE_URL` | Yes once the backend is connected | Internal/public URL for FastAPI. |

Vercel: add these values in **Project Settings → Environment Variables**. Keep `GEMINI_API_KEY` server-only.

## Request lifecycle

`app/page.tsx` does the following in order when the user submits the form:

1. Posts `{ input }` to the Next.js interpretation route.
2. Receives ChatGPT's typed `{ chatResponse, operations }` response and renders the chat reply.
3. Posts `operations` to the optimization-job route, which forwards it to FastAPI.
4. Receives the FastAPI/Mongo-backed `id`.
5. Fetches the job by `id` and renders the latest returned data.

The final fetch is already wired for a job that is immediately available. If FastAPI performs optimization asynchronously, change `app/page.tsx` to poll `GET /api/optimization-jobs/:id` until `status === "completed"` (or use SSE/webhooks).

## Files

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Browser UI and orchestration of the three API calls. |
| `app/api/schedule/interpret/route.ts` | Validates frontend input and calls OpenAI. |
| `lib/chatgpt.ts` | OpenAI SDK integration and output schema; prompt TODO lives here. |
| `app/api/optimization-jobs/route.ts` | Proxies job creation to FastAPI. |
| `app/api/optimization-jobs/[id]/route.ts` | Proxies job retrieval to FastAPI. |
| `lib/fastapi.ts` | Single location for FastAPI URLs and request/response mapping. |
| `lib/types.ts` | Shared contracts for Gemini operations and optimization jobs. |

## Safety and validation next steps

Before treating Gemini operations as executable commands, define a closed operation vocabulary (for example, `create_event`, `move_event`, `set_availability`) and validate every operation server-side. Do not pass model output directly to MongoDB or other mutation APIs without authorization checks and schema validation.
