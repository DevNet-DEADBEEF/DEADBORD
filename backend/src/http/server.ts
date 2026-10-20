/**
 * HTTP server: serves the exported web app and the auth endpoints. Every
 * login ends by issuing a session key (src/auth/sessions.ts), which HTTP
 * clients send as `Authorization: Bearer <16 hex digits>`. Login methods
 * are matched in src/auth/login.ts. Boards, lists and
 * tasks travel over TDLP instead (src/tdlp/).
 */

import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { authorizeUrl, fetchIdentity, isProvider, openState, PROVIDERS } from '../auth/oauth.js';
import { registerAccount } from './account.js';
import { registerTiles } from './tiles.js';
import { formatKey, parseKey, SessionStore, type IssuedSession, type ResolvedSession, type SessionKey } from '../auth/sessions.js';
import { buildCredential, CredentialError, parseFields } from '../auth/credentials.js';
import { findMatches } from '../auth/login.js';
import { categoryOf, ChallengeError, nextStep, openChallenge } from '../auth/factors.js';
import { createMailer } from '../auth/mail.js';
import { providerForEmail } from '../auth/sso.js';
import { findByUsername, IdentityInUseError, isValidUsername, linkIdentity, randomUser, loginWithIdentity, signupWith, UsernameTakenError } from '../auth/users.js';
import { issueTicket, requireEmailCode, VerificationError } from '../auth/verification.js';
import type { Config } from '../config.js';
import { AUTH_TYPES, collections, type AuthType, type MfaFactor, type User } from '../db/models.js';

/** What a successful login, or a rotation, returns. */
interface SessionResponse {
  /** Session key as 16 hex digits. */
  key: string;
  expiresDate: number;
  user: { id: string; username: string };
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
  const mailer = createMailer(config, app.log);

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

  /** What a login says when it matches no one. */
  const NO_MATCH: Partial<Record<AuthType, string>> = {
    gov_id: 'No one has enrolled a government ID yet',
    coordinates: 'No one lives within a mile of there',
    reaction_time: 'No one has enrolled a reaction time yet',
    paragraph: "That doesn't sound like anyone",
  };

  function isAuthType(method: unknown): method is AuthType {
    return typeof method === 'string' && (AUTH_TYPES as readonly string[]).includes(method);
  }

  /**
   * Sends an email code when a method needs one (see requireEmailCode) and
   * replies 202 { codeSent, to }; the client repeats the request with the
   * code. Returns whether it replied.
   */
  async function sentEmailCode(method: AuthType, data: unknown, reply: FastifyReply): Promise<boolean> {
    if (method !== 'email') return false;
    const to = await requireEmailCode(db, config.authSecret, mailer, data);
    if (to === undefined) return false;
    await reply.code(202).send({ codeSent: true, to });
    return true;
  }

  /**
   * A login step with `method` matched `user`, covering its category on top
   * of `satisfied`. Returns the session, or, when the user requires more
   * categories, the challenge for the next step (src/auth/factors.ts).
   */
  async function stepResult(user: User, method: AuthType, satisfied: MfaFactor[]) {
    const next = nextStep(user, [...satisfied, categoryOf(method)], config.authSecret);
    if (next.done) return sessionResponse(await sessions.issue(user._id), user);
    return { challenge: next.challenge, remaining: next.remaining, methods: next.methods, user: publicUser(user) };
  }

  /**
   * Logs in with any non-OAuth method (src/auth/login.ts). Methods that can
   * match several users reply { candidates } instead; the client asks which
   * one they are and repeats the request with that userId. Users who require
   * several factors get { challenge, remaining, methods } until they have
   * covered enough; each later step sends the challenge back.
   */
  app.post<{ Body: { method?: unknown; data?: Record<string, unknown>; userId?: unknown; challenge?: unknown } }>(
    '/auth/login',
    async (req, reply) => {
      const { method, data, userId, challenge } = req.body ?? {};
      if (!isAuthType(method)) return reply.code(400).send({ error: 'Unknown login method' });
      if (isProvider(method)) return reply.code(400).send({ error: `Use /auth/oauth/${method}/start` });
      if (method === 'sso') return reply.code(400).send({ error: 'Use /auth/sso to find your provider' });
      if (userId !== undefined && (typeof userId !== 'string' || !/^\d{1,20}$/.test(userId))) {
        return reply.code(400).send({ error: 'Bad userId' });
      }

      try {
        // A later step must match the user the challenge names.
        const step = challenge === undefined ? undefined : openChallenge(challenge, method, config.authSecret);
        const chosen = step?.userId ?? (userId === undefined ? undefined : BigInt(userId));
        const satisfied = step?.satisfied ?? [];
        const notYou = () => reply.code(401).send({ error: "That doesn't match the account you're logging in to" });

        if (method === 'username') {
          const username = data?.username;
          if (typeof username !== 'string' || !isValidUsername(username)) return reply.code(400).send({ error: USERNAME_RULES });
          const user = await findByUsername(db, username);
          if (step && user?._id !== step.userId) return notYou();
          if (!user) return reply.code(404).send({ error: `No user named ${username}` });
          return await stepResult(user, method, satisfied);
        }

        if (method === 'lucky') {
          const user = await randomUser(db);
          if (!user) return reply.code(404).send({ error: 'There are no users to be' });
          if (step && user._id !== step.userId) return reply.code(401).send({ error: `Not this time: you got ${user.username}. Try again` });
          return await stepResult(user, method, satisfied);
        }

        if (await sentEmailCode(method, data, reply)) return reply;
        const matches = await findMatches(db, config.authSecret, method, data, chosen);
        if (step && !matches.length) return notYou();
        if (!matches.length) return reply.code(404).send({ error: NO_MATCH[method] ?? 'No one matches that' });
        if (matches.length > 1) {
          const { email } = method === 'email' ? (parseFields('email', data) as { email: string }) : {};
          return { candidates: matches.map(publicUser), ...(email && { ticket: issueTicket(config.authSecret, email) }) };
        }
        return await stepResult(matches[0], method, satisfied);
      } catch (err) {
        if (err instanceof CredentialError) return reply.code(400).send({ error: err.message });
        if (err instanceof VerificationError || err instanceof ChallengeError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    },
  );

  /** Creates a user with a username, enrolled in one login method. */
  app.post<{ Body: { username?: unknown; method?: unknown; data?: Record<string, unknown> } }>(
    '/auth/signup',
    async (req, reply) => {
      const { username, method, data } = req.body ?? {};
      if (!isAuthType(method)) return reply.code(400).send({ error: 'Unknown login method' });
      if (typeof username !== 'string' || !isValidUsername(username)) return reply.code(400).send({ error: USERNAME_RULES });
      if (method === 'lucky') return reply.code(400).send({ error: "You can't sign up by feeling lucky" });
      if (isProvider(method) || method === 'sso') {
        return reply.code(400).send({ error: 'Sign up with that provider by logging in with it' });
      }

      try {
        const enrolled = buildCredential(method, data, config.authSecret);
        if (await findByUsername(db, username)) return reply.code(409).send({ error: `${username} is taken` });
        if (await sentEmailCode(method, data, reply)) return reply;
        const user = await signupWith(db, username, enrolled);
        return sessionResponse(await sessions.issue(user._id), user);
      } catch (err) {
        if (err instanceof CredentialError) return reply.code(400).send({ error: err.message });
        if (err instanceof VerificationError) return reply.code(err.status).send({ error: err.message });
        if (err instanceof UsernameTakenError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  /** Login with SSO: which provider signs in this email's domain (src/auth/sso.ts). */
  app.get<{ Querystring: { email?: string } }>('/auth/sso', async (req, reply) => {
    const email = req.query.email ?? '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Enter an email address' });
    const provider = await providerForEmail(email);
    if (!provider) return reply.code(404).send({ error: `We don't know who signs in ${email.split('@')[1]}` });
    if (!config.oauth[provider]) return reply.code(404).send({ error: `${email.split('@')[1]} signs in with ${provider}, which isn't set up here yet` });
    return { provider };
  });

  app.get<{ Params: { provider: string }; Querystring: { redirect?: string; login_hint?: string; challenge?: string } }>(
    '/auth/oauth/:provider/start',
    async (req, reply) => {
      const { provider } = req.params;
      const client = isProvider(provider) ? config.oauth[provider] : undefined;
      if (!isProvider(provider) || !client) return reply.code(404).send({ error: 'Unknown login provider' });
      const redirect = req.query.redirect ?? '';
      // Only send session keys to known app URLs.
      if (!config.allowedRedirects.includes(redirect)) return reply.code(400).send({ error: 'Redirect not allowed' });
      const loginHint = req.query.login_hint?.slice(0, 254);
      // A later step of a multi-factor login; checked again at the callback.
      const { challenge } = req.query;
      if (challenge !== undefined) {
        try {
          openChallenge(challenge, provider, config.authSecret);
        } catch (err) {
          if (err instanceof ChallengeError) return reply.code(err.status).send({ error: err.message });
          throw err;
        }
      }
      return reply.redirect(
        authorizeUrl(provider, client, { publicUrl: config.publicUrl, secret: config.authSecret, redirect, loginHint, challenge }),
      );
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
        if (state.linkUser) {
          await linkIdentity(db, BigInt(state.linkUser), state.provider, identity);
          return finish({ linked: state.provider });
        }
        let user: User;
        let satisfied: MfaFactor[] = [];
        if (state.challenge) {
          // A later step: the provider account must belong to the user being logged in.
          const step = openChallenge(state.challenge, state.provider, config.authSecret);
          const owner = await users.findOne({ 'credentials.data.subject': `${state.provider}:${identity.subject}` });
          if (owner?._id !== step.userId) return finish({ error: "That account isn't linked to the user you're logging in to" });
          [user, satisfied] = [owner, step.satisfied];
        } else {
          user = await loginWithIdentity(db, state.provider, identity);
        }
        const next = nextStep(user, [...satisfied, categoryOf(state.provider)], config.authSecret);
        if (!next.done) {
          return finish({ challenge: next.challenge, remaining: next.remaining.join(','), methods: next.methods.join(','), username: user.username });
        }
        const issued = await sessions.issue(user._id);
        return finish({ key: formatKey(issued.key), expiresDate: String(issued.expiresDate) });
      } catch (err) {
        if (err instanceof IdentityInUseError || err instanceof ChallengeError) return finish({ error: err.message });
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

  registerAccount(app, db, { authenticate, sessions, config, sentEmailCode });
  registerTiles(app, config);

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
