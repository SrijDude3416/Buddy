// ---------------------------------------------------------------------------
// Google OAuth 2.0 authorization-code flow with PKCE.
//
// Ported from backend/lib/google.js so the demo app enforces the same checks as
// the production backend. Every step below is load-bearing:
//
//   state   — random, stored in a short-lived httpOnly cookie and compared on
//             return. Without it an attacker can complete a login in the
//             victim's browser with their own code (login CSRF).
//   PKCE    — code_verifier/challenge pair, also cookie-stored. Protects the
//             code against interception even though we hold a client secret.
//   nonce   — echoed inside the id_token, proving the token was minted for this
//             specific request and is not a replay.
//   hd      — Google's hosted-domain claim. This is the CMU part: Andrew
//             accounts are Google Workspace, so a verified hd of andrew.cmu.edu
//             means Google authenticated the person against CMU's own directory.
//
// The id_token signature is verified against Google's JWKS rather than trusted
// because it arrived over TLS — a token from the token endpoint is still just
// bytes until its signature and claims are checked.
//
// Note the asymmetry that CLAUDE.md calls out: the `hd` *request* parameter
// below is a UI hint that pre-filters the account chooser and is trivially
// removed by the user. The verified `hd`/email-domain *claim* is the real gate.
// ---------------------------------------------------------------------------

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { authEnv } from './env';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type GoogleClaims = {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  hd: string | null;
};

export class DomainNotAllowedError extends Error {
  code = 'domain_not_allowed' as const;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function randomString(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

/** Everything the callback will need in order to verify what comes back. */
export async function beginAuth(redirectUri: string) {
  const state = randomString();
  const nonce = randomString();
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256(codeVerifier);

  const params = new URLSearchParams({
    client_id: authEnv.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Pre-filters the account chooser to CMU accounts. A convenience only — it
    // is trivially removable by the user, so the real check is the verified hd
    // claim in completeAuth, never this parameter.
    hd: authEnv.allowedDomains[0],
    prompt: 'select_account',
  });

  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, nonce, codeVerifier };
}

async function exchangeCode(code: string, codeVerifier: string, redirectUri: string) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: authEnv.googleClientId,
      client_secret: authEnv.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's error text is genuinely useful here (redirect_uri_mismatch,
    // invalid_client) — surface it rather than a generic failure.
    const detail = `${body.error ?? res.status} ${body.error_description ?? ''}`.trim();
    throw new Error(`Token exchange failed: ${detail}`);
  }
  return body as { id_token?: string };
}

/**
 * @throws if the token is invalid, replayed, or the account is not from an
 *         allowed domain (DomainNotAllowedError).
 */
export async function completeAuth({
  code,
  codeVerifier,
  expectedNonce,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  expectedNonce: string | undefined;
  redirectUri: string;
}): Promise<GoogleClaims> {
  const tokens = await exchangeCode(code, codeVerifier, redirectUri);
  if (!tokens.id_token) throw new Error('Google did not return an id_token');

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUERS,
    audience: authEnv.googleClientId,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch — this sign-in response does not match the request');
  }
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) throw new Error('Google returned no email address');
  if (payload.email_verified === false) {
    throw new Error('That Google account has an unverified email address');
  }

  // The access check. hd is the authoritative signal for a Workspace account;
  // fall back to the email domain for accounts where hd is absent.
  const emailDomain = email.toLowerCase().split('@')[1] ?? '';
  const hd = payload.hd ? String(payload.hd).toLowerCase() : null;
  const allowed = authEnv.allowedDomains;
  const permitted = isAndrewAccount(email, hd);

  if (!permitted) {
    throw new DomainNotAllowedError(
      `Buddy is limited to ${allowed.join(' and ')} accounts. You signed in as ${email}.`,
    );
  }

  return {
    sub: String(payload.sub),
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
    hd,
  };
}

export function isAndrewAccount(email: string, hostedDomain: string | null): boolean {
  return /^[^@\s]+@andrew\.cmu\.edu$/i.test(email) && (hostedDomain === null || hostedDomain.toLowerCase() === 'andrew.cmu.edu');
}
