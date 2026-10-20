/**
 * OAuth2 authorization-code login (with PKCE) for third-party providers.
 *
 * The server is the OAuth client: it redirects the browser to the provider,
 * receives the callback, exchanges the code with its client secret and reads
 * the user's identity. OAuth state (provider, PKCE verifier, app redirect) is
 * encrypted into the `state` parameter, so any instance can finish a login
 * without shared storage.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AuthType } from '../db/models.js';
import type { OAuthClient } from '../config.js';

interface Provider {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
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
    identity: oidc,
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid profile',
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
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sealState(state: State, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

/** Returns undefined for tampered, foreign or expired state. */
export function openState(sealed: string, secret: Buffer): State | undefined {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const state = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()) as State;
    return state.expires > Date.now() ? state : undefined;
  } catch {
    return undefined;
  }
}

export function callbackUrl(publicUrl: string, provider: ProviderName): string {
  return `${publicUrl}/auth/oauth/${provider}/callback`;
}

/** Builds the provider's authorization URL for a login that will finish at `redirect`. */
export function authorizeUrl(
  provider: ProviderName,
  client: OAuthClient,
  opts: { publicUrl: string; secret: Buffer; redirect: string },
): string {
  const verifier = base64url(randomBytes(32));
  const p = PROVIDERS[provider];
  const url = new URL(p.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: callbackUrl(opts.publicUrl, provider),
    scope: p.scope,
    state: sealState({ provider, verifier, redirect: opts.redirect, expires: Date.now() + STATE_TTL_MS }, opts.secret),
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
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
