// ---------------------------------------------------------------------------
// Auth configuration, and the one function that decides whether this deployment
// actually enforces sign-in.
//
// Three modes, because "is auth on?" genuinely has three answers here:
//
//   oauth        — Google credentials are present. Real CMU sign-in, real gate.
//   demo         — the documented zero-config demo. /auth/session hands back a
//                  fixed demo student so the calendar walkthrough (and the
//                  Playwright suite) runs with no Google project and no Mongo.
//   unconfigured — production, but the Google credentials are missing. Fail
//                  CLOSED: no demo user, no dead sign-in button, a message that
//                  says what is wrong.
//
// That last mode is the whole point of the split. A misconfigured production
// deploy — an env var dropped during a Vercel setup, a typo'd secret name —
// must not silently degrade into "everyone is signed in as the demo student".
// It fails shut and says why. In development the same missing config is just the
// demo, because that is what the README promises a fresh clone.
// ---------------------------------------------------------------------------

export type AuthMode = 'oauth' | 'demo' | 'unconfigured';

function read(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export const authEnv = {
  get googleClientId() {
    return read('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret() {
    return read('GOOGLE_CLIENT_SECRET');
  },
  /** Signs the session cookie. 32+ bytes: openssl rand -base64 48 */
  get sessionSecret() {
    return read('SESSION_SECRET');
  },
  /**
   * Must match an Authorized redirect URI on the Google client exactly. Left
   * unset it is derived from the incoming request, which is what makes a
   * localhost run work with no extra config — but a real deploy should pin it.
   */
  get redirectUriOverride() {
    return read('OAUTH_REDIRECT_URI');
  },
  /** Where to send the browser after the round trip. Defaults to same-origin. */
  get appOriginOverride() {
    return read('APP_ORIGIN');
  },
  get allowedDomains() {
    return ['andrew.cmu.edu'];
  },
  /** Persisting users is optional; see lib/auth/users.ts. */
  get mongoUri() {
    return read('MONGODB_URI');
  },
  get mongoDb() {
    return read('MONGODB_DB') || 'buddy';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
  /** The explicit escape hatch: run the no-login demo even when auth is set up. */
  get demoBypass() {
    return read('BUDDY_ALLOW_DEMO') === '1';
  },
};

export function isOAuthConfigured(): boolean {
  return Boolean(
    authEnv.googleClientId && authEnv.googleClientSecret && authEnv.sessionSecret.length >= 32,
  );
}

export function authMode(): AuthMode {
  // An explicit flag wins over everything, including a working Google client —
  // that is what makes it usable for an offline demo and for the e2e suite.
  if (authEnv.demoBypass) return 'demo';
  if (isOAuthConfigured()) return 'oauth';
  return authEnv.isProd ? 'unconfigured' : 'demo';
}

/**
 * The redirect_uri sent to Google. The authorize call and the token exchange
 * must send the *identical* string or Google rejects the exchange, so both
 * callers derive it here rather than each building their own.
 */
export function redirectUri(request: Request): string {
  return authEnv.redirectUriOverride || new URL('/api/auth/google/callback', request.url).toString();
}

/** Where the browser lands after sign-in. Same-origin unless APP_ORIGIN pins it. */
export function appOrigin(request: Request): string {
  return authEnv.appOriginOverride || new URL(request.url).origin;
}
