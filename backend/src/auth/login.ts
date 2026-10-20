/**
 * Logging in with a form-based method: finds the users a login matches,
 * using the method's matcher (MethodSpec.login in credentials.ts). Per the
 * Login Methods page, when a login matches several users the client asks
 * which one they are, then repeats the login naming that user.
 */

import type { Db, Filter } from 'mongodb';
import { collections, type AuthType, type User } from '../db/models.js';
import type { Id } from '../db/snowflake.js';
import { parseFields, secretLookup, specOf, verifySecret } from './credentials.js';

/** At most this many users are offered when a login matches several. */
export const CANDIDATE_LIMIT = 20;

/** "Select a place on earth and login with the closest user within 1 mile." */
const PLACE_RADIUS_M = 1609.344;
const EARTH_RADIUS_M = 6_371_008.8;

/** A paragraph must be at least this similar (cosine, 0-1) to count as you. */
const MIN_SIMILARITY = 0.1;
/** Paragraphs compared per login. */
const PARAGRAPH_SCAN_LIMIT = 10_000;

const credentialOf = (user: User, type: AuthType) => user.credentials.find((c) => c.type === type);

/**
 * Finds who a login matches. `data` is the method's input, `chosen` the user
 * picked from an earlier list of candidates. Throws CredentialError for bad
 * input. Email codes are checked by the caller before this runs.
 */
export async function findMatches(db: Db, key: Buffer, type: AuthType, data: unknown, chosen?: Id): Promise<User[]> {
  const spec = specOf(type);
  const users = collections(db).users;
  const enrolled: Filter<User> = { 'credentials.type': type };
  const only = (found: User[]) => (chosen === undefined ? found : found.filter((u) => u._id === chosen));

  // A random pick can't confirm a particular user, so for a chosen user (or a
  // later multi-factor step) random methods check what was typed instead.
  const by = spec.login.by === 'random' && chosen !== undefined ? 'exact' : spec.login.by;

  switch (by) {
    case 'random': {
      // "Pick a random user enrolled with gov id": what was typed doesn't matter.
      const [user] = await users.aggregate<User>([{ $match: enrolled }, { $sample: { size: 1 } }]).toArray();
      return user ? [user] : [];
    }

    case 'exact':
    case 'email': {
      const fields = parseFields(type, data);
      const match: Record<string, unknown> = { type };
      const secrets: [string, string][] = [];
      for (const [name, value] of Object.entries(fields)) {
        const field = spec.fields[name];
        if (field.kind === 'string' && field.secret) {
          match[`data.${name}.lookup`] = secretLookup(key, type, name, value as string);
          secrets.push([name, value as string]);
        } else {
          match[`data.${name}`] = value;
        }
      }
      const filter: Filter<User> = { credentials: { $elemMatch: match } };
      if (chosen !== undefined) filter._id = chosen;
      const found = await users.find(filter).limit(CANDIDATE_LIMIT).toArray();
      // The lookup HMAC finds them; the scrypt hash confirms.
      const checked = await Promise.all(
        found.map(async (user) => {
          const stored = credentialOf(user, type)?.data ?? {};
          for (const [name, value] of secrets) if (!(await verifySecret(stored[name], value))) return undefined;
          return user;
        }),
      );
      return checked.filter((u): u is User => u !== undefined);
    }

    case 'nearest': {
      const field = (spec.login as { field: string }).field;
      const value = parseFields(type, data)[field] as number;
      const ranked = await users
        .aggregate<User & { distance: number }>([
          { $match: enrolled },
          { $addFields: { credential: { $first: { $filter: { input: '$credentials', cond: { $eq: ['$$this.type', type] } } } } } },
          { $addFields: { distance: { $abs: { $subtract: [`$credential.data.${field}`, value] } } } },
          { $sort: { distance: 1, _id: 1 } },
          { $limit: CANDIDATE_LIMIT },
          { $project: { credential: 0 } },
        ])
        .toArray();
      // Everyone tied for closest.
      return only(ranked.filter((u) => u.distance === ranked[0].distance).map(({ distance: _, ...user }): User => user));
    }

    case 'place': {
      const { lat, lng } = parseFields(type, data) as { lat: number; lng: number };
      const nearby = await users.find({ credentials: { $elemMatch: { type, ...boundingBox(lat, lng, PLACE_RADIUS_M) } } }).toArray();
      const ranked = nearby
        .map((user) => {
          const at = credentialOf(user, type)!.data as { lat: number; lng: number };
          return { user, distance: haversine(lat, lng, at.lat, at.lng) };
        })
        .filter((r) => r.distance <= PLACE_RADIUS_M)
        .sort((a, b) => a.distance - b.distance);
      return only(ranked.filter((r) => r.distance === ranked[0].distance).map((r) => r.user)).slice(0, CANDIDATE_LIMIT);
    }

    case 'similar': {
      const { paragraph } = parseFields(type, data) as { paragraph: string };
      const enrollees = await users.find(enrolled).limit(PARAGRAPH_SCAN_LIMIT).toArray();
      const scores = similarities(
        paragraph,
        enrollees.map((u) => String(credentialOf(u, type)?.data?.paragraph ?? '')),
      );
      const best = Math.max(0, ...scores);
      if (best < MIN_SIMILARITY) return [];
      return only(enrollees.filter((_, i) => best - scores[i] < 1e-9)).slice(0, CANDIDATE_LIMIT);
    }
  }
}

// --- Coordinates -------------------------------------------------------------

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** An $elemMatch filter on data.lat/data.lng covering every point within `radius` meters. */
function boundingBox(lat: number, lng: number, radius: number): Record<string, unknown> {
  const dLat = (radius / EARTH_RADIUS_M) * (180 / Math.PI);
  const latRange = { $gte: lat - dLat, $lte: lat + dLat };
  const cos = Math.cos(toRad(Math.min(90, Math.abs(lat) + dLat)));
  // Near the poles every longitude is close by.
  if (cos < 1e-6) return { 'data.lat': latRange };
  const dLng = dLat / cos;
  if (dLng >= 180) return { 'data.lat': latRange };
  const lo = lng - dLng;
  const hi = lng + dLng;
  // Boxes that cross the antimeridian wrap around to the other side.
  if (lo < -180) return { 'data.lat': latRange, $or: [{ 'data.lng': { $gte: lo + 360 } }, { 'data.lng': { $lte: hi } }] };
  if (hi > 180) return { 'data.lat': latRange, $or: [{ 'data.lng': { $gte: lo } }, { 'data.lng': { $lte: hi - 360 } }] };
  return { 'data.lat': latRange, 'data.lng': { $gte: lo, $lte: hi } };
}

// --- Paragraphs --------------------------------------------------------------

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other
  our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when where which while who whom why will
  with would you your yours yourself yourselves im ive dont`.split(/\s+/),
);

/** Lowercase words without stopwords, with plural and verb endings trimmed. */
function terms(text: string): string[] {
  return (text.toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w));
}

/**
 * TF-IDF cosine similarity of `query` to each document (0-1). Words that
 * many enrolled paragraphs share count for little; distinctive ones for a lot.
 */
export function similarities(query: string, documents: string[]): number[] {
  const docs = documents.map(terms);
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((docs.length + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  function vector(words: string[]): Map<string, number> {
    const v = new Map<string, number>();
    for (const w of words) v.set(w, (v.get(w) ?? 0) + 1);
    for (const [w, tf] of v) v.set(w, tf * idf(w));
    return v;
  }
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((sum, x) => sum + x * x, 0));

  const q = vector(terms(query));
  const qNorm = norm(q);
  return docs.map((doc) => {
    const d = vector(doc);
    const dNorm = norm(d);
    if (!qNorm || !dNorm) return 0;
    let dot = 0;
    for (const [w, x] of q) dot += x * (d.get(w) ?? 0);
    return dot / (qNorm * dNorm);
  });
}
