/**
 * The logged-in user's account: username, enrolled login methods, OAuth
 * linking and account deletion. Credential data (hashes included) never
 * leaves the server; clients only see each method's type, category and date.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MongoServerError, type Db } from 'mongodb';
import { buildCredential, CredentialError } from '../auth/credentials.js';
import { availableFactors, MAX_FACTORS, requiredFactors } from '../auth/factors.js';
import { authorizeUrl, isProvider } from '../auth/oauth.js';
import type { ResolvedSession, SessionStore } from '../auth/sessions.js';
import { VerificationError } from '../auth/verification.js';
import { isValidUsername } from '../auth/users.js';
import type { Config } from '../config.js';
import { AUTH_TYPES, collections, type AuthType, type User } from '../db/models.js';

type Authenticate = (req: FastifyRequest, reply: FastifyReply) => Promise<{ session: ResolvedSession } | undefined>;

function account(user: User) {
  return {
    user: { id: user._id.toString(), username: user.username },
    credentials: user.credentials.map((c) => ({ type: c.type, mfa: c.mfa, createdDate: Number(c.createdDate) })),
    requiredFactors: requiredFactors(user),
    /** Categories the user can log in with, so the most they can require. */
    availableFactors: [...availableFactors(user)],
  };
}

function isAuthType(value: unknown): value is AuthType {
  return typeof value === 'string' && (AUTH_TYPES as readonly string[]).includes(value);
}

type SentEmailCode = (method: AuthType, data: unknown, reply: FastifyReply) => Promise<boolean>;

export function registerAccount(
  app: FastifyInstance,
  db: Db,
  deps: { authenticate: Authenticate; sessions: SessionStore; config: Config; sentEmailCode: SentEmailCode },
) {
  const { authenticate, sessions, config, sentEmailCode } = deps;
  const c = collections(db);

  /** Loads the caller's user document, or replies 401. */
  async function me(req: FastifyRequest, reply: FastifyReply): Promise<User | undefined> {
    const auth = await authenticate(req, reply);
    if (!auth) return undefined;
    const user = await c.users.findOne({ _id: auth.session.userId });
    if (!user) await reply.code(401).send({ error: 'Not logged in' });
    return user ?? undefined;
  }

  app.get('/auth/account', async (req, reply) => {
    const user = await me(req, reply);
    return user ? account(user) : reply;
  });

  /** Changes the username and/or how many factors a login needs (src/auth/factors.ts). */
  app.patch<{ Body: { username?: unknown; requiredFactors?: unknown } }>('/auth/account', async (req, reply) => {
    const user = await me(req, reply);
    if (!user) return reply;
    const { username, requiredFactors: factors } = req.body ?? {};
    const set: Partial<User> = {};
    if (username !== undefined) {
      if (typeof username !== 'string' || !isValidUsername(username)) {
        return reply.code(400).send({ error: 'Usernames are 1-32 printable ASCII characters' });
      }
      set.username = username;
    }
    if (factors !== undefined) {
      if (typeof factors !== 'number' || !Number.isInteger(factors) || factors < 1 || factors > MAX_FACTORS) {
        return reply.code(400).send({ error: `Required factors must be 1-${MAX_FACTORS}` });
      }
      const available = availableFactors(user).size;
      if (factors > available) {
        return reply.code(409).send({ error: `You can only log in with ${available} kind(s) of factor. Add a method of another kind first` });
      }
      set.requiredFactors = factors;
    }
    if (!Object.keys(set).length) return reply.code(400).send({ error: 'Nothing to change' });
    try {
      const updated = await c.users.findOneAndUpdate({ _id: user._id }, { $set: set }, { returnDocument: 'after' });
      return account(updated!);
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) return reply.code(409).send({ error: `${username} is taken` });
      throw err;
    }
  });

  /**
   * Enrolls a login method, replacing an earlier enrollment of the same
   * method. Email replies 202 { codeSent } first, like logging in.
   */
  app.post<{ Body: { method?: unknown; data?: unknown } }>('/auth/account/credentials', async (req, reply) => {
    const user = await me(req, reply);
    if (!user) return reply;
    const { method, data } = req.body ?? {};
    if (!isAuthType(method)) return reply.code(400).send({ error: 'Unknown login method' });
    let credential;
    try {
      credential = buildCredential(method, data, config.authSecret);
      if (await sentEmailCode(method, data, reply)) return reply;
    } catch (err) {
      if (err instanceof CredentialError) return reply.code(400).send({ error: err.message });
      if (err instanceof VerificationError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
    await c.users.updateOne({ _id: user._id }, { $pull: { credentials: { type: method } } });
    const updated = await c.users.findOneAndUpdate(
      { _id: user._id },
      { $push: { credentials: credential } },
      { returnDocument: 'after' },
    );
    return account(updated!);
  });

  app.delete<{ Params: { type: string } }>('/auth/account/credentials/:type', async (req, reply) => {
    const user = await me(req, reply);
    if (!user) return reply;
    const { type } = req.params;
    if (!user.credentials.some((cr) => cr.type === type)) return reply.code(404).send({ error: 'Not enrolled in that method' });
    if (user.credentials.length === 1) return reply.code(409).send({ error: "You can't remove your only login method" });
    // Removing it mustn't leave fewer kinds of factor than the user requires.
    const remaining = { ...user, credentials: user.credentials.filter((cr) => cr.type !== type) };
    if (availableFactors(remaining).size < requiredFactors(user)) {
      return reply.code(409).send({ error: "That's your only method of its kind, and you require it to log in. Lower the required factors first" });
    }
    const updated = await c.users.findOneAndUpdate(
      { _id: user._id, 'credentials.1': { $exists: true } },
      { $pull: { credentials: { type: type as AuthType } } },
      { returnDocument: 'after' },
    );
    return updated ? account(updated) : reply.code(409).send({ error: "You can't remove your only login method" });
  });

  /** Starts linking a third-party account; the client sends the browser to `url`. */
  app.post<{ Params: { provider: string }; Body: { redirect?: unknown } }>(
    '/auth/oauth/:provider/link',
    async (req, reply) => {
      const user = await me(req, reply);
      if (!user) return reply;
      const { provider } = req.params;
      const client = isProvider(provider) ? config.oauth[provider] : undefined;
      if (!isProvider(provider) || !client) return reply.code(404).send({ error: `${provider} login isn't set up yet` });
      const redirect = typeof req.body?.redirect === 'string' ? req.body.redirect : '';
      if (!config.allowedRedirects.includes(redirect)) return reply.code(400).send({ error: 'Redirect not allowed' });
      return {
        url: authorizeUrl(provider, client, {
          publicUrl: config.publicUrl,
          secret: config.authSecret,
          redirect,
          linkUser: user._id.toString(),
        }),
      };
    },
  );

  /**
   * Deletes the account. Also deletes the boards it owns (with their lists
   * and tasks, for every member), its memberships and its sessions. Its
   * comments on other people's tasks remain.
   */
  app.delete<{ Body: { confirm?: unknown } }>('/auth/account', async (req, reply) => {
    const user = await me(req, reply);
    if (!user) return reply;
    if (req.body?.confirm !== user.username) return reply.code(400).send({ error: 'Type your username to confirm' });

    const boardIds = (await c.boards.find({ createdBy: user._id }, { projection: { _id: 1 } }).toArray()).map((b) => b._id);
    const listIds = (await c.lists.find({ boardId: { $in: boardIds } }, { projection: { _id: 1 } }).toArray()).map((l) => l._id);
    await c.tasks.deleteMany({ listId: { $in: listIds } });
    await c.lists.deleteMany({ _id: { $in: listIds } });
    await c.boards.deleteMany({ _id: { $in: boardIds } });
    await c.boards.updateMany({ 'members.userId': user._id }, { $pull: { members: { userId: user._id } } });
    await sessions.revokeUser(user._id);
    await c.users.deleteOne({ _id: user._id });
    return reply.code(204).send();
  });
}
