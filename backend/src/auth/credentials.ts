/**
 * Login method credentials. Each method from the Login Methods page declares
 * its MFA category, the fields it stores, and how logging in with it picks a
 * user (src/auth/login.ts).
 *
 * Secrets are stored as { hash, salt, lookup }: a salted scrypt hash, plus an
 * HMAC of the value keyed with AUTH_SECRET. Logins query by `lookup` (since a
 * salted hash can't be searched), then check the scrypt hash. Everything else
 * is stored as given, after normalizing (e.g. emails lowercased), so logins
 * can match it exactly.
 */

import { createHmac, randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { now } from '../db/epoch.js';
import { ASCII_LINE, ASCII_TEXT, TEXT_MAX, type AuthObject, type AuthType, type MfaFactor } from '../db/models.js';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

type Field =
  | {
      kind: 'string';
      pattern?: RegExp;
      max?: number;
      min?: number;
      multiline?: boolean;
      /** Applied before the other checks, at enrollment and at login alike. */
      normalize?(v: string): string;
      check?(v: string): boolean;
      secret?: boolean;
    }
  | { kind: 'number'; min?: number; max?: number; integer?: boolean };

/**
 * How a login with the method finds users (src/auth/login.ts):
 * - exact: every field matches; several matches ask which user you are.
 * - random: any user enrolled in the method.
 * - nearest: the closest value of `field`; ties ask which user you are.
 * - place: the closest user within a mile.
 * - similar: the most similar paragraph.
 * - email: emails a code first, then matches exactly.
 */
export type Matcher = { by: 'exact' | 'random' | 'place' | 'similar' | 'email' } | { by: 'nearest'; field: string };

export interface MethodSpec {
  mfa: MfaFactor;
  fields: Record<string, Field>;
  login: Matcher;
}

export type Secret = { hash: string; salt: string; lookup: string };

const str = (opts: Omit<Extract<Field, { kind: 'string' }>, 'kind'> = {}): Field => ({ kind: 'string', ...opts });
const num = (opts: Omit<Extract<Field, { kind: 'number' }>, 'kind'> = {}): Field => ({ kind: 'number', ...opts });

/** Trims, collapses runs of whitespace and lowercases. */
const loose = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
const digits = (v: string) => v.replace(/\D/g, '');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const exact: Matcher = { by: 'exact' };

const CARD: MethodSpec = {
  mfa: 'has',
  fields: {
    number: str({ normalize: digits, pattern: /^\d{13,19}$/, secret: true }),
    exp: str({ pattern: /^(0[1-9]|1[0-2])\/\d\d$/ }),
    cvv: str({ pattern: /^\d{3,4}$/, secret: true }),
  },
  login: exact,
};

/**
 * Methods that can be enrolled with a form. OAuth methods (and SSO, which
 * picks one) are linked instead; lucky can't be enrolled.
 */
export const ENROLLABLE: Partial<Record<AuthType, MethodSpec>> = {
  username: { mfa: 'knows', fields: {}, login: exact },
  password: { mfa: 'knows', fields: { password: str({ min: 8, max: 128, secret: true }) }, login: exact },
  pin: { mfa: 'knows', fields: { pin: str({ pattern: /^\d{4,8}$/, secret: true }) }, login: exact },
  security_question: {
    mfa: 'knows',
    fields: {
      question: str({ max: 200, normalize: loose, check: (q) => q.length > 1 && q.endsWith('?') }),
      answer: str({ min: 1, max: 200, normalize: loose, secret: true }),
    },
    login: exact,
  },
  favorite_color: { mfa: 'knows', fields: { color: str({ normalize: (c) => c.toLowerCase(), pattern: /^#[0-9a-f]{6}$/ }) }, login: exact },
  favorite_number: { mfa: 'knows', fields: { number: num() }, login: exact },
  birthday: { mfa: 'knows', fields: { birthday: str({ pattern: /^\d{4}-\d{2}-\d{2}$/ }) }, login: exact },
  slider: { mfa: 'knows', fields: { position: num({ min: 0, max: 1000, integer: true }) }, login: exact },
  billing_address: {
    mfa: 'knows',
    fields: {
      street: str({ min: 1, max: 100, normalize: loose }),
      city: str({ min: 1, max: 60, normalize: loose }),
      state: str({ normalize: (s) => s.trim().toUpperCase(), pattern: /^[A-Z]{2}$/ }),
      zip: str({ normalize: (z) => z.trim(), pattern: /^\d{5}$/ }),
    },
    login: exact,
  },
  bank: {
    mfa: 'knows',
    fields: {
      routing: str({ normalize: digits, pattern: /^\d{9}$/, secret: true }),
      account: str({ normalize: digits, pattern: /^\d{4,17}$/, secret: true }),
    },
    login: exact,
  },
  coordinates: { mfa: 'knows', fields: { lat: num({ min: -90, max: 90 }), lng: num({ min: -180, max: 180 }) }, login: { by: 'place' } },
  blood_type: { mfa: 'is', fields: { bloodType: str({ normalize: (b) => b.trim().toUpperCase(), pattern: /^(A|B|AB|O)[+-]$/ }) }, login: exact },
  reaction_time: { mfa: 'is', fields: { ms: num({ min: 50, max: 10_000, integer: true }) }, login: { by: 'nearest', field: 'ms' } },
  paragraph: {
    mfa: 'is',
    fields: { paragraph: str({ max: TEXT_MAX, multiline: true, normalize: (p) => p.trim(), check: (p) => p.split(/\s+/).length >= 5 }) },
    login: { by: 'similar' },
  },
  // Phone numbers are stored as digits, without a leading US country code.
  phone: {
    mfa: 'has',
    fields: { phone: str({ max: 20, normalize: (p) => digits(p).replace(/^1(?=\d{10}$)/, ''), pattern: /^\d{10,15}$/ }) },
    login: exact,
  },
  email: { mfa: 'has', fields: { email: str({ max: 254, normalize: (e) => e.trim().toLowerCase(), pattern: EMAIL }) }, login: { by: 'email' } },
  gov_id: {
    mfa: 'has',
    fields: { idNumber: str({ normalize: (id) => id.trim().toUpperCase(), pattern: /^[A-Z0-9]{4,20}$/, secret: true }) },
    login: { by: 'random' },
  },
  credit_card: CARD,
  debit_card: CARD,
};

export class CredentialError extends Error {}

export function specOf(type: AuthType): MethodSpec {
  const spec = ENROLLABLE[type];
  if (!spec) throw new CredentialError(`You can't use ${type} here`);
  return spec;
}

/** Keyed hash of a secret, so logins can find it. Bound to the method and field. */
export function secretLookup(key: Buffer, type: AuthType, field: string, value: string): string {
  return createHmac('sha256', key).update(`${type}.${field}\0${value}`).digest('hex').slice(0, 32);
}

export function sealSecret(key: Buffer, type: AuthType, field: string, value: string): Secret {
  const salt = randomBytes(16);
  return { hash: scryptSync(value, salt, 32).toString('hex'), salt: salt.toString('hex'), lookup: secretLookup(key, type, field, value) };
}

export async function verifySecret(stored: unknown, value: string): Promise<boolean> {
  const s = stored as Partial<Secret> | undefined;
  if (typeof s?.hash !== 'string' || typeof s.salt !== 'string') return false;
  const expected = Buffer.from(s.hash, 'hex');
  const actual = await scrypt(value, Buffer.from(s.salt, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

/**
 * Validates and normalizes a method's input. Secrets stay in the clear here;
 * buildCredential seals them. Throws CredentialError.
 */
export function parseFields(type: AuthType, input: unknown): Record<string, string | number> {
  const spec = specOf(type);
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const data: Record<string, string | number> = {};
  for (const [name, field] of Object.entries(spec.fields)) {
    const value = given[name];
    if (field.kind === 'number') {
      const n = value;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new CredentialError(`${name} must be a number`);
      if ((field.integer && !Number.isInteger(n)) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
        throw new CredentialError(`${name} is out of range`);
      }
      data[name] = n;
      continue;
    }
    if (typeof value !== 'string') throw new CredentialError(`${name} is required`);
    if (!(field.multiline ? ASCII_TEXT : ASCII_LINE).test(value)) throw new CredentialError(`${name} must be ASCII`);
    const v = field.normalize ? field.normalize(value) : value;
    if ((field.min !== undefined && v.length < field.min) || v.length > (field.max ?? TEXT_MAX)) {
      throw new CredentialError(`${name} has the wrong length`);
    }
    if ((field.pattern && !field.pattern.test(v)) || (field.check && !field.check(v))) {
      throw new CredentialError(`${name} isn't valid`);
    }
    data[name] = v;
  }
  return data;
}

/** Validates a method's input and builds the credential to store. Throws CredentialError. */
export function buildCredential(type: AuthType, input: unknown, key: Buffer): AuthObject {
  const spec = specOf(type);
  const parsed = parseFields(type, input);
  const data: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parsed)) {
    const field = spec.fields[name];
    data[name] = field.kind === 'string' && field.secret ? sealSecret(key, type, name, value as string) : value;
  }
  const credential: AuthObject = { type, createdDate: now(), mfa: spec.mfa };
  if (Object.keys(data).length) credential.data = data;
  return credential;
}
