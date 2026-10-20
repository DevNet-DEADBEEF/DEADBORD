/**
 * 64-bit snowflake IDs:
 *
 *   | 41 bits: ms since DEADBORD epoch | 10 bits: worker | 12 bits: sequence |
 *
 * IDs exceed Number.MAX_SAFE_INTEGER, so they are bigints in code and must be
 * sent to clients as decimal strings.
 */

import { EPOCH_MS } from './epoch.js';

const WORKER_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_WORKER = (1n << WORKER_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

export type Id = bigint;

export class Snowflake {
  private readonly worker: bigint;
  private lastMs = -1n;
  private sequence = 0n;

  /** `worker` must be unique per running backend instance (0-1023). */
  constructor(worker: number) {
    this.worker = BigInt(worker);
    if (this.worker < 0n || this.worker > MAX_WORKER) throw new RangeError(`worker must be 0-${MAX_WORKER}`);
  }

  next(): Id {
    let ms = BigInt(Date.now() - EPOCH_MS);
    if (ms < this.lastMs) ms = this.lastMs; // clock went backwards; hold position
    if (ms === this.lastMs) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // Sequence exhausted for this ms; wait for the next one.
        while (BigInt(Date.now() - EPOCH_MS) <= ms);
        ms += 1n;
      }
    } else {
      this.sequence = 0n;
    }
    this.lastMs = ms;
    return (ms << (WORKER_BITS + SEQUENCE_BITS)) | (this.worker << SEQUENCE_BITS) | this.sequence;
  }
}

export const ids = new Snowflake(Number(process.env.WORKER_ID ?? 0));
