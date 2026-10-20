/**
 * Session keys.
 *
 * Every login method ends by issuing a session key bound to a user. The key
 * travels in every TDLP packet, so it is just 64 random bits; the server
 * looks it up rather than verifying a signature (64 bits is too small to hold
 * a user id plus a MAC that resists online forgery).
 *
 * - Only a 64-bit SHA-256 prefix of the key is stored, so a database leak
 *   does not leak usable keys.
 * - Lookups are cached per backend instance for CACHE_MS, so most packets
 *   never reach MongoDB. A revocation therefore takes up to CACHE_MS to reach
 *   other instances.
 * - Keys expire after SESSION_LIFETIME. A logged-in client trades its key
 *   for a fresh one with rotate(); the old key keeps working for
 *   ROTATION_GRACE so in-flight packets are not rejected, and cannot be
 *   rotated again. resolve() reports needsRotation once a key is older than
 *   ROTATE_AFTER, so the server can prompt the client.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { now, TIMESTAMP_MAX, type Timestamp } from '../db/epoch.js';
import { collections, type Session } from '../db/models.js';
import type { Id } from '../db/snowflake.js';

/** 64-bit unsigned session key. 0 is never issued, so it can mean "no session". */
export type SessionKey = bigint;

/** Seconds. */
export const SESSION_LIFETIME = 7n * 24n * 60n * 60n;
export const ROTATE_AFTER = 24n * 60n * 60n;
export const ROTATION_GRACE = 60n;

const CACHE_MS = 30_000;

export interface ResolvedSession {
  userId: Id;
  expiresDate: Timestamp;
  /** The key is old enough that the client should rotate it. */
  needsRotation: boolean;
}

export interface IssuedSession {
  key: SessionKey;
  expiresDate: Timestamp;
}

/** A key as clients see it: 16 hex digits. */
export function formatKey(key: SessionKey): string {
  return key.toString(16).padStart(16, '0');
}

export function parseKey(text: string | undefined): SessionKey | undefined {
  return text && /^[0-9a-f]{16}$/i.test(text) ? BigInt(`0x${text}`) : undefined;
}

function generateKey(): SessionKey {
  let key: SessionKey;
  do key = randomBytes(8).readBigUInt64BE();
  while (key === 0n);
  return key;
}

/** Storage id for a key: the first 64 bits of its SHA-256, as a signed BSON long. */
export function keyHash(key: SessionKey): bigint {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt.asUintN(64, key));
  return createHash('sha256').update(bytes).digest().readBigInt64BE();
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export class SessionStore {
  private readonly sessions;
  private readonly cache = new Map<bigint, { session: Session; cachedUntil: number }>();

  constructor(db: Db) {
    this.sessions = collections(db).sessions;
  }

  /** Called at the end of every successful login. */
  async issue(userId: Id): Promise<IssuedSession> {
    const key = generateKey();
    const created = now();
    const session: Session = {
      _id: keyHash(key),
      userId,
      createdDate: created,
      expiresDate: min(created + SESSION_LIFETIME, TIMESTAMP_MAX),
    };
    await this.sessions.insertOne(session);
    return { key, expiresDate: session.expiresDate };
  }

  /** Looks up the user for a packet's session key; undefined if unknown or expired. */
  async resolve(key: SessionKey): Promise<ResolvedSession | undefined> {
    const session = await this.lookup(key);
    const current = now();
    if (!session || session.expiresDate <= current) return undefined;
    return {
      userId: session.userId,
      expiresDate: session.expiresDate,
      needsRotation: session.rotatedDate === undefined && current - session.createdDate >= ROTATE_AFTER,
    };
  }

  /** Trades a valid key for a new one bound to the same user. */
  async rotate(key: SessionKey): Promise<IssuedSession | undefined> {
    const id = keyHash(key);
    const current = now();
    // Atomically claim the rotation so a key can only be rotated once.
    const old = await this.sessions.findOneAndUpdate(
      { _id: id, rotatedDate: { $exists: false }, expiresDate: { $gt: current } },
      [{ $set: { rotatedDate: current, expiresDate: { $min: ['$expiresDate', current + ROTATION_GRACE] } } }],
    );
    if (!old) return undefined;
    this.cache.delete(id);
    return this.issue(old.userId);
  }

  /** Logs out one key. */
  async revoke(key: SessionKey): Promise<void> {
    const id = keyHash(key);
    this.cache.delete(id);
    await this.sessions.deleteOne({ _id: id });
  }

  /** Logs a user out everywhere. */
  async revokeUser(userId: Id): Promise<void> {
    for (const [id, entry] of this.cache) if (entry.session.userId === userId) this.cache.delete(id);
    await this.sessions.deleteMany({ userId });
  }

  /** Deletes expired sessions; run periodically (dates are u32 longs, so a TTL index can't). */
  async purgeExpired(): Promise<number> {
    const { deletedCount } = await this.sessions.deleteMany({ expiresDate: { $lte: now() } });
    return deletedCount;
  }

  private async lookup(key: SessionKey): Promise<Session | undefined> {
    const id = keyHash(key);
    const cached = this.cache.get(id);
    if (cached && cached.cachedUntil > Date.now()) return cached.session;
    const session = (await this.sessions.findOne({ _id: id })) ?? undefined;
    if (session) this.cache.set(id, { session, cachedUntil: Date.now() + CACHE_MS });
    else this.cache.delete(id);
    return session;
  }
}
