/**
 * TLON (Task List Object Notation) — the TDLP wire format.
 *
 * The format itself is not specified yet; this is the seam the rest of the
 * protocol codes against so the encoding can be swapped in later.
 */

import type { AnyPacket } from './packet.js';

export interface TlonCodec {
  encode(packet: AnyPacket): Uint8Array;
  /** Throws TlonDecodeError on malformed input. */
  decode(data: Uint8Array): AnyPacket;
}

export class TlonDecodeError extends Error {
  override name = 'TlonDecodeError';
}
