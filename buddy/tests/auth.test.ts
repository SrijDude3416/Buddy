// Tests for the two pieces of sign-in that are easy to get quietly wrong: which
// mode a given environment puts the app in, and whether a session cookie that
// has been tampered with is actually rejected.
//
// The mode table is the important one. "Missing Google credentials" has to mean
// the friendly zero-config demo on a laptop and a closed door in production, and
// nothing about that is enforced by the type system.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'x'.repeat(48);

/** env.ts reads process.env through getters, so each case can set its own world. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CONFIGURED = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: SECRET,
};
const BLANK = {
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  SESSION_SECRET: undefined,
  BUDDY_ALLOW_DEMO: undefined,
};

test('a configured Google client turns on the real gate', async () => {
  const { authMode, isOAuthConfigured } = await import('../lib/auth/env');
  withEnv({ ...CONFIGURED, BUDDY_ALLOW_DEMO: undefined, NODE_ENV: 'production' }, () => {
    assert.equal(isOAuthConfigured(), true);
    assert.equal(authMode(), 'oauth');
  });
});

test('missing credentials in development is the zero-config demo', async () => {
  const { authMode } = await import('../lib/auth/env');
  withEnv({ ...BLANK, NODE_ENV: 'development' }, () => {
    assert.equal(authMode(), 'demo');
  });
});

test('missing credentials in production fails closed, never to the demo user', async () => {
  const { authMode } = await import('../lib/auth/env');
  withEnv({ ...BLANK, NODE_ENV: 'production' }, () => {
    // The whole point: a dropped env var on a deploy must not silently sign
    // every visitor in as the demo student.
    assert.equal(authMode(), 'unconfigured');
  });
});

test('the demo bypass flag wins even over a working Google client', async () => {
  const { authMode } = await import('../lib/auth/env');
  withEnv({ ...CONFIGURED, BUDDY_ALLOW_DEMO: '1', NODE_ENV: 'production' }, () => {
    assert.equal(authMode(), 'demo');
  });
});

test('a too-short session secret does not count as configured', async () => {
  const { authMode, isOAuthConfigured } = await import('../lib/auth/env');
  withEnv(
    { ...CONFIGURED, SESSION_SECRET: 'short', BUDDY_ALLOW_DEMO: undefined, NODE_ENV: 'production' },
    () => {
      assert.equal(isOAuthConfigured(), false);
      assert.equal(authMode(), 'unconfigured');
    },
  );
});

test('redirect_uri and app origin default to the request origin', async () => {
  const { redirectUri, appOrigin } = await import('../lib/auth/env');
  withEnv({ OAUTH_REDIRECT_URI: undefined, APP_ORIGIN: undefined }, () => {
    const request = new Request('https://buddy.example.com/api/auth/google?next=/plan');
    assert.equal(redirectUri(request), 'https://buddy.example.com/api/auth/google/callback');
    assert.equal(appOrigin(request), 'https://buddy.example.com');
  });
  withEnv({ OAUTH_REDIRECT_URI: 'https://pinned.example/cb', APP_ORIGIN: 'https://app.example' }, () => {
    const request = new Request('https://buddy.example.com/api/auth/google');
    assert.equal(redirectUri(request), 'https://pinned.example/cb');
    assert.equal(appOrigin(request), 'https://app.example');
  });
});

test('a session cookie round-trips, and a tampered one is refused', async () => {
  process.env.SESSION_SECRET = SECRET;
  const { createSessionToken, readSessionToken } = await import('../lib/auth/session');

  const token = await createSessionToken({
    userId: 'user-1',
    googleSub: 'sub-1',
    email: 'someone@andrew.cmu.edu',
    name: 'Someone',
    picture: null,
  });

  const claims = await readSessionToken(token);
  assert.equal(claims?.userId, 'user-1');
  assert.equal(claims?.email, 'someone@andrew.cmu.edu');
  assert.equal(claims?.googleSub, 'sub-1');

  // Flip a byte of the signature: a forged cookie is "no session", not a throw.
  const parts = token.split('.');
  parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A');
  assert.equal(await readSessionToken(parts.join('.')), null);
  assert.equal(await readSessionToken(undefined), null);
});

test('a session signed with a different secret is refused', async () => {
  process.env.SESSION_SECRET = SECRET;
  const { createSessionToken } = await import('../lib/auth/session');
  const token = await createSessionToken({
    userId: 'user-1',
    googleSub: 'sub-1',
    email: 'someone@andrew.cmu.edu',
    name: null,
    picture: null,
  });

  process.env.SESSION_SECRET = 'y'.repeat(48);
  const { readSessionToken } = await import('../lib/auth/session');
  assert.equal(await readSessionToken(token), null);
  process.env.SESSION_SECRET = SECRET;
});

import { isAndrewAccount } from '../lib/auth/google';
test('only exact Andrew addresses pass, regardless of hosted-domain hints', () => {
  assert.equal(isAndrewAccount('student@andrew.cmu.edu', 'andrew.cmu.edu'), true);
  assert.equal(isAndrewAccount('Student@ANDREW.CMU.EDU', null), true);
  for (const email of ['student@cmu.edu', 'student@gmail.com', 'student@andrew.cmu.edu.evil.com', 'a@b@andrew.cmu.edu']) {
    assert.equal(isAndrewAccount(email, 'andrew.cmu.edu'), false);
  }
});
