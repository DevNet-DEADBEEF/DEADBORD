import { randomInt } from 'node:crypto';
import { MongoServerError, type Db } from 'mongodb';
import { now } from '../db/epoch.js';
import { ASCII_LINE, collections, type AuthObject, type AuthType, type MfaFactor, type User } from '../db/models.js';
import { ids } from '../db/snowflake.js';

export const USERNAME_MAX = 32;

export function isValidUsername(username: string): boolean {
  return username.length >= 1 && username.length <= USERNAME_MAX && ASCII_LINE.test(username);
}

function isDuplicateKey(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000;
}

function credential(type: AuthType, mfa: MfaFactor, data?: AuthObject['data']): AuthObject {
  return data ? { type, createdDate: now(), mfa, data } : { type, createdDate: now(), mfa };
}

/** Login With Username: no password, per the Login Methods page. */
export async function findByUsername(db: Db, username: string): Promise<User | undefined> {
  return (await collections(db).users.findOne({ username })) ?? undefined;
}

/** I'm feeling lucky: any user, chosen at random. */
export async function randomUser(db: Db): Promise<User | undefined> {
  const [user] = await collections(db).users.aggregate<User>([{ $sample: { size: 1 } }]).toArray();
  return user;
}

export class UsernameTakenError extends Error {}

/** Creates a user enrolled in one login method (built by buildCredential). */
export async function signupWith(db: Db, username: string, enrolled: AuthObject): Promise<User> {
  const user: User = { _id: ids.next(), username, createdDate: now(), credentials: [enrolled] };
  try {
    await collections(db).users.insertOne(user);
    return user;
  } catch (err) {
    if (isDuplicateKey(err)) throw new UsernameTakenError(`${username} is taken`);
    throw err;
  }
}

export class IdentityInUseError extends Error {}

/** Links a third-party identity to an existing user (replacing any earlier link to the same provider). */
export async function linkIdentity(
  db: Db,
  userId: User['_id'],
  provider: AuthType,
  identity: { subject: string },
): Promise<void> {
  const users = collections(db).users;
  const subject = `${provider}:${identity.subject}`;
  const owner = await users.findOne({ 'credentials.data.subject': subject }, { projection: { _id: 1 } });
  if (owner && owner._id !== userId) throw new IdentityInUseError('That account is already linked to another user');
  await users.updateOne({ _id: userId }, { $pull: { credentials: { type: provider } } });
  await users.updateOne({ _id: userId }, { $push: { credentials: credential(provider, 'has', { subject }) } });
}

/** Turns a provider display name into a valid username stem. */
function usernameStem(name: string | undefined): string {
  const ascii = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii.slice(0, USERNAME_MAX - 5) || 'user';
}

/**
 * Finds the user who owns a third-party identity, creating one on first login.
 * Identities are stored as `<provider>:<subject>` in a credential's data.subject.
 */
export async function loginWithIdentity(
  db: Db,
  provider: AuthType,
  identity: { subject: string; name?: string },
): Promise<User> {
  const users = collections(db).users;
  const subject = `${provider}:${identity.subject}`;
  const existing = await users.findOne({ 'credentials.data.subject': subject });
  if (existing) return existing;

  const stem = usernameStem(identity.name);
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = attempt === 0 ? stem : `${stem}_${randomInt(10_000)}`;
    const user: User = {
      _id: ids.next(),
      username,
      createdDate: now(),
      credentials: [credential(provider, 'has', { subject })],
    };
    try {
      await users.insertOne(user);
      return user;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Either the username is taken (retry with a suffix) or the identity was registered concurrently.
      const raced = await users.findOne({ 'credentials.data.subject': subject });
      if (raced) return raced;
    }
  }
  throw new Error('Could not find a free username');
}
