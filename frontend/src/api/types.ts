/**
 * Wire shapes for the backend models (backend/src/db/models.ts).
 * IDs are 64-bit snowflakes, sent as decimal strings because they exceed
 * Number.MAX_SAFE_INTEGER. Dates are Timestamps: u32 seconds since the
 * DEADBORD epoch (see src/epoch.ts).
 */

import type { Timestamp } from '@/epoch';

export type Id = string;

/** Max length of free-text fields (task title/desc, comments). */
export const TEXT_MAX = 450;
/** Max length of board and list titles. */
export const TITLE_MAX = 128;

export const PERMISSIONS = ['read', 'read_comment', 'read_write_comment'] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Role = Permission | 'owner';

export const PERMISSION_LABELS: Record<Permission, string> = {
  read: 'Read',
  read_comment: 'Read/Comment',
  read_write_comment: 'Read/Write/Comment',
};

export function can(role: Role, needed: Permission): boolean {
  return role === 'owner' || PERMISSIONS.indexOf(role) >= PERMISSIONS.indexOf(needed);
}

export interface User {
  id: Id;
  username: string;
}

export interface Member {
  userId: Id;
  username: string;
  permission: Permission;
}

export interface Board {
  id: Id;
  title: string;
  createdBy: Id;
  createdDate: Timestamp;
  members: Member[];
}

export interface List {
  id: Id;
  title: string;
  createdBy: Id;
  createdDate: Timestamp;
  boardId: Id;
}

export interface Comment {
  id: Id;
  text: string;
  createdBy: Id;
  createdDate: Timestamp;
}

export interface Task {
  id: Id;
  title: string;
  desc?: string;
  dueDate?: Timestamp | null;
  done: boolean;
  createdBy: Id;
  createdDate: Timestamp;
  listId: Id;
  comments: Comment[];
}

export interface BoardSummary {
  board: Board;
  role: Role;
}

/** A board with all of its contents, fetched in one go. */
export interface BoardView extends BoardSummary {
  lists: (List & { tasks: Task[] })[];
}

export interface TaskView {
  task: Task;
  role: Role;
  /** Display names for comment authors, keyed by user id. */
  usernames: Record<Id, string>;
}

export interface NewTask {
  title: string;
  desc?: string;
  dueDate?: Timestamp | null;
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'desc' | 'dueDate' | 'done'>>;
