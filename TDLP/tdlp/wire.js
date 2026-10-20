import { createCipheriv, createDecipheriv } from 'node:crypto';
export const Message = Object.freeze({ HI: 0, BYE: 1, REJECT: 2, KEY: 3, ENCRYPT: 4, INIT: 5, GIMME: 6, TAKE: 7, HUH: 8, BUGOFF: 9 });
export const EPOCH_MS = Date.UTC(2026, 9, 18, 6);
export const now = () => Math.floor((Date.now() - EPOCH_MS) / 1000);
export function header(connectionId, packetId) {
  const b = Buffer.alloc(6); b.writeUInt32BE(connectionId); b.writeUInt16BE(packetId, 4); return b;
}
export function plain(connectionId, packetId, type, payload = Buffer.alloc(0)) {
  if (!Number.isInteger(type) || type < 0 || type > 9) throw new RangeError('Invalid message');
  return Buffer.concat([header(connectionId, packetId), Buffer.from([type << 4]), payload]);
}
export function parsePlain(data) {
  const b = Buffer.from(data);
  if (b.length < 7 || b[6] & 15 || b[6] >> 4 > 9) throw new TypeError('Invalid TDLP packet');
  return { connectionId: b.readUInt32BE(), packetId: b.readUInt16BE(4), type: b[6] >> 4, payload: b.subarray(7) };
}
/** Wire: connection ID (4), packet ID (2), encryption counter (2), ciphertext. */
export class Cipher {
  constructor(key, sendPrefix, receivePrefix) {
    this.key = Buffer.from(key); this.sendPrefix = Buffer.from(sendPrefix); this.receivePrefix = Buffer.from(receivePrefix);
    if (this.key.length !== 32 || this.sendPrefix.length !== 8 || this.receivePrefix.length !== 8 || this.sendPrefix.equals(this.receivePrefix)) throw new TypeError('Invalid key or direction prefixes');
    this.counter = 0;
  }
  iv(prefix, counter) { const iv = Buffer.alloc(16); prefix.copy(iv); iv.writeUInt16BE(counter, 8); return iv; }
  encrypt(connectionId, packetId, type, payload) {
    if (this.counter >= 65536) throw new Error('Encryption counter exhausted; establish a new connection');
    const counter = this.counter++;
    const c = createCipheriv('aes-256-ctr', this.key, this.iv(this.sendPrefix, counter));
    const source = plain(connectionId, packetId, type, payload);
    const count = Buffer.alloc(2); count.writeUInt16BE(counter);
    return Buffer.concat([source.subarray(0, 6), count, c.update(source.subarray(6)), c.final()]);
  }
  decrypt(data) {
    const b = Buffer.from(data);
    if (b.length < 9) throw new TypeError('Truncated encrypted packet');
    const counter = b.readUInt16BE(6);
    const c = createDecipheriv('aes-256-ctr', this.key, this.iv(this.receivePrefix, counter));
    return { ...parsePlain(Buffer.concat([b.subarray(0, 6), c.update(b.subarray(8)), c.final()])), counter };
  }
}
