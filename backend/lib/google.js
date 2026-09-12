// ---------------------------------------------------------------------------
// Google OAuth 2.0 authorization-code flow with PKCE.
//
// Why by hand instead of a library: this is ~120 readable lines, it adds two
// small dependencies instead of a framework, and every security-relevant step is
// visible in one file. The steps that matter, none of which are optional:
//
//   state   — random, stored in a short-lived httpOnly cookie and compared on
//             return. Without it, an attacker can complete a login in the
//             victim's browser with their own code (login CSRF).
//   PKCE    — code_verifier/challenge pair, also cookie-stored. Protects the
//             code against interception even though we hold a client secret.
//   nonce   — echoed inside the id_token, proving the token was minted for this
//             specific request and isn't replayed.
//   hd      — Google's hosted-domain claim. This is the CMU part: Andrew
//             accounts are Google Workspace, so a verified hd of andrew.cmu.edu
//             means Google authenticated them against CMU's own directory.
//
// The id_token signature is verified against Google's JWKS rather than trusted
// because it arrived over TLS — a token from the token endpoint is still just
// bytes until its signature and claims are checked.
// ---------------------------------------------------------------------------

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function randomString(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

/** Everything the callback will need to verify what comes back. */
export async function beginAuth() {
  const state = randomString();
  const nonce = randomString();
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256(codeVerifier);

  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Pre-filters the account chooser to CMU accounts. A convenience only — it
    // is trivially removable by the user, so the real check is the verified hd
    // claim below, never this parameter.
    hd: env.allowedDomains[0],
    prompt: 'select_account',
  });

  return {
    url: `${AUTH_ENDPOINT}?${params.toString()}`,
    state,
    nonce,
    codeVerifier,
  };
}

async function exchangeCode(code, codeVerifier) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's error text is genuinely useful here (redirect_uri_mismatch,
    // invalid_client) — surface it rather than a generic failure.
    throw new Error(`Token exchange failed: ${body.error ?? res.status} ${body.error_description ?? ''}`.trim());
  }
  return body;
}

/**
 * @returns {{sub, email, name, picture, hd}} verified claims
 * @throws if the token is invalid or the account isn't from an allowed domain
 */
export async function completeAuth({ code, codeVerifier, expectedNonce }) {
  const tokens = await exchangeCode(code, codeVerifier);
  if (!tokens.id_token) throw new Error('Google did not return an id_token');

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUERS,
    audience: env.googleClientId,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch — this sign-in response does not match the request');
  }
  if (!payload.email) {
    throw new Error('Google returned no email address');
  }
  if (payload.email_verified === false) {
    throw new Error('That Google account has an unverified email address');
  }

  // The access check. hd is the authoritative signal for a Workspace account;
  // fall back to the email domain for accounts where hd is absent.
  const emailDomain = String(payload.email).toLowerCase().split('@')[1] ?? '';
  const hd = payload.hd ? String(payload.hd).toLowerCase() : null;
  const allowed = env.allowedDomains;
  const permitted = (hd && allowed.includes(hd)) || allowed.includes(emailDomain);

  if (!permitted) {
    const err = new Error(
      `Buddy is limited to ${allowed.join(' and ')} accounts. You signed in as ${payload.email}.`,
    );
    err.code = 'domain_not_allowed';
    throw err;
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
    hd,
  };
}
