/**
 * TDLP connection lifecycle.
 *
 * Connection creation is a 6-way handshake:
 *
 *   1. C -> S  CLIENT_HELLO     versions the client speaks
 *   2. S -> C  SERVER_HELLO     chosen version, session id, accepted login methods
 *   3. C -> S  CLIENT_AUTH      login method + credentials
 *   4. S -> C  SERVER_AUTH_ACK  success, failure, or colliding user candidates
 *   5. C -> S  CLIENT_READY     confirmed user id
 *   6. S -> C  SERVER_READY     session parameters; data transfer may begin
 *
 * Close is CLOSE from either side, answered by CLOSE_ACK.
 */

import type {
  AnyPacket,
  CloseBody,
  Operation,
  PacketBodies,
  PacketType,
  ResponseBody,
} from './packet.js';

export enum ConnectionState {
  Idle = 'IDLE',
  HelloSent = 'HELLO_SENT',
  HelloReceived = 'HELLO_RECEIVED',
  Authenticating = 'AUTHENTICATING',
  AwaitingReady = 'AWAITING_READY',
  Open = 'OPEN',
  Closing = 'CLOSING',
  Closed = 'CLOSED',
}

/** Byte-level transport underneath TDLP (TCP socket, WebSocket, ...). */
export interface Transport {
  send(data: Uint8Array): Promise<void>;
  onData(listener: (data: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

export interface ConnectionEvents {
  stateChange: (state: ConnectionState) => void;
  packet: (packet: AnyPacket) => void;
  error: (error: Error) => void;
  close: (reason?: string) => void;
}

/** Behaviour shared by both ends of a TDLP connection. */
export interface TdlpConnection {
  readonly state: ConnectionState;
  readonly sessionId: string | undefined;

  send<T extends PacketType>(type: T, body: PacketBodies[T]): Promise<void>;
  close(reason?: CloseBody['reason']): Promise<void>;

  on<E extends keyof ConnectionEvents>(event: E, listener: ConnectionEvents[E]): void;
  off<E extends keyof ConnectionEvents>(event: E, listener: ConnectionEvents[E]): void;
}

export interface TdlpClientConnection extends TdlpConnection {
  /** Runs the client half of the 6-way handshake. Resolves once OPEN. */
  connect(auth: { method: string; credentials: unknown }): Promise<void>;
  /** Sends a REQUEST and resolves with the matching RESPONSE. */
  request(op: Operation, payload: unknown): Promise<ResponseBody>;
}

export interface TdlpServerConnection extends TdlpConnection {
  readonly userId: string | undefined;
}

/** Server-side hooks the handshake and data phases delegate to. */
export interface TdlpServerHandlers {
  authenticate(
    method: string,
    credentials: unknown,
  ): Promise<{ userId: string } | { candidates: { userId: string; username: string }[] } | null>;
  handleRequest(conn: TdlpServerConnection, op: Operation, payload: unknown): Promise<ResponseBody>;
}

export interface TdlpServer {
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
  onConnection(listener: (conn: TdlpServerConnection) => void): void;
}
