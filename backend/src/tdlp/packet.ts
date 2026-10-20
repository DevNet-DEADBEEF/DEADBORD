/**
 * TDLP packet definitions.
 *
 * Every message on the wire is a Packet: a common header plus a
 * type-specific body. Bodies are serialized with TLON (see tlon.ts).
 */

export const TDLP_VERSION = 1;

export enum PacketType {
  // Connection creation (6-way handshake)
  ClientHello = 'CLIENT_HELLO',
  ServerHello = 'SERVER_HELLO',
  ClientAuth = 'CLIENT_AUTH',
  ServerAuthAck = 'SERVER_AUTH_ACK',
  ClientReady = 'CLIENT_READY',
  ServerReady = 'SERVER_READY',

  // Data transfer
  Request = 'REQUEST',
  Response = 'RESPONSE',
  Event = 'EVENT',
  Error = 'ERROR',

  // Connection close
  Close = 'CLOSE',
  CloseAck = 'CLOSE_ACK',
}

export interface PacketHeader {
  version: number;
  type: PacketType;
  /** Monotonically increasing per sender. */
  seq: number;
  /** Seq of the packet this one replies to, if any. */
  ack?: number;
  /** Assigned by the server in SERVER_HELLO; absent before that. */
  sessionId?: string;
}

export interface Packet<T extends PacketType = PacketType, B = PacketBodies[T]> {
  header: PacketHeader & { type: T };
  body: B;
}

// --- Handshake bodies ---------------------------------------------------

export interface ClientHelloBody {
  supportedVersions: number[];
  clientName: string;
}

export interface ServerHelloBody {
  version: number;
  sessionId: string;
  /** Login methods the server will accept in CLIENT_AUTH. */
  authMethods: string[];
}

export interface ClientAuthBody {
  method: string;
  /** Method-specific credential payload. */
  credentials: unknown;
}

export interface ServerAuthAckBody {
  ok: boolean;
  userId?: string;
  /** Set when the credentials matched several users and the client must pick one. */
  candidates?: { userId: string; username: string }[];
  reason?: string;
}

export interface ClientReadyBody {
  /** User chosen from candidates, when the auth was ambiguous. */
  userId: string;
}

export interface ServerReadyBody {
  /** Keepalive interval the client must respect, in ms. */
  heartbeatMs: number;
}

// --- Data transfer bodies -----------------------------------------------

export enum Operation {
  CreateTask = 'CREATE_TASK',
  UpdateTask = 'UPDATE_TASK',
  RemoveTask = 'REMOVE_TASK',
}

export interface RequestBody {
  op: Operation;
  payload: unknown;
}

export interface ResponseBody {
  ok: boolean;
  result?: unknown;
}

export interface EventBody {
  /** Server-pushed change, e.g. another client edited a shared task. */
  op: Operation;
  payload: unknown;
}

export interface ErrorBody {
  code: number;
  message: string;
}

// --- Close bodies -------------------------------------------------------

export interface CloseBody {
  reason?: string;
}

export type CloseAckBody = Record<string, never>;

export interface PacketBodies {
  [PacketType.ClientHello]: ClientHelloBody;
  [PacketType.ServerHello]: ServerHelloBody;
  [PacketType.ClientAuth]: ClientAuthBody;
  [PacketType.ServerAuthAck]: ServerAuthAckBody;
  [PacketType.ClientReady]: ClientReadyBody;
  [PacketType.ServerReady]: ServerReadyBody;
  [PacketType.Request]: RequestBody;
  [PacketType.Response]: ResponseBody;
  [PacketType.Event]: EventBody;
  [PacketType.Error]: ErrorBody;
  [PacketType.Close]: CloseBody;
  [PacketType.CloseAck]: CloseAckBody;
}

export type AnyPacket = { [T in PacketType]: Packet<T> }[PacketType];
