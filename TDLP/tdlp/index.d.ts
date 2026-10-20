/// <reference types="node" />
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { RemoteInfo } from 'node:dgram';
import type { KeyObject } from 'node:crypto';
import type { Packet } from '@deadbord/lmp';
export { Message, EPOCH_MS, now } from './wire.js';
export interface RetryOptions { retryMs?: number; maxRetries?: number }
export interface Resource { scope: number; id: bigint }
export interface Authorization { principal: string; [key: string]: unknown }
export interface Context extends Authorization { resources: Resource[]; remote: RemoteInfo; connectionId: number }
export interface ClientOptions extends RetryOptions { host?: string; port: number; publicKey: string | Buffer | KeyObject }
export class Client extends EventEmitter {
  constructor(options: ClientOptions);
  readonly state: string;
  connect(options: { sessionKey: string; resources: string[]; packetCount: number; payloadTimeoutMs?: number }): Promise<void>;
  request(packet: Packet): Promise<Packet>;
  close(): void;
}
export interface ServerOptions extends RetryOptions {
  privateKey: string | Buffer | KeyObject;
  authorize(input: { sessionKey: string; resources: Resource[]; packetCount: number; remote: RemoteInfo }): Authorization | null | Promise<Authorization | null>;
  dispatcher: { dispatch(request: Packet, context: Context, principal: string): Promise<Packet> };
  connectionTtlMs?: number; maxConnections?: number; maxBatchSize?: number; maxPayloadTimeoutMs?: number;
}
export class Server extends EventEmitter {
  constructor(options: ServerOptions);
  listen(port?: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
}
