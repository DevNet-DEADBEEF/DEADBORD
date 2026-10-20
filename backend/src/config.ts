/** Server configuration from the environment (see .env.example). */

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  port: number;
  host: string;
  /** Public base URL of this server, used to build OAuth callback URLs. */
  publicUrl: string;
  /** Exported web app (`npx expo export --platform web` in frontend/). */
  staticDir: string;
  /** 32-byte key that encrypts OAuth state. Must be shared by all instances. */
  authSecret: Buffer;
  /** Where a finished login may send the session key. */
  allowedRedirects: string[];
  corsOrigins: string[];
  oauth: Partial<Record<string, OAuthClient>>;
  tdlp: {
    /** UDP port for TDLP (data transfer); separate from the HTTP port. */
    port: number;
    host: string;
    /** RSA private key (PEM) whose public half is built into clients. `npm run tdlp:keygen` makes a pair. */
    privateKeyFile: string;
  };
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');

  let authSecret: Buffer;
  if (env.AUTH_SECRET) {
    authSecret = Buffer.from(env.AUTH_SECRET, 'hex');
    if (authSecret.length !== 32) throw new Error('AUTH_SECRET must be 64 hex characters');
  } else {
    console.warn('AUTH_SECRET is not set; using a random one. OAuth logins will break across restarts and instances.');
    authSecret = randomBytes(32);
  }

  const oauth: Config['oauth'] = {};
  for (const provider of ['google', 'microsoft', 'discord', 'roblox']) {
    const prefix = `OAUTH_${provider.toUpperCase()}_`;
    const clientId = env[`${prefix}CLIENT_ID`];
    const clientSecret = env[`${prefix}CLIENT_SECRET`];
    if (clientId && clientSecret) oauth[provider] = { clientId, clientSecret };
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    publicUrl,
    staticDir: resolve(env.STATIC_DIR ?? '../frontend/dist'),
    authSecret,
    allowedRedirects: env.ALLOWED_REDIRECTS
      ? list(env.ALLOWED_REDIRECTS)
      : [`${publicUrl}/auth/callback`, 'http://localhost:8081/auth/callback', 'deadbord://auth'],
    // Default: the Expo web dev server (`npm run web` in frontend/) and the desktop app.
    corsOrigins: env.CORS_ORIGINS === undefined ? ['http://localhost:8081', 'app://deadbord'] : list(env.CORS_ORIGINS),
    oauth,
    tdlp: {
      port: Number(env.TDLP_PORT ?? 3001),
      host: env.TDLP_HOST ?? env.HOST ?? '0.0.0.0',
      privateKeyFile: resolve(env.TDLP_PRIVATE_KEY_FILE ?? 'tdlp-private.pem'),
    },
  };
}
