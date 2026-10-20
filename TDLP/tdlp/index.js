import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { randomBytes, publicEncrypt, privateDecrypt, constants } from 'node:crypto';
import { encode as tlon, decode as untlon } from '@deadbord/tlon';
import { encode as lmp, decode as unlmp, parseResourceId } from '@deadbord/lmp';
import { Cipher, Message as M, plain, parsePlain, now } from './wire.js';
export { Message, EPOCH_MS, now } from './wire.js';

const rsa = key => ({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' });
const empty = Buffer.alloc(0);
const numeric = (s, max) => {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s) || BigInt(s) > BigInt(max)) throw new TypeError('Invalid unsigned integer');
  return Number(s);
};
function fields(payload, lengths) {
  const rows = untlon(payload);
  if (rows.length !== lengths.length || rows.some((r,i) => lengths[i] !== null && r.length !== lengths[i])) throw new TypeError('Invalid control payload');
  return rows;
}
function options(o) {
  const result = { retryMs: 250, maxRetries: 8, ...o };
  if (!Number.isInteger(result.retryMs) || result.retryMs < 10 || !Number.isInteger(result.maxRetries) || result.maxRetries < 0 || result.maxRetries > 100) throw new RangeError('Invalid retry options');
  return result;
}
function bind(socket, port = 0, host = '127.0.0.1') {
  return new Promise((resolve,reject) => {
    const error = e => { socket.off('listening', ready); reject(e); };
    const ready = () => { socket.off('error', error); resolve(socket.address()); };
    socket.once('error', error); socket.once('listening', ready); socket.bind(port, host);
  });
}
function safeClose(socket) { try { socket.close(); } catch {} }

/** One client connection carries one predetermined batch of LMP actions. */
export class Client extends EventEmitter {
  constructor(input) {
    super(); this.options = options(input);
    if (!input?.publicKey || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new TypeError('publicKey and UDP port required');
    this.state = 'idle'; this.id = 0; this.pending = new Map(); this.seen = new Map();
  }
  send(bytes) { if (this.socket) this.socket.send(bytes, this.options.port, this.address, e => { if (e) this.fail(e); }); }
  wait(id, bytes, expected) {
    return new Promise((resolve,reject) => {
      const p = { bytes, expected, resolve, reject, retries: 0 };
      p.timer = setInterval(() => {
        if (p.retries++ >= this.options.maxRetries) this.fail(new Error('Response retry limit exceeded'));
        else this.send(bytes);
      }, this.options.retryMs);
      this.pending.set(id, p); this.send(bytes);
    });
  }
  fail(error) {
    for (const p of this.pending.values()) { clearInterval(p.timer); p.reject(error); }
    this.pending.clear(); this.close();
  }
  async connect({ sessionKey, resources, packetCount, payloadTimeoutMs = 1000 }) {
    if (this.state !== 'idle') throw new Error('Client is single-use');
    if (typeof sessionKey !== 'string' || !sessionKey || !Array.isArray(resources) || resources.length < 1) throw new TypeError('Session key and resources required');
    resources.forEach(parseResourceId);
    if (!Number.isInteger(packetCount) || packetCount < 1 || packetCount > 65535 || !Number.isInteger(payloadTimeoutMs) || payloadTimeoutMs < 10 || payloadTimeoutMs > 0xffffffff) throw new RangeError('Invalid batch parameters');
    const init = tlon([[sessionKey], resources, [String(packetCount)], [String(payloadTimeoutMs)]]);
    if (init.length > 60000) throw new RangeError('INIT too large');
    this.count = packetCount; this.nextId = 1; this.state = 'connecting';
    try {
      this.address = (await dns.lookup(this.options.host ?? '127.0.0.1', { family: 4 })).address;
      this.socket = dgram.createSocket('udp4');
      this.socket.on('error', e => this.fail(e));
      this.socket.on('message', (b,r) => { if (r.address === this.address && r.port === this.options.port) this.receive(b); });
      await bind(this.socket);
      const hello = await this.wait(0, plain(0, 0, M.HI), M.HI);
      const values = fields(hello.payload, [1,1]);
      this.id = numeric(values[0][0], 0xffffffff); this.expiration = numeric(values[1][0], 0xffffffff);
      if (!this.id || hello.connectionId !== this.id || this.expiration <= now()) throw new Error('Invalid server HI');
      const key = randomBytes(32), cp = randomBytes(8), sp = randomBytes(8);
      this.cipher = new Cipher(key, cp, sp);
      const encrypted = publicEncrypt(rsa(this.options.publicKey), tlon([['aes256'], [key.toString('hex')], [cp.toString('hex')], [sp.toString('hex')]]));
      await this.wait(0, plain(this.id, 0, M.KEY, encrypted), M.ENCRYPT);
      await this.wait(0, this.cipher.encrypt(this.id, 0, M.INIT, init), M.GIMME);
      this.state = 'open';
      this.expiryTimer = setTimeout(() => this.fail(new Error('Connection expired')), Math.max(1, (this.expiration - now()) * 1000));
    } catch (e) { this.fail(e); throw e; }
  }
  receive(bytes) {
    try {
      if (bytes.length < 7 || this.state === 'closed') return;
      const id = bytes.readUInt32BE();
      if (this.id && id !== this.id) return;
      // HI is the only unencrypted server message before a connection is assigned.
      const p = this.cipher && !(bytes.length === 7 && bytes[6] === M.BUGOFF << 4)
        ? this.cipher.decrypt(bytes) : parsePlain(bytes);
      if (p.counter !== undefined) {
        const old = this.seen.get(p.counter);
        if (old && !old.equals(bytes)) return;
        this.seen.set(p.counter, Buffer.from(bytes));
      }
      if ([M.BYE, M.REJECT, M.BUGOFF].includes(p.type) && p.packetId === 0 && !p.payload.length) { this.fail(new Error(`Server closed connection (${p.type})`)); return; }
      if (p.type === M.HUH && p.packetId === 0 && this.state === 'open') {
        for (const s of fields(p.payload, [null])[0]) {
          const pending = this.pending.get(numeric(s, this.count));
          if (pending && pending.retries < this.options.maxRetries) { pending.retries++; this.send(pending.bytes); }
        }
        return;
      }
      const pending = this.pending.get(p.packetId);
      if (!pending || pending.expected !== p.type) return;
      if (p.packetId === 0 && p.type !== M.HI && p.payload.length) return;
      let response;
      if (p.type === M.TAKE) {
        response = unlmp(p.payload);
        const q = pending.request;
        if (!response.response || response.actionId !== q.actionId.toLowerCase() || response.scope !== q.scope || response.scopeId !== q.scopeId) return;
      }
      clearInterval(pending.timer); this.pending.delete(p.packetId); pending.resolve(response ?? p);
    } catch (e) { this.emit('invalidPacket', e); }
  }
  request(request) {
    if (this.state !== 'open' || this.nextId > this.count) return Promise.reject(new Error('Connection not open or batch exhausted'));
    try {
      if (request.response) throw new TypeError('Expected LMP action');
      const payload = lmp(request), id = this.nextId++;
      const promise = this.wait(id, this.cipher.encrypt(this.id, id, M.GIMME, payload), M.TAKE);
      this.pending.get(id).request = unlmp(payload);
      return promise;
    } catch (e) { if (this.cipher.counter >= 65536) this.fail(e); return Promise.reject(e); }
  }
  close() {
    if (this.state === 'closed') return;
    if (this.id && this.cipher && this.socket) {
      try { this.send(this.cipher.encrypt(this.id, 0, M.BYE)); } catch {}
    }
    this.state = 'closed'; clearTimeout(this.expiryTimer);
    for (const p of this.pending.values()) { clearInterval(p.timer); p.reject(new Error('Connection closed')); }
    this.pending.clear(); if (this.socket) safeClose(this.socket); this.emit('close');
  }
}

export class Server extends EventEmitter {
  constructor(input) {
    super(); this.options = options({ connectionTtlMs: 60000, maxConnections: 1000, maxBatchSize: 1024, maxPayloadTimeoutMs: 60000, ...input });
    if (!input?.privateKey || typeof input.authorize !== 'function' || !input.dispatcher?.dispatch) throw new TypeError('privateKey, authorize, and dispatcher required');
    for (const k of ['connectionTtlMs','maxConnections','maxBatchSize','maxPayloadTimeoutMs']) if (!Number.isInteger(this.options[k]) || this.options[k] < 1) throw new RangeError(`Invalid ${k}`);
    this.connections = new Map(); this.hellos = new Map(); this.invalid = new Map(); this.started = false;
  }
  async listen(port = 0, host = '127.0.0.1') {
    if (this.started) throw new Error('Server already started'); this.started = true;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', e => this.emit('networkError', e));
    this.socket.on('message', (b,r) => { this.receive(b,r).catch(e => this.emit('invalidPacket', e)); });
    try {
      const address = await bind(this.socket, port, host);
      this.sweep = setInterval(() => this.expire(), 100);
      return address;
    } catch (e) { safeClose(this.socket); throw e; }
  }
  send(bytes, remote) { this.socket.send(bytes, remote.port, remote.address, e => { if (e) this.emit('networkError', e); }); }
  encrypted(c, packetId, type, payload = empty) {
    try { return c.cipher.encrypt(c.id, packetId, type, payload); }
    catch (e) { this.drop(c); throw e; }
  }
  drop(c) { this.connections.delete(c.id); if (this.hellos.get(c.endpoint) === c) this.hellos.delete(c.endpoint); clearTimeout(c.missingTimer); }
  expire() {
    const time = Date.now();
    for (const c of this.connections.values()) if (c.deadline <= time) {
      if (c.cipher) { try { this.send(this.encrypted(c, 0, M.BUGOFF), c.remote); } catch {} }
      this.drop(c);
    }
    for (const [key,value] of this.invalid) if (value.until <= time) this.invalid.delete(key);
  }
  async receive(bytes, remote) {
    if (bytes.length < 7 || bytes.length > 65000) return;
    const id = bytes.readUInt32BE(), endpoint = `${remote.address}:${remote.port}`;
    if (!id) {
      const p = parsePlain(bytes);
      if (p.type !== M.HI || p.packetId || p.payload.length) return;
      let c = this.hellos.get(endpoint);
      if (c && c.deadline <= Date.now()) { this.drop(c); c = undefined; }
      if (!c) {
        if (this.connections.size >= this.options.maxConnections) return;
        let fresh; do { fresh = randomBytes(4).readUInt32BE(); } while (!fresh || this.connections.has(fresh));
        const deadline = Date.now() + this.options.connectionTtlMs;
        c = { id: fresh, endpoint, remote, deadline, state: 'key', responses: new Map(), actions: new Map(), seen: new Map() };
        c.hello = plain(fresh, 0, M.HI, tlon([[String(fresh)], [String(Math.ceil((deadline - Date.UTC(2026,9,18,6)) / 1000))]]));
        this.connections.set(fresh, c); this.hellos.set(endpoint,c);
      }
      this.send(c.hello,remote); return;
    }
    const c = this.connections.get(id);
    if (!c || c.endpoint !== endpoint) {
      // No key remains for unknown IDs: BUGOFF is necessarily plaintext.
      const key = `${endpoint}:${id}`;
      if (!this.invalid.has(key) && this.invalid.size < this.options.maxConnections * 4) {
        this.invalid.set(key, { until: Date.now() + 1000 }); this.send(plain(id,0,M.BUGOFF),remote);
      }
      return;
    }
    if (c.deadline <= Date.now()) { this.expire(); return; }
    // KEY is plaintext-header RSA ciphertext, and its exact bytes may be retried.
    if (c.keyBytes?.equals(bytes)) { this.send(c.encryptAck,remote); return; }
    if (c.state === 'key') {
      const p = parsePlain(bytes);
      if (p.type !== M.KEY || p.packetId) return;
      const rows = fields(privateDecrypt(rsa(this.options.privateKey), p.payload), [1,1,1,1]);
      if (rows[0][0] !== 'aes256' || !/^[0-9a-f]{64}$/.test(rows[1][0]) || rows.slice(2).some(r => !/^[0-9a-f]{16}$/.test(r[0]))) throw new Error('Invalid key material');
      c.cipher = new Cipher(Buffer.from(rows[1][0],'hex'), Buffer.from(rows[3][0],'hex'), Buffer.from(rows[2][0],'hex'));
      c.keyBytes = Buffer.from(bytes); c.state = 'init';
      c.encryptAck = this.encrypted(c,0,M.ENCRYPT); this.send(c.encryptAck,remote); return;
    }
    if (c.initBytes?.equals(bytes)) { if (c.ready) this.send(c.ready,remote); return; }
    if (bytes.length > (c.state === 'init' ? 60009 : 538)) throw new RangeError('Datagram too large for connection state');
    const p = c.cipher.decrypt(bytes);
    const seen = c.seen.get(p.counter);
    if (seen && !seen.equals(bytes)) throw new Error('Encryption counter reused with different packet');
    c.seen.set(p.counter, Buffer.from(bytes));
    if (p.type === M.BYE && !p.packetId && !p.payload.length) { this.drop(c); return; }
    if (p.type === M.INIT && !p.packetId) {
      if (c.initBytes) {
        if (!c.initBytes.equals(bytes)) throw new Error('INIT changed');
        if (c.ready) this.send(c.ready,remote);
        return;
      }
      if (c.state !== 'init') return;
      const rows = fields(p.payload, [1,null,1,1]);
      if (!rows[0][0]) throw new TypeError('Empty session key');
      const resources = rows[1].map(parseResourceId);
      const count = numeric(rows[2][0], Math.min(65535,this.options.maxBatchSize));
      const timeout = numeric(rows[3][0], this.options.maxPayloadTimeoutMs);
      if (!count || timeout < 10) throw new RangeError('Invalid INIT');
      c.initBytes = Buffer.from(bytes); c.state = 'authorizing';
      let auth;
      try { auth = await this.options.authorize({ sessionKey: rows[0][0], resources, packetCount: count, remote }); } catch { auth = null; }
      if (!this.connections.has(c.id)) return;
      if (!auth || typeof auth.principal !== 'string' || !auth.principal) {
        this.send(this.encrypted(c,0,M.REJECT),remote); this.drop(c); return;
      }
      c.auth = auth; c.resources = resources; c.count = count; c.state = 'open';
      c.ready = this.encrypted(c,0,M.GIMME); this.send(c.ready,remote);
      c.missingRounds = 0;
      const missing = () => {
        if (!this.connections.has(c.id)) return;
        const ids = []; for (let i=1; i<=count; i++) if (!c.actions.has(i)) ids.push(String(i));
        if (!ids.length) return;
        if (c.missingRounds++ > this.options.maxRetries) { this.send(this.encrypted(c,0,M.BUGOFF),remote); this.drop(c); return; }
        // Bound control datagrams even for the full 65535-ID batch.
        for (let i=0;i<ids.length;i+=1000) this.send(this.encrypted(c,0,M.HUH,tlon([ids.slice(i,i+1000)])),remote);
        c.missingTimer = setTimeout(missing, timeout);
      };
      c.missingTimer = setTimeout(missing, timeout); return;
    }
    if (c.state !== 'open' || p.type !== M.GIMME || p.packetId < 1 || p.packetId > c.count) return;
    const previous = c.actions.get(p.packetId);
    if (previous) {
      if (!previous.equals(bytes)) throw new Error('Packet ID reused with different data');
      const cached = c.responses.get(p.packetId); if (cached) this.send(cached,remote); return;
    }
    const request = unlmp(p.payload);
    if (request.response) throw new TypeError('Client sent LMP response');
    c.actions.set(p.packetId, Buffer.from(bytes));
    const resource = c.resources.some(r => r.scope === request.scope && r.id === request.scopeId);
    const context = { ...c.auth, resources: c.resources, remote, connectionId: c.id };
    let result;
    try {
      result = resource || request.code === 0
        ? await this.options.dispatcher.dispatch(request, context, c.auth.principal)
        : { code: 1, payload: [] };
      result = { ...result, response: true, scope: request.scope, scopeId: request.scopeId, actionId: request.actionId };
      lmp(result);
    } catch {
      result = { response: true, code: 2, scope: request.scope, scopeId: request.scopeId, actionId: request.actionId, payload: [['Action dispatch failed']] };
    }
    if (!this.connections.has(c.id)) return;
    const response = this.encrypted(c,p.packetId,M.TAKE,lmp(result));
    c.responses.set(p.packetId,response); this.send(response,remote);
  }
  async close() {
    clearInterval(this.sweep);
    for (const c of this.connections.values()) { if (c.cipher) { try { this.send(this.encrypted(c,0,M.BYE),c.remote); } catch {} } this.drop(c); }
    if (this.socket) await new Promise(resolve => { try { this.socket.close(resolve); } catch { resolve(); } });
  }
}
