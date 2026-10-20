/**
 * HTTP server: serves the exported web app and the auth endpoints. Every
 * login ends by issuing a session key (src/auth/sessions.ts), which HTTP
 * clients send as `Authorization: Bearer <16 hex digits>`.
 */

import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { authorizeUrl, fetchIdentity, isProvider, openState, PROVIDERS } from '../auth/oauth.js';
import { registerApi } from './api.js';
import { SessionStore, type IssuedSession, type ResolvedSession, type SessionKey } from '../auth/sessions.js';
import { findByUsername, isValidUsername, randomUser, loginWithIdentity, signupWithUsername, UsernameTakenError } from '../auth/users.js';
import type { Config } from '../config.js';
import { AUTH_TYPES, collections, type AuthType, type User } from '../db/models.js';

/** What a successful login, or a rotation, returns. */
interface SessionResponse {
  /** Session key as 16 hex digits. */
  key: string;
  expiresDate: number;
  user: { id: string; username: string };
}

function formatKey(key: SessionKey): string {
  return key.toString(16).padStart(16, '0');
}

function parseKey(text: string | undefined): SessionKey | undefined {
  return text && /^[0-9a-f]{16}$/i.test(text) ? BigInt(`0x${text}`) : undefined;
}

function publicUser(user: User): SessionResponse['user'] {
  return { id: user._id.toString(), username: user.username };
}

function sessionResponse(session: IssuedSession, user: User): SessionResponse {
  return { key: formatKey(session.key), expiresDate: Number(session.expiresDate), user: publicUser(user) };
}

export async function buildServer(db: Db, config: Config) {
  const app = Fastify({ logger: true });
  const sessions = new SessionStore(db);
  const users = collections(db).users;

  if (config.corsOrigins.length) {
    await app.register(cors, { origin: config.corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'] });
  }

  /** Resolves the request's bearer session key, or replies 401. */
  async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    const key = parseKey(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]);
    const session = key !== undefined ? await sessions.resolve(key) : undefined;
    if (key === undefined || !session) {
      await reply.code(401).send({ error: 'Not logged in' });
      return undefined;
    }
    return { key, session } as { key: SessionKey; session: ResolvedSession };
  }

  app.get('/auth/providers', async () => ({
    providers: Object.keys(PROVIDERS).filter((p) => config.oauth[p]),
  }));

  const USERNAME_RULES = 'Usernames are 1-32 printable ASCII characters';

  function isAuthType(method: unknown): method is AuthType {
    return typeof method === 'string' && (AUTH_TYPES as readonly string[]).includes(method);
  }

  /**
   * Logs in with any non-OAuth method. Methods that can match several users
   * reply { candidates } instead; the client asks which one they are and
   * repeats the request with that userId.
   */
  app.post<{ Body: { method?: unknown; data?: Record<string, unknown>; userId?: unknown } }>(
    '/auth/login',
    async (req, reply) => {
      const { method, data } = req.body ?? {};
      if (!isAuthType(method)) return reply.code(400).send({ error: 'Unknown login method' });
      if (isProvider(method)) return reply.code(400).send({ error: `Use /auth/oauth/${method}/start` });

      if (method === 'username') {
        const username = data?.username;
        if (typeof username !== 'string' || !isValidUsername(username)) return reply.code(400).send({ error: USERNAME_RULES });
        const user = await findByUsername(db, username);
        if (!user) return reply.code(404).send({ error: `No user named ${username}` });
        return sessionResponse(await sessions.issue(user._id), user);
      }

      if (method === 'lucky') {
        const user = await randomUser(db);
        if (!user) return reply.code(404).send({ error: 'There are no users to be' });
        return sessionResponse(await sessions.issue(user._id), user);
      }

      // TODO: the remaining methods from the Login Methods page.
      return reply.code(501).send({ error: `Logging in with ${method} isn't available yet` });
    },
  );

  /** Creates a user with a username, enrolled in one login method. */
  app.post<{ Body: { username?: unknown; method?: unknown; data?: Record<string, unknown> } }>(
    '/auth/signup',
    async (req, reply) => {
      const { username, method } = req.body ?? {};
      if (!isAuthType(method)) return reply.code(400).send({ error: 'Unknown login method' });
      if (typeof username !== 'string' || !isValidUsername(username)) return reply.code(400).send({ error: USERNAME_RULES });

      if (method === 'username') {
        try {
          const user = await signupWithUsername(db, username);
          return sessionResponse(await sessions.issue(user._id), user);
        } catch (err) {
          if (err instanceof UsernameTakenError) return reply.code(409).send({ error: err.message });
          throw err;
        }
      }

      if (method === 'lucky') return reply.code(400).send({ error: "You can't sign up by feeling lucky" });

      // TODO: enrolling in the remaining methods.
      return reply.code(501).send({ error: `Signing up with ${method} isn't available yet` });
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { redirect?: string } }>(
    '/auth/oauth/:provider/start',
    async (req, reply) => {
      const { provider } = req.params;
      const client = isProvider(provider) ? config.oauth[provider] : undefined;
      if (!isProvider(provider) || !client) return reply.code(404).send({ error: 'Unknown login provider' });
      const redirect = req.query.redirect ?? '';
      // Only send session keys to known app URLs.
      if (!config.allowedRedirects.includes(redirect)) return reply.code(400).send({ error: 'Redirect not allowed' });
      return reply.redirect(authorizeUrl(provider, client, { publicUrl: config.publicUrl, secret: config.authSecret, redirect }));
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/oauth/:provider/callback',
    async (req, reply) => {
      const { provider } = req.params;
      const state = req.query.state ? openState(req.query.state, config.authSecret) : undefined;
      if (!state || state.provider !== provider) return reply.code(400).send({ error: 'Login expired, try again' });

      const finish = (params: Record<string, string>) =>
        reply.redirect(`${state.redirect}#${new URLSearchParams(params).toString()}`);

      if (req.query.error || !req.query.code) return finish({ error: req.query.error ?? 'Login cancelled' });
      try {
        const identity = await fetchIdentity(state.provider, config.oauth[state.provider]!, {
          publicUrl: config.publicUrl,
          code: req.query.code,
          verifier: state.verifier,
        });
        const user = await loginWithIdentity(db, state.provider, identity);
        const issued = await sessions.issue(user._id);
        return finish({ key: formatKey(issued.key), expiresDate: String(issued.expiresDate) });
      } catch (err) {
        req.log.error(err);
        return finish({ error: 'Login failed' });
      }
    },
  );

  app.get('/auth/me', async (req, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return reply;
    const user = await users.findOne({ _id: auth.session.userId });
    if (!user) return reply.code(401).send({ error: 'Not logged in' });
    return {
      user: publicUser(user),
      expiresDate: Number(auth.session.expiresDate),
      needsRotation: auth.session.needsRotation,
    };
  });

  app.post('/auth/rotate', async (req, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return reply;
    const [issued, user] = await Promise.all([sessions.rotate(auth.key), users.findOne({ _id: auth.session.userId })]);
    if (!issued || !user) return reply.code(409).send({ error: 'Session already rotated' });
    return sessionResponse(issued, user);
  });

  app.post('/auth/logout', async (req, reply) => {
    const auth = await authenticate(req, reply);
    if (!auth) return reply;
    await sessions.revoke(auth.key);
    return reply.code(204).send();
  });

  registerApi(app, db, authenticate);

  if (existsSync(config.staticDir)) {
    await app.register(fastifyStatic, { root: config.staticDir });
    // Single-page app: page loads (e.g. /boards, /auth/callback) get index.html and the client router takes over.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.log.warn(`No web build at ${config.staticDir}; run "npx expo export --platform web" in frontend/`);
  }

  return { app, sessions };
}
