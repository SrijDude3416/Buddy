# Buddy

Optimization tools for a student's semester. The thesis: **the AI doesn't optimize
for you — it optimizes the math for you**, shaped by how you actually work. You stay
the decision-maker; the AI translates your goals and habits into the mathematical
structure of a schedule.

See [`CLAUDE.md`](CLAUDE.md) for the full design context and the non-negotiable
principles, and [`SCHEMA.md`](SCHEMA.md) for the data model.

## Layout

```
frontend/          React 19 + Tailwind + Vite. The app the student uses.
backend/           Next.js 16 API routes + Google/CMU auth + MongoDB Atlas.
  app/api/           14 route handlers, mirroring frontend/src/lib/endpoints.js
  lib/               mongo, session, google (OAuth), runs, planEngine, seed
  optimizer/         CP-SAT model + preference compiler registry (Python)
docs/prototype/    The original single-file MVP, kept as a design reference.
SCHEMA.md          MongoDB schema — source of truth for collection shapes.
CLAUDE.md          Shared context for anyone working on any part of this.
```

## Running it

Two processes. Full setup — Atlas, Google OAuth, env vars — is in
[`backend/README.md`](backend/README.md).

```bash
# once, after pointing MONGODB_URI at a cluster
cd backend && npm install && npm run indexes

# then, in two terminals
cd backend  && npm run dev     # :3000  — open it for a config checklist
cd frontend && npm install && npm run dev   # :5173
```

`frontend/.env` controls which backend the app talks to:

| `VITE_API_MODE` | behaviour |
|---|---|
| `mock` | served entirely from `frontend/src/lib/mock/`. No cluster, no Google client, no network. Signs in a demo student automatically. |
| `live` | real fetches against `backend/`, real CMU sign-in. |

Mock mode exists so a backend or Atlas outage can never take a demo down with it.

## Tests

```bash
cd frontend && npm run smoke:all
```

85 headless checks: the data layer driven through the real client (schema
invariants, per-user isolation, no overlapping sessions, fixed blocks matching
real course meeting times) plus every page and component rendered. No browser
needed.
