/// <reference types="node" />
export type Entries = string[][];
export function encode(entries: readonly (readonly string[])[]): Buffer;
export function decode(data: Uint8Array): Entries;
