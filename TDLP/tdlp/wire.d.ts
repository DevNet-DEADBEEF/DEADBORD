/// <reference types="node" />
export const Message: Readonly<{ HI: 0; BYE: 1; REJECT: 2; KEY: 3; ENCRYPT: 4; INIT: 5; GIMME: 6; TAKE: 7; HUH: 8; BUGOFF: 9 }>;
export const EPOCH_MS: number;
export function now(): number;
export interface WirePacket { connectionId: number; packetId: number; type: number; payload: Buffer }
export function header(connectionId: number, packetId: number): Buffer;
export function plain(connectionId: number, packetId: number, type: number, payload?: Uint8Array): Buffer;
export function parsePlain(data: Uint8Array): WirePacket;
export class Cipher {
  constructor(key: Uint8Array, sendPrefix: Uint8Array, receivePrefix: Uint8Array);
  encrypt(connectionId: number, packetId: number, type: number, payload?: Uint8Array): Buffer;
  decrypt(data: Uint8Array): WirePacket & { counter: number };
}
