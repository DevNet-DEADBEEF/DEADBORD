/**
 * Board, list and task API over HTTP (JSON). Every route needs a session key
 * and enforces board-level permissions. Mirrors the frontend's DeadbordClient
 * (frontend/src/api/client.ts); this is a stand-in transport until TDLP/TLON
 * exist.
 *
 * Wire format: IDs are decimal strings (64-bit snowflakes don't fit a JS
 * number), dates are u32 seconds since the DEADBORD epoch as numbers.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import type { ResolvedSession } from '../auth/sessions.js';
import { now, TIMESTAMP_MAX } from '../db/epoch.js';
import {
  ASCII_LINE,
  ASCII_TEXT,
  boardRole,
  collections,
  hasPermission,
  PERMISSIONS,
  TEXT_MAX,
  TITLE_MAX,
  type Board,
  type List,
  type Permission,
  type Role,
  type Task,
} from '../db/models.js';
import { ids, type Id } from '../db/snowflake.js';

type Authenticate = (req: FastifyRequest, reply: FastifyReply) => Promise<{ session: ResolvedSession } | undefined>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

function parseId(text: string): Id {
  return /^\d{1,20}$/.test(text) ? BigInt(text) : fail(404, 'Not found');
}

function text(value: unknown, field: string, opts: { max: number; multiline?: boolean; optional?: boolean }): string {
  if (typeof value !== 'string') return fail(400, `${field} is required`);
  const trimmed = value.trim();
  if (!opts.optional && !trimmed) fail(400, `${field} is required`);
  if (value.length > opts.max) fail(400, `${field} is longer than ${opts.max} characters`);
  if (!(opts.multiline ? ASCII_TEXT : ASCII_LINE).test(value)) fail(400, `${field} must be ASCII`);
  return opts.optional ? value : trimmed;
}

function dueDate(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > Number(TIMESTAMP_MAX)) {
    return fail(400, 'dueDate must be seconds since the epoch, or null');
  }
  return BigInt(value as number);
}

function permission(value: unknown): Permission {
  return (PERMISSIONS as readonly unknown[]).includes(value) ? (value as Permission) : fail(400, 'Unknown permission');
}

// --- Wire conversion ------------------------------------------------------

const wireTask = (t: Task) => ({
  id: t._id.toString(),
  title: t.title,
  desc: t.desc,
  dueDate: t.dueDate == null ? null : Number(t.dueDate),
  done: t.done,
  createdBy: t.createdBy.toString(),
  createdDate: Number(t.createdDate),
  listId: t.listId.toString(),
  comments: (t.comments ?? []).map((c) => ({
    id: c._id.toString(),
    text: c.text,
    createdBy: c.createdBy.toString(),
    createdDate: Number(c.createdDate),
  })),
});

const wireList = (l: List) => ({
  id: l._id.toString(),
  title: l.title,
  createdBy: l.createdBy.toString(),
  createdDate: Number(l.createdDate),
  boardId: l.boardId.toString(),
});

export function registerApi(app: FastifyInstance, db: Db, authenticate: Authenticate) {
  const c = collections(db);

  async function usernames(userIds: Id[]): Promise<Map<Id, string>> {
    const users = await c.users.find({ _id: { $in: [...new Set(userIds)] } }, { projection: { username: 1 } }).toArray();
    return new Map(users.map((u) => [u._id, u.username]));
  }

  async function wireBoard(b: Board) {
    const names = await usernames(b.members.map((m) => m.userId));
    return {
      id: b._id.toString(),
      title: b.title,
      createdBy: b.createdBy.toString(),
      createdDate: Number(b.createdDate),
      members: b.members.map((m) => ({
        userId: m.userId.toString(),
        username: names.get(m.userId) ?? 'unknown',
        permission: m.permission,
      })),
    };
  }

  /** Loads a board the user can access with at least `needed` (or as owner). */
  async function boardAccess(boardId: Id, userId: Id, needed: Permission | 'owner'): Promise<{ board: Board; role: Role }> {
    const board = await c.boards.findOne({ _id: boardId });
    const role = board && boardRole(board, userId);
    // Boards you can't see don't exist, as far as you can tell.
    if (!board || !role) return fail(404, 'Board not found');
    if (needed === 'owner' ? role !== 'owner' : !hasPermission(board, userId, needed)) fail(403, 'Permission denied');
    return { board, role: role! };
  }

  async function taskAccess(taskId: Id, userId: Id, needed: Permission) {
    const task = await c.tasks.findOne({ _id: taskId });
    const list = task && (await c.lists.findOne({ _id: task.listId }));
    if (!task || !list) return fail(404, 'Task not found');
    const { role } = await boardAccess(list.boardId, userId, needed);
    return { task, role };
  }

  /** Wraps a route: authenticates, then maps HttpErrors to responses. */
  function route<P = Record<string, string>, B = Record<string, unknown>>(
    handler: (ctx: { userId: Id; params: P; body: B }, reply: FastifyReply) => Promise<unknown>,
  ) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const auth = await authenticate(req, reply);
      if (!auth) return reply;
      try {
        return await handler(
          { userId: auth.session.userId, params: req.params as P, body: (req.body ?? {}) as B },
          reply,
        );
      } catch (err) {
        if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }
    };
  }

  // --- Boards -------------------------------------------------------------

  app.get(
    '/api/boards',
    route(async ({ userId }) => {
      const boards = await c.boards
        .find({ $or: [{ createdBy: userId }, { 'members.userId': userId }] })
        .sort({ createdDate: 1 })
        .toArray();
      return Promise.all(boards.map(async (b) => ({ board: await wireBoard(b), role: boardRole(b, userId) })));
    }),
  );

  app.post(
    '/api/boards',
    route<unknown, { title?: unknown }>(async ({ userId, body }) => {
      const board: Board = {
        _id: ids.next(),
        title: text(body.title, 'title', { max: TITLE_MAX }),
        createdBy: userId,
        createdDate: now(),
        members: [],
      };
      await c.boards.insertOne(board);
      return wireBoard(board);
    }),
  );

  /** A board with all its lists and tasks, for the board screen. */
  app.get(
    '/api/boards/:boardId',
    route<{ boardId: string }>(async ({ userId, params }) => {
      const { board, role } = await boardAccess(parseId(params.boardId), userId, 'read');
      const lists = await c.lists.find({ boardId: board._id }).sort({ createdDate: 1, _id: 1 }).toArray();
      const tasks = await c.tasks.find({ listId: { $in: lists.map((l) => l._id) } }).toArray();
      return {
        board: await wireBoard(board),
        role,
        lists: lists.map((l) => ({
          ...wireList(l),
          tasks: tasks.filter((t) => t.listId === l._id).map(wireTask),
        })),
      };
    }),
  );

  // --- Members (owner only) -------------------------------------------------

  app.post(
    '/api/boards/:boardId/members',
    route<{ boardId: string }, { username?: unknown; permission?: unknown }>(async ({ userId, params, body }) => {
      const { board } = await boardAccess(parseId(params.boardId), userId, 'owner');
      const level = permission(body.permission);
      const invitee = typeof body.username === 'string' ? await c.users.findOne({ username: body.username }) : null;
      if (!invitee) return fail(404, `No user named ${String(body.username)}`);
      if (invitee._id === board.createdBy || board.members.some((m) => m.userId === invitee._id)) {
        fail(409, `${invitee.username} is already on this board`);
      }
      const updated = await c.boards.findOneAndUpdate(
        { _id: board._id },
        { $push: { members: { userId: invitee._id, permission: level, addedDate: now() } } },
        { returnDocument: 'after' },
      );
      return wireBoard(updated!);
    }),
  );

  app.patch(
    '/api/boards/:boardId/members/:userId',
    route<{ boardId: string; userId: string }, { permission?: unknown }>(async ({ userId, params, body }) => {
      const { board } = await boardAccess(parseId(params.boardId), userId, 'owner');
      const updated = await c.boards.findOneAndUpdate(
        { _id: board._id, 'members.userId': parseId(params.userId) },
        { $set: { 'members.$.permission': permission(body.permission) } },
        { returnDocument: 'after' },
      );
      return updated ? wireBoard(updated) : fail(404, 'Not a member');
    }),
  );

  app.delete(
    '/api/boards/:boardId/members/:userId',
    route<{ boardId: string; userId: string }>(async ({ userId, params }) => {
      const { board } = await boardAccess(parseId(params.boardId), userId, 'owner');
      const updated = await c.boards.findOneAndUpdate(
        { _id: board._id },
        { $pull: { members: { userId: parseId(params.userId) } } },
        { returnDocument: 'after' },
      );
      return wireBoard(updated!);
    }),
  );

  // --- Lists ----------------------------------------------------------------

  app.post(
    '/api/boards/:boardId/lists',
    route<{ boardId: string }, { title?: unknown }>(async ({ userId, params, body }) => {
      const { board } = await boardAccess(parseId(params.boardId), userId, 'read_write_comment');
      const list: List = {
        _id: ids.next(),
        title: text(body.title, 'title', { max: TITLE_MAX }),
        createdBy: userId,
        createdDate: now(),
        boardId: board._id,
      };
      await c.lists.insertOne(list);
      return wireList(list);
    }),
  );

  // --- Tasks ----------------------------------------------------------------

  app.post(
    '/api/lists/:listId/tasks',
    route<{ listId: string }, { title?: unknown; desc?: unknown; dueDate?: unknown }>(async ({ userId, params, body }) => {
      const list = await c.lists.findOne({ _id: parseId(params.listId) });
      if (!list) return fail(404, 'List not found');
      await boardAccess(list.boardId, userId, 'read_write_comment');
      const task: Task = {
        _id: ids.next(),
        title: text(body.title, 'title', { max: TEXT_MAX }),
        dueDate: dueDate(body.dueDate),
        done: false,
        createdBy: userId,
        createdDate: now(),
        listId: list._id,
        comments: [],
      };
      if (body.desc !== undefined) task.desc = text(body.desc, 'desc', { max: TEXT_MAX, multiline: true, optional: true });
      await c.tasks.insertOne(task);
      return wireTask(task);
    }),
  );

  app.get(
    '/api/tasks/:taskId',
    route<{ taskId: string }>(async ({ userId, params }) => {
      const { task, role } = await taskAccess(parseId(params.taskId), userId, 'read');
      const names = await usernames((task.comments ?? []).map((cm) => cm.createdBy));
      return {
        task: wireTask(task),
        role,
        usernames: Object.fromEntries([...names].map(([id, name]) => [id.toString(), name])),
      };
    }),
  );

  app.patch(
    '/api/tasks/:taskId',
    route<{ taskId: string }, { title?: unknown; desc?: unknown; dueDate?: unknown; done?: unknown }>(
      async ({ userId, params, body }) => {
        const { task } = await taskAccess(parseId(params.taskId), userId, 'read_write_comment');
        const set: Partial<Task> = {};
        if (body.title !== undefined) set.title = text(body.title, 'title', { max: TEXT_MAX });
        if (body.desc !== undefined) set.desc = text(body.desc, 'desc', { max: TEXT_MAX, multiline: true, optional: true });
        if (body.dueDate !== undefined) set.dueDate = dueDate(body.dueDate);
        if (body.done !== undefined) set.done = typeof body.done === 'boolean' ? body.done : fail(400, 'done must be true or false');
        const updated = await c.tasks.findOneAndUpdate({ _id: task._id }, { $set: set }, { returnDocument: 'after' });
        return wireTask(updated!);
      },
    ),
  );

  app.delete(
    '/api/tasks/:taskId',
    route<{ taskId: string }>(async ({ userId, params }, reply) => {
      const { task } = await taskAccess(parseId(params.taskId), userId, 'read_write_comment');
      await c.tasks.deleteOne({ _id: task._id });
      return reply.code(204).send();
    }),
  );

  app.post(
    '/api/tasks/:taskId/comments',
    route<{ taskId: string }, { text?: unknown }>(async ({ userId, params, body }) => {
      const { task } = await taskAccess(parseId(params.taskId), userId, 'read_comment');
      const comment = {
        _id: ids.next(),
        text: text(body.text, 'text', { max: TEXT_MAX, multiline: true }),
        createdBy: userId,
        createdDate: now(),
      };
      const updated = await c.tasks.findOneAndUpdate(
        { _id: task._id },
        { $push: { comments: comment } },
        { returnDocument: 'after' },
      );
      return wireTask(updated!);
    }),
  );
}
