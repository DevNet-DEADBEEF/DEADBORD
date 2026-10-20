/**
 * Document shapes from Notion: CSU / DevNet / Todo List / DB Layout/Schemas.
 * Date-time fields are stored as BSON Dates rather than strings so they can be
 * range-queried; they serialize to ISO date-time strings.
 */

import type { Collection, Db } from 'mongodb';

export interface User {
  _id: string;
  /** Unique, 1-32 chars. */
  username: string;
  /** Per-login-method credential data. */
  credentials?: Record<string, unknown>;
}

export interface Comment {
  text: string;
  createdDate: Date;
  createdBy: string;
}

export interface Board {
  title: string;
  desc?: string;
  /** Due date. */
  date: Date;
  createdDate: Date;
  createdBy: string;
  comments?: Comment[];
}

// TODO: Task, once its schema is defined in Notion.

export interface Collections {
  users: Collection<User>;
  boards: Collection<Board>;
}

export function collections(db: Db): Collections {
  return {
    users: db.collection<User>('users'),
    boards: db.collection<Board>('boards'),
  };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await collections(db).users.createIndex({ username: 1 }, { unique: true });
}
