/**
 * Email login codes ("Login with email: send a verification email").
 *
 * A code is 6 digits, valid for CODE_TTL and for MAX_ATTEMPTS guesses. Only
 * an HMAC of it is stored, in Verifications, so any instance can check it.
 * Asking again replaces the earlier code, at most once per RESEND_AFTER.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from 'mongodb';
import { now } from '../db/epoch.js';
import { collections } from '../db/models.js';
import { ids } from '../db/snowflake.js';
import { parseFields } from './credentials.js';
import type { Mailer } from './mail.js';

/** Seconds. */
const CODE_TTL = 10n * 60n;
const RESEND_AFTER = 30n;
const MAX_ATTEMPTS = 5;

export class VerificationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function hashCode(key: Buffer, email: string, code: string): string {
  return createHmac('sha256', key).update(`email-code\0${email}\0${code}`).digest('hex');
}

/** Emails a new code to `email` (already normalized). */
export async function sendCode(db: Db, key: Buffer, mailer: Mailer, email: string): Promise<void> {
  const verifications = collections(db).verifications;
  const t = now();
  const recent = await verifications.findOne({ email, createdDate: { $gt: t - RESEND_AFTER } });
  if (recent) throw new VerificationError('A code was just sent. Wait a moment before asking for another', 429);

  const code = String(randomInt(1_000_000)).padStart(6, '0');
  await verifications.deleteMany({ email });
  await verifications.insertOne({
    _id: ids.next(),
    email,
    codeHash: hashCode(key, email, code),
    createdDate: t,
    expiresDate: t + CODE_TTL,
    attempts: 0,
  });
  await mailer.send(email, `Your DEADBORD code is ${code}`, `Your DEADBORD login code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, ignore this email.`);
}

/** Uses up the code sent to `email`; throws VerificationError if it's wrong. */
export async function checkCode(db: Db, key: Buffer, email: string, code: string): Promise<void> {
  const verifications = collections(db).verifications;
  const pending = await verifications.findOne({ email, expiresDate: { $gt: now() } });
  if (!pending || pending.attempts >= MAX_ATTEMPTS) throw new VerificationError('That code has expired. Ask for a new one', 410);

  const expected = Buffer.from(pending.codeHash, 'hex');
  const actual = Buffer.from(hashCode(key, email, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    await verifications.updateOne({ _id: pending._id }, { $inc: { attempts: 1 } });
    throw new VerificationError('Wrong code', 401);
  }
  // Only one request can use the code.
  const { deletedCount } = await verifications.deleteOne({ _id: pending._id, attempts: pending.attempts });
  if (!deletedCount) throw new VerificationError('That code has expired. Ask for a new one', 410);
}

export async function purgeExpiredCodes(db: Db): Promise<void> {
  await collections(db).verifications.deleteMany({ expiresDate: { $lte: now() } });
}

/** How long a ticket lets a verified email pick among candidate users. */
const TICKET_TTL_MS = 5 * 60 * 1000;

const ticketMac = (key: Buffer, email: string, expires: number) =>
  createHmac('sha256', key).update(`email-ticket\0${email}\0${expires}`).digest('base64url');

/**
 * Proof that `email` was just verified. A login that matches several users
 * hands it back with the candidates, since the code is already used up.
 */
export function issueTicket(key: Buffer, email: string): string {
  const expires = Date.now() + TICKET_TTL_MS;
  return `${expires}.${ticketMac(key, email, expires)}`;
}

function checkTicket(key: Buffer, email: string, ticket: string): boolean {
  const [expiresText, mac] = ticket.split('.');
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < Date.now() || typeof mac !== 'string') return false;
  const expected = Buffer.from(ticketMac(key, email, expires));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Methods that verify an email (Login with email) go through this first.
 * Without a `code` (or `ticket`) in `data` it emails one and returns the
 * address it went to; with one it checks it and returns undefined. Throws
 * CredentialError or VerificationError.
 */
export async function requireEmailCode(db: Db, key: Buffer, mailer: Mailer, data: unknown): Promise<string | undefined> {
  const { email } = parseFields('email', data) as { email: string };
  const { code, ticket } = (data ?? {}) as { code?: unknown; ticket?: unknown };
  if (typeof ticket === 'string') {
    if (!checkTicket(key, email, ticket)) throw new VerificationError('That login expired. Ask for a new code', 410);
    return undefined;
  }
  if (code === undefined || code === '') {
    await sendCode(db, key, mailer, email);
    return email;
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new VerificationError('The code is 6 digits', 400);
  await checkCode(db, key, email, code);
  return undefined;
}
