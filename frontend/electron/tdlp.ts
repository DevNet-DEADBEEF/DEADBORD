/**
 * TDLP client for the renderer, on top of the @deadbord/tdlp library
 * (../TDLP). The library is one connection per batch: INIT names every
 * resource and how many actions follow, so each batch opens a fresh Client.
 */

import { readFileSync } from 'node:fs';
import type { Packet } from '@deadbord/lmp' with { 'resolution-mode': 'import' };
import type { TdlpBatch, TdlpBatchResult, TdlpReply } from './bridge';

export interface TdlpConfig {
  host: string;
  port: number;
  /** PEM file with the server's RSA public key (`npm run tdlp:keygen` in backend/). */
  publicKeyFile: string;
}

/** How long the server waits for missing actions before asking for them again (HUH). */
const PAYLOAD_TIMEOUT_MS = 1000;

// The libraries are ESM-only; this file is CommonJS.
const libraries = Promise.all([import('@deadbord/tdlp'), import('@deadbord/lmp')]);

let publicKey: Buffer | undefined;

/** Library errors, in words the app can show. */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/retry limit/i.test(message)) return "Can't reach the server";
  if (/closed connection \(2\)/.test(message)) return 'The server refused the connection (logged out, or no access)';
  if (/closed connection \(9\)|expired/i.test(message)) return 'The connection expired; try again';
  if (/closed connection/.test(message)) return 'The server closed the connection';
  return message;
}

function check(batch: TdlpBatch) {
  const scope = (s: unknown) => s === 0 || s === 1 || s === 2;
  const id = (s: unknown) => typeof s === 'string' && /^\d{1,20}$/.test(s);
  const ok =
    typeof batch?.sessionKey === 'string' &&
    Array.isArray(batch.resources) &&
    batch.resources.length > 0 &&
    batch.resources.every((r) => scope(r?.scope) && id(r?.id)) &&
    Array.isArray(batch.actions) &&
    batch.actions.length > 0 &&
    batch.actions.every((a) => scope(a?.scope) && id(a?.scopeId) && Array.isArray(a?.payload));
  if (!ok) throw new TypeError('Malformed TDLP batch');
}

export async function runBatch(config: TdlpConfig, batch: TdlpBatch): Promise<TdlpBatchResult> {
  let client: InstanceType<Awaited<typeof libraries>[0]['Client']> | undefined;
  try {
    check(batch);
    const [{ Client }, { resourceId }] = await libraries;
    publicKey ??= readFileSync(config.publicKeyFile);
    client = new Client({ host: config.host, port: config.port, publicKey });
    client.on('invalidPacket', () => undefined);
    await client.connect({
      sessionKey: batch.sessionKey,
      resources: batch.resources.map((r) => resourceId(r.scope, BigInt(r.id))),
      packetCount: batch.actions.length,
      payloadTimeoutMs: PAYLOAD_TIMEOUT_MS,
    });
    const open = client;
    const settled = await Promise.allSettled(
      batch.actions.map((a) => {
        const packet: Packet = {
          response: false,
          scope: a.scope,
          code: a.code,
          scopeId: BigInt(a.scopeId),
          actionId: a.actionId,
          payload: a.payload,
        };
        if (a.version !== undefined) packet.version = a.version;
        return open.request(packet);
      }),
    );
    return {
      replies: settled.map((s): TdlpReply | { error: string } =>
        s.status === 'fulfilled'
          ? { code: s.value.code, version: s.value.version, payload: s.value.payload ?? [] }
          : { error: describe(s.reason) },
      ),
    };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return { error: `No TDLP public key at ${config.publicKeyFile}; run \`npm run tdlp:keygen\` in backend/` };
    }
    return { error: describe(err) };
  } finally {
    client?.close();
  }
}
