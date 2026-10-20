/// <reference types="node" />
import type { Entries } from '@deadbord/tlon';
export const Scope: Readonly<{ Board: 0; List: 1; Task: 2 }>;
export const Action: Readonly<{ Create: 0; Update: 1; Delete: 2; Obtain: 3; UpdatePerm: 4 }>;
export const Response: Readonly<{ Done: 0; Reject: 1; Nope: 2; Conflict: 3 }>;
export const MAX_PAYLOAD: 500;
export interface Packet { response: boolean; scope: number; code: number; scopeId: bigint; actionId: string; version?: number; payload?: Entries }
export function newActionId(): string;
export function encode(packet: Packet): Buffer;
export function decode(data: Uint8Array): Packet;
export function resourceId(scope: number, id: bigint): string;
export function parseResourceId(value: string): { scope: number; id: bigint };
export class Dispatcher<C = unknown> {
  constructor(handler: (request: Packet, context: C) => Promise<Pick<Packet, 'code' | 'version' | 'payload'>> | Pick<Packet, 'code' | 'version' | 'payload'>, options?: { ttlMs?: number; maxEntries?: number });
  dispatch(request: Packet, context: C, principal: string): Promise<Packet>;
}
