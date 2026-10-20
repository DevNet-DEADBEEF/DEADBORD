/**
 * Document shapes from Notion: CSU / DevNet / Todo List / DB Layout/Schemas
 * (the MongoDB $jsonSchema validators there are authoritative).
 * IDs are snowflakes (snowflake.ts); dates are Timestamps (epoch.ts).
 */

import type { Collection, Db } from 'mongodb';
import type { Timestamp } from './epoch.js';
import type { Id } from './snowflake.js';

/**
 * Max length of free-text fields, so records fit in a 500-byte TLON message.
 * Counted on the wire (src/tdlp/text.ts), where a line break takes 2 characters.
 */
export const TEXT_MAX = 450;
/** Comments travel with their author and date, so they get less room. */
export const COMMENT_MAX = 400;
/** Max length of board and list titles. */
export const TITLE_MAX = 128;

/** Bumped on every change (u32, from 1); LMP UPDATE/DELETE must name the current one. */
export type Version = bigint;

/** Single-line text (usernames, titles): printable ASCII only. */
export const ASCII_LINE = /^[\x20-\x7E]*$/;
/** Multi-line text (task desc, comments): printable ASCII plus tab and newlines. */
export const ASCII_TEXT = /^[\x20-\x7E\t\r\n]*$/;

export const AUTH_TYPES = [
  'lucky', 'username', 'password', 'google', 'microsoft',
  'chatgpt', 'discord', 'roblox', 'sso', 'email', 'phone',
  'billing_address', 'gov_id', 'favorite_color', 'pin',
  'security_question', 'credit_card', 'debit_card', 'bank',
  'blood_type', 'birthday', 'favorite_number', 'paragraph',
  'slider', 'coordinates', 'reaction_time',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/** MFA factor category: something the user is, knows, or has. */
export type MfaFactor = 'is' | 'knows' | 'has';

export interface AuthObject {
  type: AuthType;
  createdDate: Timestamp;
  mfa: MfaFactor;
  /** Method-specific payload (hash, provider id, etc.). */
  data?: Record<string, unknown>;
}

export interface User {
  _id: Id;
  /** Unique, 1-32 chars. */
  username: string;
  createdDate: Timestamp;
  credentials: AuthObject[];
}

/** Board-level permissions; each level includes the ones before it. */
export const PERMISSIONS = ['read', 'read_comment', 'read_write_comment'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface BoardMember {
  userId: Id;
  permission: Permission;
  addedDate?: Timestamp;
}

export interface Board {
  _id: Id;
  /** 1-TITLE_MAX chars. */
  title: string;
  /** Owner. Only the owner can invite members and change permissions. */
  createdBy: Id;
  createdDate: Timestamp;
  /** Members other than the owner. */
  members: BoardMember[];
  version: Version;
}

export interface List {
  _id: Id;
  /** 1-TITLE_MAX chars. */
  title: string;
  createdBy: Id;
  createdDate: Timestamp;
  boardId: Id;
  version: Version;
}

export interface Comment {
  _id: Id;
  /** 1-TEXT_MAX chars. */
  text: string;
  createdBy: Id;
  createdDate: Timestamp;
}

export interface Task {
  _id: Id;
  /** 1-TEXT_MAX chars. */
  title: string;
  /** Up to TEXT_MAX chars. */
  desc?: string;
  dueDate?: Timestamp | null;
  done: boolean;
  createdBy: Id;
  createdDate: Timestamp;
  listId: Id;
  comments?: Comment[];
  version: Version;
}

/** See src/auth/sessions.ts. */
export interface Session {
  /** Hash of the session key (signed 64-bit). The key itself is never stored. */
  _id: bigint;
  userId: Id;
  createdDate: Timestamp;
  expiresDate: Timestamp;
  /** Set once the key has been rotated; it then expires after a short grace period. */
  rotatedDate?: Timestamp;
}

export interface Collections {
  users: Collection<User>;
  boards: Collection<Board>;
  lists: Collection<List>;
  tasks: Collection<Task>;
  sessions: Collection<Session>;
}

/** Validators and indexes are applied by db/setup.mongosh.js (npm run db:setup). */
export function collections(db: Db): Collections {
  return {
    users: db.collection<User>('Users'),
    boards: db.collection<Board>('Bords'),
    lists: db.collection<List>('Lists'),
    tasks: db.collection<Task>('Tasks'),
    sessions: db.collection<Session>('Sessions'),
  };
}

/** Gives documents from before versions existed version 1. Safe to re-run. */
export async function addMissingVersions(db: Db): Promise<void> {
  const c = collections(db);
  const missing = { version: { $exists: false } };
  await c.boards.updateMany(missing, { $set: { version: 1n } });
  await c.lists.updateMany(missing, { $set: { version: 1n } });
  await c.tasks.updateMany(missing, { $set: { version: 1n } });
}

export type Role = Permission | 'owner';

/** The caller's role on a board, or undefined if they have no access. */
export function boardRole(board: Board, userId: Id): Role | undefined {
  if (board.createdBy === userId) return 'owner';
  return board.members.find((m) => m.userId === userId)?.permission;
}

export function hasPermission(board: Board, userId: Id, needed: Permission): boolean {
  const role = boardRole(board, userId);
  if (role === undefined) return false;
  return role === 'owner' || PERMISSIONS.indexOf(role) >= PERMISSIONS.indexOf(needed);
}
