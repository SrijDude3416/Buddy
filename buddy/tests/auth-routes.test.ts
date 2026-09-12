// The four sign-in routes, driven directly as request handlers — no server, no
// network. Covers the things that are invisible until they're wrong: what each
// auth mode actually serves, that ?next can't be turned into an open redirect,
// and that a failed state check cannot mint a session.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GET as sessionRoute } from '../app/api/auth/session/route';
import { GET as startRoute } from '../app/api/auth/google/route';
import { GET as callbackRoute } from '../app/api/auth/google/callback/route';
import { POST as logoutRoute } from '../app/api/auth/logout/route';

const SECRET = 'z'.repeat(48);

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const OAUTH = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: SECRET,
  ALLOWED_EMAIL_DOMAINS: 'andrew.cmu.edu',
  OAUTH_REDIRECT_URI: undefined,
  APP_ORIGIN: undefined,
  BUDDY_ALLOW_DEMO: undefined,
  NODE_ENV: 'production',
};
const NO_CREDS = {
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  SESSION_SECRET: undefined,
  BUDDY_ALLOW_DEMO: undefined,
};

/**
 * Cookie names present on a response, mapped to their decoded values. Next
 * percent-encodes cookie values on write, which is why the callback route reads
 * them back through decodeURIComponent — mirror that here rather than comparing
 * against the encoded form and baking the encoding into the assertions.
 */
function setCookies(response: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    out.set(pair.slice(0, eq).trim(), decodeURIComponent(pair.slice(eq + 1)));
  }
  return out;
}

test('demo mode serves the fixed demo student', async () => {
  setEnv({ ...OAUTH, BUDDY_ALLOW_DEMO: '1' });
  const response = await sessionRoute(new Request('https://buddy.test/api/auth/session'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth_mode, 'demo');
  assert.equal(body.user.email, 'demo@andrew.cmu.edu');
});

test('production with no credentials serves no user at all', async () => {
  setEnv({ ...OAUTH, ...NO_CREDS, NODE_ENV: 'production' });
  const body = await (await sessionRoute(new Request('https://buddy.test/api/auth/session'))).json();
  assert.equal(body.auth_mode, 'unconfigured');
  // The bug this guards: falling back to DEMO_USER here would make a deploy that
  // lost its env vars look healthy while being open to anyone.
  assert.equal(body.user, null);
});

test('oauth mode with no cookie is signed out, not an error', async () => {
  setEnv(OAUTH);
  const response = await sessionRoute(new Request('https://buddy.test/api/auth/session'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth_mode, 'oauth');
  assert.equal(body.user, null);
});

test('starting sign-in redirects to Google with PKCE, state and nonce', async () => {
  setEnv(OAUTH);
  const response = await startRoute(new Request('https://buddy.test/api/auth/google?next=/plan'));
  assert.equal(response.status, 307);

  const target = new URL(response.headers.get('location')!);
  assert.equal(target.origin + target.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(target.searchParams.get('code_challenge'));
  assert.equal(target.searchParams.get('response_type'), 'code');
  assert.equal(
    target.searchParams.get('redirect_uri'),
    'https://buddy.test/api/auth/google/callback',
  );

  const cookies = setCookies(response);
  assert.equal(cookies.get('buddy_oauth_state'), target.searchParams.get('state'));
  assert.equal(cookies.get('buddy_oauth_nonce'), target.searchParams.get('nonce'));
  assert.ok(cookies.get('buddy_oauth_verifier'));
  assert.equal(cookies.get('buddy_oauth_next'), '/plan');
  // The verifier must never travel in the URL — only its hash does.
  assert.equal(target.searchParams.get('code_verifier'), null);
});

test('?next cannot be used as an open redirect', async () => {
  setEnv(OAUTH);
  for (const hostile of ['//evil.example/pwn', 'https://evil.example', 'javascript:alert(1)']) {
    const response = await startRoute(
      new Request(`https://buddy.test/api/auth/google?next=${encodeURIComponent(hostile)}`),
    );
    assert.equal(setCookies(response).get('buddy_oauth_next'), '/', `rejected: ${hostile}`);
  }
});

test('demo mode skips Google entirely and bounces back into the app', async () => {
  setEnv({ ...OAUTH, BUDDY_ALLOW_DEMO: '1' });
  const response = await startRoute(new Request('https://buddy.test/api/auth/google?next=/plan'));
  const target = new URL(response.headers.get('location')!);
  assert.equal(target.origin, 'https://buddy.test');
  assert.equal(target.pathname, '/plan');
  assert.equal(target.searchParams.get('signed_in'), '1');
});

test('a callback whose state does not match mints no session', async () => {
  setEnv(OAUTH);
  const request = new Request('https://buddy.test/api/auth/google/callback?code=abc&state=attacker', {
    headers: {
      cookie: 'buddy_oauth_state=genuine; buddy_oauth_nonce=n; buddy_oauth_verifier=v',
    },
  });
  const response = await callbackRoute(request);

  const target = new URL(response.headers.get('location')!);
  assert.match(target.searchParams.get('auth_error') ?? '', /verification failed/i);

  // The actual assertion that matters: no session cookie was issued, and the
  // one-time OAuth cookies were cleared rather than left replayable.
  const cookies = setCookies(response);
  assert.equal(cookies.get('buddy_session'), undefined);
  assert.equal(cookies.get('buddy_oauth_state'), '');
});

test('a callback arriving while sign-in is off is refused', async () => {
  setEnv({ ...OAUTH, BUDDY_ALLOW_DEMO: '1' });
  const response = await callbackRoute(
    new Request('https://buddy.test/api/auth/google/callback?code=abc&state=s', {
      headers: { cookie: 'buddy_oauth_state=s; buddy_oauth_verifier=v' },
    }),
  );
  const target = new URL(response.headers.get('location')!);
  assert.match(target.searchParams.get('auth_error') ?? '', /not enabled/i);
  assert.equal(setCookies(response).get('buddy_session'), undefined);
});

test('logout expires the session cookie', async () => {
  setEnv(OAUTH);
  const response = await logoutRoute();
  const raw = response.headers.getSetCookie().find((c) => c.startsWith('buddy_session='));
  assert.ok(raw, 'session cookie is cleared');
  assert.match(raw, /Max-Age=0/i);
  assert.match(raw, /HttpOnly/i);
});
