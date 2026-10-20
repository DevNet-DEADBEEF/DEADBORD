/**
 * Multi-factor login. A user can require that a login covers 1-3 MFA
 * categories: something they know, have, or are. Each login method belongs
 * to one category (from the Login Methods page): form methods declare theirs
 * in credentials.ts, OAuth and SSO are "has", username is "knows" and I'm
 * feeling lucky is "is".
 *
 * When a login step succeeds but more categories are needed, the server
 * replies with a challenge: a sealed token naming the user and the
 * categories covered so far. The next step sends it back, must use a method
 * from a category not yet covered, and must match the same user.
 */

import { AUTH_TYPES, type AuthType, type MfaFactor, type User } from '../db/models.js';
import { ENROLLABLE } from './credentials.js';
import { isProvider } from './oauth.js';
import { seal, unseal } from './seal.js';

export const MAX_FACTORS = 3;

/** How long a user has to finish the remaining steps. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

interface Challenge {
  userId: string;
  satisfied: MfaFactor[];
  expires: number;
}

export function categoryOf(type: AuthType): MfaFactor {
  if (type === 'username') return 'knows';
  if (type === 'lucky') return 'is';
  if (isProvider(type) || type === 'sso') return 'has';
  return ENROLLABLE[type]?.mfa ?? 'has';
}

export function requiredFactors(user: User): number {
  return user.requiredFactors ?? 1;
}

/**
 * Categories the user can log in with: those of their enrolled methods, plus
 * "knows", since anyone can log in with a username. (Lucky would make "is"
 * always available too, but only by chance, so it doesn't count.)
 */
export function availableFactors(user: User): Set<MfaFactor> {
  return new Set<MfaFactor>(['knows', ...user.credentials.map((c) => categoryOf(c.type))]);
}

/** Methods that could cover one of `categories` for this user. */
function methodsFor(user: User, categories: MfaFactor[]): AuthType[] {
  const enrolled = new Set(user.credentials.map((c) => c.type));
  return AUTH_TYPES.filter(
    (t) => categories.includes(categoryOf(t)) && (enrolled.has(t) || t === 'username' || t === 'lucky'),
  );
}

export type LoginStep =
  | { done: true }
  | { done: false; challenge: string; remaining: MfaFactor[]; methods: AuthType[] };

/** After a step covered `satisfied`: either the login is complete, or the challenge for the next step. */
export function nextStep(user: User, satisfied: MfaFactor[], secret: Buffer): LoginStep {
  if (new Set(satisfied).size >= requiredFactors(user)) return { done: true };
  const remaining = [...availableFactors(user)].filter((f) => !satisfied.includes(f));
  const challenge = seal<Challenge>({ userId: user._id.toString(), satisfied, expires: Date.now() + CHALLENGE_TTL_MS }, secret);
  return { done: false, challenge, remaining, methods: methodsFor(user, remaining) };
}

export class ChallengeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const CATEGORY_NAMES: Record<MfaFactor, string> = { knows: 'something you know', has: 'something you have', is: 'something you are' };

/** Opens a challenge for a step logging in with `type`. Throws ChallengeError. */
export function openChallenge(sealed: unknown, type: AuthType, secret: Buffer): { userId: bigint; satisfied: MfaFactor[] } {
  const challenge = typeof sealed === 'string' ? unseal<Challenge>(sealed, secret) : undefined;
  if (!challenge || !/^\d+$/.test(challenge.userId)) throw new ChallengeError('That login took too long. Start over', 410);
  const category = categoryOf(type);
  if (challenge.satisfied.includes(category)) {
    throw new ChallengeError(`You already used ${CATEGORY_NAMES[category]}. Pick a method from another category`, 400);
  }
  return { userId: BigInt(challenge.userId), satisfied: challenge.satisfied };
}
