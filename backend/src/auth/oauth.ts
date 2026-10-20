/**
 * OAuth2 authorization-code login (with PKCE) for third-party providers.
 *
 * The server is the OAuth client: it redirects the browser to the provider,
 * receives the callback, exchanges the code with its client secret and reads
 * the user's identity. OAuth state (provider, PKCE verifier, app redirect) is
 * sealed into the `state` parameter (src/auth/seal.ts), so any instance can
 * finish a login without shared storage.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { AuthType } from '../db/models.js';
import type { OAuthClient } from '../config.js';
import { seal, unseal } from './seal.js';

interface Provider {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  /** Accepts login_hint, pre-filling the account to sign in with. */
  loginHint?: boolean;
  /** Pulls a stable id and a display name out of the userinfo response. */
  identity(info: Record<string, unknown>): { subject: string; name?: string };
}

const oidc = (info: Record<string, unknown>) => ({
  subject: String(info.sub),
  name: (info.preferred_username ?? info.nickname ?? info.name) as string | undefined,
});

export const PROVIDERS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid profile',
    loginHint: true,
    identity: oidc,
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid profile',
    loginHint: true,
    identity: oidc,
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/v10/users/@me',
    scope: 'identify',
    identity: (info) => ({ subject: String(info.id), name: (info.username ?? info.global_name) as string | undefined }),
  },
  roblox: {
    authorizeUrl: 'https://apis.roblox.com/oauth/v1/authorize',
    tokenUrl: 'https://apis.roblox.com/oauth/v1/token',
    userInfoUrl: 'https://apis.roblox.com/oauth/v1/userinfo',
    scope: 'openid profile',
    identity: oidc,
  },
} satisfies Record<string, Provider>;

export type ProviderName = keyof typeof PROVIDERS & AuthType;

export function isProvider(name: string): name is ProviderName {
  return Object.hasOwn(PROVIDERS, name);
}

/** How long a user has to finish logging in at the provider. */
const STATE_TTL_MS = 10 * 60 * 1000;

interface State {
  provider: ProviderName;
  verifier: string;
  redirect: string;
  expires: number;
  /** Set when linking the provider to an existing user instead of logging in. */
  linkUser?: string;
  /** Set when this login is a later step of a multi-factor login (src/auth/factors.ts). */
  challenge?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Returns undefined for tampered, foreign or expired state. */
export function openState(sealed: string, secret: Buffer): State | undefined {
  return unseal<State>(sealed, secret);
}

export function callbackUrl(publicUrl: string, provider: ProviderName): string {
  return `${publicUrl}/auth/oauth/${provider}/callback`;
}

/** Builds the provider's authorization URL for a login that will finish at `redirect`. */
export function authorizeUrl(
  provider: ProviderName,
  client: OAuthClient,
  opts: { publicUrl: string; secret: Buffer; redirect: string; linkUser?: string; loginHint?: string; challenge?: string },
): string {
  const verifier = base64url(randomBytes(32));
  const p: Provider = PROVIDERS[provider];
  const url = new URL(p.authorizeUrl);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: callbackUrl(opts.publicUrl, provider),
    scope: p.scope,
    state: seal(
      {
        provider,
        verifier,
        redirect: opts.redirect,
        expires: Date.now() + STATE_TTL_MS,
        linkUser: opts.linkUser,
        challenge: opts.challenge,
      } satisfies State,
      opts.secret,
    ),
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  if (opts.loginHint && p.loginHint) params.set('login_hint', opts.loginHint);
  url.search = params.toString();
  return url.toString();
}

/** Exchanges the callback's code for the user's identity at the provider. */
export async function fetchIdentity(
  provider: ProviderName,
  client: OAuthClient,
  opts: { publicUrl: string; code: string; verifier: string },
): Promise<{ subject: string; name?: string }> {
  const p = PROVIDERS[provider];
  const tokenRes = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: callbackUrl(opts.publicUrl, provider),
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: opts.verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`${provider} token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error(`${provider} returned no access token`);

  const infoRes = await fetch(p.userInfoUrl, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error(`${provider} userinfo failed: ${infoRes.status}`);
  const identity = p.identity((await infoRes.json()) as Record<string, unknown>);
  if (!identity.subject || identity.subject === 'undefined') throw new Error(`${provider} returned no user id`);
  return identity;
}
