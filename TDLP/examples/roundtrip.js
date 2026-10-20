import { generateKeyPairSync } from 'node:crypto';
import { Client, Server } from '@deadbord/tdlp';
import { Dispatcher, newActionId, resourceId } from '@deadbord/lmp';

// Demo keys and session authorization only; real deployments load persistent keys
// and validate session/resource permissions in their application.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const dispatcher = new Dispatcher(request => ({ code: 0, version: 1, payload: [['name', 'Example task']] }));
const server = new Server({ privateKey, dispatcher, authorize: ({ sessionKey, resources }) =>
  sessionKey === 'demo' && resources.every(r => r.scope === 2 && r.id === 42n) ? { principal: 'demo-user' } : null });
const { port } = await server.listen();
const client = new Client({ publicKey, port });
try {
  await client.connect({ sessionKey: 'demo', resources: [resourceId(2, 42n)], packetCount: 1 });
  const result = await client.request({ response: false, scope: 2, code: 3, scopeId: 42n, actionId: newActionId(), payload: [['name']] });
  console.log(result);
} finally { client.close(); await server.close(); }
