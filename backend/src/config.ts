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
  /** Outgoing mail for email logins. Unset: codes are written to the server log instead. */
  smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
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

/** Mailtrap's sending SMTP server; it authenticates as "api" with an API token. */
const MAILTRAP_HOST = 'live.smtp.mailtrap.io';

/**
 * Outgoing mail: SMTP_HOST and friends, or just MAILTRAP_TOKEN for
 * Mailtrap. Mailtrap only sends from domains verified in its dashboard, so
 * SMTP_FROM must use one.
 */
function smtpConfig(env: NodeJS.ProcessEnv): Config['smtp'] {
  const from = env.SMTP_FROM ?? 'DEADBORD <no-reply@localhost>';
  if (env.SMTP_HOST) {
    return {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      // Port 465 is TLS from the start; others upgrade with STARTTLS.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === '465',
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from,
    };
  }
  if (env.MAILTRAP_TOKEN) {
    if (!env.SMTP_FROM) throw new Error('MAILTRAP_TOKEN needs SMTP_FROM, an address on a domain verified in Mailtrap');
    return { host: MAILTRAP_HOST, port: 587, secure: false, user: 'api', pass: env.MAILTRAP_TOKEN, from };
  }
  return undefined;
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
    smtp: smtpConfig(env),
    tdlp: {
      port: Number(env.TDLP_PORT ?? 3001),
      host: env.TDLP_HOST ?? env.HOST ?? '0.0.0.0',
      privateKeyFile: resolve(env.TDLP_PRIVATE_KEY_FILE ?? 'tdlp-private.pem'),
    },
  };
}
