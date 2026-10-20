import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { encode as tlon, decode as untlon } from '@deadbord/tlon';
import { encode, decode, Dispatcher, resourceId, parseResourceId, newActionId } from '@deadbord/lmp';
import { Client, Server } from '@deadbord/tdlp';
import { Cipher } from '@deadbord/tdlp/wire';

const action = (extra = {}) => ({ response: false, scope: 2, code: 3, scopeId: 42n, actionId: newActionId(), payload: [['name']], ...extra });
test('TLON exact control bytes, empty values, malformed data', () => {
  assert.deepEqual([...tlon([['a','b'],['']])], [97,30,98,31,31]);
  assert.deepEqual(untlon(tlon([['a',''],['']])), [['a',''],['']]);
  assert.deepEqual(untlon(Buffer.alloc(0)), []);
  for (const bad of [Buffer.from('unterminated'), Buffer.from([255,31]),Buffer.from([10,31])]) assert.throws(() => untlon(bad));
  for (const bad of [[['é']], [['a\x1eb']], [[]]]) assert.throws(() => tlon(bad));
});
test('LMP bits, uint64, version placement, payload ceiling, resource IDs', () => {
  const p = action({ code: 1, version: 0xffffffff, scopeId: 0xffffffffffffffffn, payload: [['name','x']] });
  const b = encode(p); assert.equal(b[0], 0x44); assert.equal(b.readUInt32BE(25),0xffffffff);
  assert.deepEqual(decode(b), p);
  assert.equal(encode(action()).length,30);
  for (const code of [0,1,2,3]) {
    const r = { ...action(), response: true, code, payload: code === 2 ? [['error']] : code === 3 ? [['1'],['2']] : [] };
    if (!code) r.version = 2;
    assert.deepEqual(decode(encode(r)),r);
  }
  assert.throws(() => encode(action({payload:[['a'.repeat(500)]]})));
  assert.equal(encode(action({payload:[['a'.repeat(499)]]})).length,525);
  assert.throws(() => decode(Buffer.from([0,0])));
  const reserved = encode(action()); reserved[0] |= 1; assert.throws(() => decode(reserved));
  const value = resourceId(2,0xffffffffffffffffn); assert.deepEqual(parseResourceId(value),{scope:2,id:0xffffffffffffffffn});
  assert.throws(() => parseResourceId((3n << 64n).toString()));
});
test('dispatcher deduplicates concurrent actions and isolates principals', async () => {
  let calls = 0;
  const dispatcher = new Dispatcher(async () => { calls++; await new Promise(r=>setTimeout(r,10)); return { code:0, version:1, payload:[] }; });
  const p = action();
  const results = await Promise.all([dispatcher.dispatch(p,{},'a'),dispatcher.dispatch(p,{},'a')]);
  assert.deepEqual(results[0],results[1]); assert.equal(calls,1);
  await dispatcher.dispatch(p,{},'b'); assert.equal(calls,2);
  await assert.rejects(dispatcher.dispatch({...p,payload:[['different']]},{},'a'),/reused/);
});
test('CTR supports reordered packets and refuses counter wrap', () => {
  const key=randomBytes(32), cp=randomBytes(8),sp=randomBytes(8);
  const a=new Cipher(key,cp,sp), b=new Cipher(key,sp,cp);
  const first=a.encrypt(1,1,6,Buffer.from('first')), second=a.encrypt(1,2,6,Buffer.from('second'));
  assert.equal(b.decrypt(second).payload.toString(),'second'); assert.equal(b.decrypt(first).payload.toString(),'first');
  a.counter=65536; assert.throws(()=>a.encrypt(1,0,1),/exhausted/);
});
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
test('UDP handshake, pipelining, dropped control/action/response datagrams, exact retry bytes', {timeout:10000}, async () => {
  let calls=0;
  const server=new Server({privateKey:keys.privateKey, retryMs:30, authorize:()=>({principal:'user'}), dispatcher:new Dispatcher(async p=>{calls++;return {code:0,version:1,payload:p.payload};})});
  const address=await server.listen();
  const proxy=dgram.createSocket('udp4'); await new Promise(r=>proxy.bind(0,'127.0.0.1',r));
  let clientRemote; const seen=new Map(); const dropped=new Set();
  proxy.on('message',(bytes,r)=>{
    const fromServer=r.port===address.port;
    if (!fromServer) clientRemote=r;
    const key=`${fromServer}:${bytes.toString('hex')}`;
    seen.set(key,(seen.get(key)??0)+1);
    // Drop the first copy of every unique datagram in both directions.
    if (!dropped.has(key)) {dropped.add(key);return;}
    if(fromServer) proxy.send(bytes,clientRemote.port,'127.0.0.1'); else proxy.send(bytes,address.port,'127.0.0.1');
  });
  const client=new Client({port:proxy.address().port,publicKey:keys.publicKey,retryMs:30,maxRetries:20});
  try {
    await client.connect({sessionKey:'session',resources:[resourceId(2,42n)],packetCount:2,payloadTimeoutMs:40});
    const responses=await Promise.all([client.request(action()),client.request(action())]);
    assert.equal(responses.length,2); assert.ok(responses.every(p=>p.code===0)); assert.equal(calls,2);
    assert.ok([...seen.values()].some(n=>n>=2));
  } finally {client.close();await server.close();proxy.close();}
});
test('authorization rejection and retry exhaustion clean up', {timeout:5000}, async () => {
  const server=new Server({privateKey:keys.privateKey,authorize:()=>null,dispatcher:new Dispatcher(()=>({code:0,version:0,payload:[]}))});
  const address=await server.listen(); const client=new Client({port:address.port,publicKey:keys.publicKey,retryMs:20,maxRetries:1});
  try { await assert.rejects(client.connect({sessionKey:'bad',resources:[resourceId(2,42n)],packetCount:1}),/closed/); assert.equal(client.state,'closed'); }
  finally {client.close();await server.close();}
  const silent=dgram.createSocket('udp4'); await new Promise(r=>silent.bind(0,'127.0.0.1',r));
  const timeout=new Client({port:silent.address().port,publicKey:keys.publicKey,retryMs:20,maxRetries:1});
  try {await assert.rejects(timeout.connect({sessionKey:'x',resources:[resourceId(2,42n)],packetCount:1}),/retry limit/);}
  finally {timeout.close();silent.close();}
});
test('HUH repairs missing actions, unauthorized targets reject, replay survives connections', {timeout:5000}, async () => {
  let calls=0, huh=0;
  const dispatcher=new Dispatcher(()=>{calls++;return {code:0,version:1,payload:[]};});
  const server=new Server({privateKey:keys.privateKey,authorize:()=>({principal:'stable'}),dispatcher});
  const originalSend=server.send.bind(server);
  server.send=(b,r)=>{ const c=server.connections.get(b.readUInt32BE()); if(c?.state==='open' && b.length>9) huh++; originalSend(b,r); };
  const {port}=await server.listen();
  const p=action();
  const first=new Client({port,publicKey:keys.publicKey,retryMs:500,maxRetries:4});
  const second=new Client({port,publicKey:keys.publicKey,retryMs:50});
  try {
    await first.connect({sessionKey:'session',resources:[resourceId(2,42n)],packetCount:2,payloadTimeoutMs:20});
    const original=first.send.bind(first); let drop=true;
    first.send=b=>{if(drop&&b.readUInt16BE(4)===1){drop=false;return;}original(b);};
    assert.equal((await first.request(p)).code,0);
    assert.equal((await first.request(action({scopeId:43n}))).code,1);
    assert.ok(huh>0);first.close();
    await second.connect({sessionKey:'session',resources:[resourceId(2,42n)],packetCount:1});
    assert.equal((await second.request(p)).code,0); assert.equal(calls,1);
  } finally {first.close();second.close();await server.close();}
});
test('cache exhaustion and oversize application responses do not repeat mutations', async () => {
  let calls=0;
  const d=new Dispatcher(()=>{calls++;return {code:0,version:1,payload:[['x'.repeat(600)]]};},{maxEntries:1});
  const p=action();assert.equal((await d.dispatch(p,{},'a')).code,2);
  assert.equal((await d.dispatch(p,{},'a')).code,2);assert.equal(calls,1);
  await assert.rejects(d.dispatch(action(),{},'a'),/capacity/);
});
