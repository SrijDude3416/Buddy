# Buddy — backend

Next.js API routes on Vercel, MongoDB Atlas, and CMU sign-in via Google OAuth.
Serves exactly the 14 routes `frontend/src/lib/endpoints.js` declares.

## Setup (about 10 minutes)

### 1. Install

```bash
cd backend
npm install
cp .env.example .env.local
```

### 2. MongoDB Atlas

In your existing cluster:

- **Database Access** → ensure a user exists with *Read and write to any database*.
- **Network Access** → add your current IP for local dev. For a Vercel deploy you
  need `0.0.0.0/0`, because Vercel's serverless IPs are not fixed. That is safe
  only because the database user still needs its password — but it does mean the
  password is the only thing protecting the cluster, so use a strong one.
- **Connect → Drivers** → copy the connection string into `MONGODB_URI` in
  `.env.local`. Replace `<password>` with the real password, and URL-encode it if
  it contains `@ : / ? # [ ] %`.

Then create the indexes and seed the shared course catalog (once per cluster):

```bash
npm run indexes
```

### 3. Google OAuth — this is the CMU sign-in

CMU Andrew accounts are Google Workspace accounts, so Google OAuth restricted to
the `andrew.cmu.edu` hosted domain authenticates against CMU's own directory. No
CMU registration needed. (The official Shibboleth/Entra path requires registering
a service provider with CMU Computing Services — days, not minutes.)

In [console.cloud.google.com](https://console.cloud.google.com):

1. Create a project (any name).
2. **APIs & Services → OAuth consent screen**: User type **External**, fill in the
   app name and your email, and add yourself under **Test users**. Leave it in
   *Testing* — no verification needed while only test users sign in. Scopes
   `openid`, `email`, `profile` are all you need.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type **Web application**.
   - **Authorized redirect URIs**: `http://localhost:3000/api/auth/google/callback`
     (add your deployed callback URL too, once you have one). This must match
     `OAUTH_REDIRECT_URI` character for character — a trailing slash counts, and
     a mismatch is by far the most common failure here.
4. Copy the client ID and secret into `.env.local`.

### 4. Session secret

```bash
openssl rand -base64 48
```

Paste into `SESSION_SECRET`. Changing it later signs everyone out, which is also
how you revoke all sessions in an emergency.

### 5. Run both halves

```bash
cd backend && npm run dev      # :3000 — open it to see a config checklist
cd frontend && npm run dev     # :5173
```

Set `VITE_API_MODE=live` in `frontend/.env` to leave dummy data and hit this API.
The Vite dev server proxies `/api` to `:3000`, so the browser sees one origin and
there is no CORS to configure.

## How auth works

`lib/google.js` implements the authorization-code flow by hand — roughly 120
lines, two small dependencies, and every security-relevant step visible in one
file rather than inside a framework. None of these steps is optional:

| step | why |
|---|---|
| `state` in an httpOnly cookie, compared on return | without it an attacker can complete a sign-in in the victim's browser (login CSRF) |
| PKCE `code_verifier`/`code_challenge` | protects the code against interception |
| `nonce` echoed inside the id_token | proves the token was minted for this request, not replayed |
| id_token signature verified against Google's JWKS | a token from the token endpoint is still just bytes until verified |
| `hd` claim checked against `ALLOWED_EMAIL_DOMAINS` | the actual CMU restriction; the `hd` *request* parameter is only a UI hint and is trivially bypassed |

The session is a signed JWT in an httpOnly, SameSite=Lax cookie (7 days).
`SameSite=Lax` rather than `Strict` because the OAuth callback is a cross-site
top-level navigation back from Google, and `Strict` would drop the cookie on that
first hop.

**The tradeoff to know:** there is no session collection, so a stolen cookie stays
valid until it expires and "sign out everywhere" isn't possible without adding a
server-side denylist. Fine for a student planner; not fine if this ever handles
money or health data.

## Per-user data isolation

Every data route calls `requireUser(request)` first, and every query carries
`user_id` **in the filter** rather than checking it after the fetch. That is the
single thing standing between one account and another's schedule, so it is worth
grepping for: any query against `tasks`, `sessions`, `preferences`,
`chat_messages` or `optimizer_runs` without `user_id` in its filter is a bug.

`courses` and `syllabus_data` are deliberately shared and unscoped — they are the
same catalog for everyone.

## Deploying to Vercel

Set the project root to `backend/`, add every variable from `.env.example` in
**Settings → Environment Variables**, and then update two of them to the deployed
origin:

- `OAUTH_REDIRECT_URI=https://YOUR-APP.vercel.app/api/auth/google/callback`
- `APP_ORIGIN=https://YOUR-APP.vercel.app`

Add that same callback URL to the Google OAuth client. `NODE_ENV=production` on
Vercel automatically makes the session cookie `Secure`.

## What is still a stub

- **The solve is synchronous** and returns placeholder `objective_value` /
  `best_bound`. `lib/runs.js` is the seam: the polling contract the frontend uses
  is already correct, so moving to a queued CP-SAT worker changes that one file.
- **Chat replies are canned.** `app/api/chat/messages/route.js` marks where Gemini
  goes; note that it must only ever write typed `preferences` entries, never touch
  `sessions` directly.
- **No rate limiting** on the auth routes, and no account deletion.
