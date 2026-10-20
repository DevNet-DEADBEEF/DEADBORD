import { randomUUID } from 'node:crypto';
import { encode as encodeTlon, decode as decodeTlon } from '@deadbord/tlon';

export const Scope = Object.freeze({ Board: 0, List: 1, Task: 2 });
export const Action = Object.freeze({ Create: 0, Update: 1, Delete: 2, Obtain: 3, UpdatePerm: 4 });
export const Response = Object.freeze({ Done: 0, Reject: 1, Nope: 2, Conflict: 3 });
export const MAX_PAYLOAD = 500;
export const newActionId = randomUUID;
const hasVersion = p => p.response ? p.code === 0 : [1, 2, 4].includes(p.code);

function validate(p) {
  if (typeof p.response !== 'boolean') throw new TypeError('response must be boolean');
  if (!Number.isInteger(p.scope) || p.scope < 0 || p.scope > 2) throw new RangeError('Invalid scope');
  if (!Number.isInteger(p.code) || p.code < 0 || p.code > (p.response ? 3 : 4)) throw new RangeError('Invalid action');
  if (!p.response && p.code === 4 && p.scope !== 0) throw new RangeError('UPDATE_PERM requires board scope');
  if (typeof p.scopeId !== 'bigint' || p.scopeId < 0n || p.scopeId > 0xffffffffffffffffn) throw new RangeError('Invalid scope ID');
  if (!p.response && p.code === 0 && p.scopeId !== 0n) throw new RangeError('CREATE requires scope ID zero');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.actionId)) throw new TypeError('Invalid action UUID');
  if (hasVersion(p)) {
    if (!Number.isInteger(p.version) || p.version < 0 || p.version > 0xffffffff) throw new RangeError('Invalid version');
  } else if (p.version !== undefined) throw new TypeError('Version is not permitted on this packet');
  const payload = p.payload ?? [];
  const bytes = encodeTlon(payload);
  if (bytes.length > MAX_PAYLOAD) throw new RangeError('LMP payload exceeds 500 bytes');
  if (p.response && p.code === 1 && payload.length) throw new TypeError('REJECT has no payload');
  if (p.response && p.code === 2 && (payload.length !== 1 || payload[0].length !== 1)) throw new TypeError('NOPE needs one message');
  if (p.response && p.code === 3 && (payload.length !== 2 || payload.some(e => e.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(e[0]) || BigInt(e[0]) > 0xffffffffn))) throw new TypeError('CONFLICT needs expected and current versions');
  if (!p.response && p.code === 2 && payload.length) throw new TypeError('DELETE has no payload');
  if (!p.response && p.scope === 2 && p.code === 0 && (payload.length !== 1 || payload[0].length !== 1)) throw new TypeError('Task CREATE needs one name');
  if (!p.response && [1,3,4].includes(p.code)) {
    if (!payload.length) throw new TypeError('Action requires at least one property');
    for (const row of payload) {
      const comment = row[0] === 'comments' && p.scope === 2 && p.code !== 4;
      const width = p.code === 3 ? (comment ? 2 : 1) : (comment ? 3 : 2);
      if (row.length !== width || !row[0] || (comment && !/^(0|[1-9][0-9]*)$/.test(row[1]))) throw new TypeError('Invalid action property');
    }
  }
  return bytes;
}

export function encode(packet) {
  const payload = validate(packet);
  const header = Buffer.alloc(hasVersion(packet) ? 29 : 25);
  header[0] = (packet.response ? 128 : 0) | (packet.scope << 5) | (packet.code << 2);
  header.writeBigUInt64BE(packet.scopeId, 1);
  Buffer.from(packet.actionId.replaceAll('-', ''), 'hex').copy(header, 9);
  if (hasVersion(packet)) header.writeUInt32BE(packet.version, 25);
  return Buffer.concat([header, payload]);
}

export function decode(data) {
  const b = Buffer.from(data);
  if (b.length < 25 || b[0] & 3) throw new TypeError('Invalid LMP header');
  const hex = b.subarray(9, 25).toString('hex');
  const p = { response: !!(b[0] & 128), scope: (b[0] >> 5) & 3, code: (b[0] >> 2) & 7,
    scopeId: b.readBigUInt64BE(1), actionId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` };
  const offset = hasVersion(p) ? 29 : 25;
  if (b.length < offset) throw new TypeError('Truncated LMP version');
  if (hasVersion(p)) p.version = b.readUInt32BE(25);
  p.payload = decodeTlon(b.subarray(offset));
  validate(p);
  return p;
}

export function resourceId(scope, id) {
  if (!Number.isInteger(scope) || scope < 0 || scope > 2 || typeof id !== 'bigint' || id < 0n || id > 0xffffffffffffffffn) throw new RangeError('Invalid resource');
  return ((BigInt(scope) << 64n) | id).toString();
}

export function parseResourceId(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError('Invalid resource ID');
  const n = BigInt(value);
  if (n >> 64n > 2n) throw new RangeError('Reserved resource scope');
  return { scope: Number(n >> 64n), id: n & 0xffffffffffffffffn };
}

/** Deduplicates in-flight and completed actions. Share one dispatcher across connections. */
export class Dispatcher {
  constructor(handler, { ttlMs = Infinity, maxEntries = 10000 } = {}) {
    if (typeof handler !== 'function' || !(ttlMs > 0) || !Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('Invalid dispatcher options');
    this.handler = handler; this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.cache = new Map();
  }
  async dispatch(request, context, principal) {
    if (typeof principal !== 'string' || !principal) throw new TypeError('A stable authenticated principal is required');
    if (request.response) throw new TypeError('Expected an action');
    const original = encode(request);
    const key = JSON.stringify([principal, request.actionId.toLowerCase()]);
    const now = Date.now();
    for (const [k,v] of this.cache) if (v.expires <= now) this.cache.delete(k);
    const found = this.cache.get(key);
    if (found) {
      if (!found.original.equals(original)) throw new Error('Action ID reused with different contents');
      return decode(await found.promise);
    }
    if (this.cache.size >= this.maxEntries) throw new Error('Action cache capacity reached');
    const entry = { original, expires: Infinity };
    entry.promise = Promise.resolve().then(() => this.handler(request, context)).then(result => {
      const response = { ...result, response: true, scope: request.scope, scopeId: request.scopeId, actionId: request.actionId };
      return encode(response);
    }).catch(() => encode({ response: true, scope: request.scope, scopeId: request.scopeId, actionId: request.actionId, code: 2, payload: [['Action handler failed']] }))
      .finally(() => { entry.expires = Date.now() + this.ttlMs; });
    this.cache.set(key, entry);
    return decode(await entry.promise);
  }
}
