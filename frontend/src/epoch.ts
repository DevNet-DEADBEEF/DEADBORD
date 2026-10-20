/**
 * All dates are unsigned 32-bit integer seconds since the DEADBORD epoch,
 * 2026-10-18T06:00Z (see Notion: DB Layout/Schemas).
 * Mirrors backend/src/db/epoch.ts, but as numbers.
 */

export const EPOCH_MS = Date.UTC(2026, 9, 18, 6, 0);

export const TIMESTAMP_MAX = 0xffff_ffff;

/** Seconds since the DEADBORD epoch (u32). */
export type Timestamp = number;

export function now(): Timestamp {
  return toTimestamp(new Date());
}

/** Truncates to whole seconds; throws if the date falls outside the u32 range. */
export function toTimestamp(date: Date): Timestamp {
  const ts = Math.floor((date.getTime() - EPOCH_MS) / 1000);
  if (ts < 0 || ts > TIMESTAMP_MAX) throw new RangeError(`${date.toISOString()} is outside the timestamp range`);
  return ts;
}

export function fromTimestamp(ts: Timestamp): Date {
  return new Date(ts * 1000 + EPOCH_MS);
}
