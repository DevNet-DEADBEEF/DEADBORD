/**
 * DEADBORD's LMP actions (Notion: TDLP / LMP). TDLP has already checked that
 * the session can read every resource named in INIT, and that each action
 * targets one of them (CREATE excepted); this checks the permission each
 * action needs, versions, and field values.
 *
 * Properties, by scope (OBTAIN `name`, UPDATE `name, value`):
 *
 *   board 0  boards@n                       (the caller's boards)
 *   board    title owner created role lists@n members@n
 *   list     title owner created role board tasks@n
 *   task     title desc due done owner created role list commentcount
 *
 * OBTAIN answers with one row per property, `[name, ...values]`:
 *   owner     id, username
 *   created   epoch seconds;  due: epoch seconds or ''  done: 0 or 1
 *   commentcount  the number of comments; `[comments, i]` gives
 *             `comments, i, text, authorId, authorName, created`. (LMP reserves
 *             `comments` for indexed rows, so the count has its own name.)
 *   lists@n, tasks@n, boards@n, members@n
 *             a page from offset n (default 0): `name, next, ...items`, where
 *             `next` is the offset of the next page or '' after the last one.
 *             members items are `userId, username, permission`.
 * Text values are escaped (text.ts). Every DONE carries the target's version
 * (0 for board 0); UPDATE, DELETE and UPDATE_PERM must name the current one.
 *
 * CREATE has no scope ID, so a new list goes in the one board, and a new task
 * in the one list, named in INIT. A board CREATE needs no parent. Payload:
 * the title. DONE: `[id, newId]`.
 *
 * UPDATE_PERM rows are `userId, permission` or `@username, permission`;
 * permission `none` removes the member.
 */

import { Action, MAX_PAYLOAD, Response, Scope, type Packet } from '@deadbord/lmp';
import type { Context } from '@deadbord/tdlp';
import type { Collection, Db, Filter, UpdateFilter } from 'mongodb';
import { now, TIMESTAMP_MAX } from '../db/epoch.js';
import {
  ASCII_LINE,
  ASCII_TEXT,
  boardRole,
  collections,
  COMMENT_MAX,
  PERMISSIONS,
  TEXT_MAX,
  TITLE_MAX,
  type Board,
  type List,
  type Permission,
  type Role,
  type Task,
  type Version,
} from '../db/models.js';
import { ids, type Id } from '../db/snowflake.js';
import { escapeText, unescapeText } from './text.js';

export type Reply = Pick<Packet, 'code' | 'version' | 'payload'>;

/** What authorize() in server.ts adds to the TDLP context. */
export type ActionContext = Context & { userId: Id };

class Fail extends Error {
  constructor(readonly reply: Reply) {
    super('LMP action failed');
  }
}

const reject = (): never => {
  throw new Fail({ code: Response.Reject });
};

const nope = (message: string): never => {
  throw new Fail({ code: Response.Nope, payload: [[message]] });
};

const conflict = (expected: Version, current: Version): never => {
  throw new Fail({ code: Response.Conflict, payload: [[expected.toString()], [current.toString()]] });
};

const done = (version: Version, payload: string[][] = []): Reply => ({
  code: Response.Done,
  version: Number(version),
  payload,
});

function allows(role: Role, needed: Permission | 'owner'): boolean {
  if (role === 'owner') return true;
  return needed !== 'owner' && PERMISSIONS.indexOf(role) >= PERMISSIONS.indexOf(needed);
}

function need(role: Role, needed: Permission | 'owner') {
  if (!allows(role, needed)) reject();
}

/** Bytes a TLON row takes: its values, plus one separator or terminator each. */
const rowSize = (row: string[]) => row.reduce((n, v) => n + v.length + 1, 0);

/**
 * The page of `items` (each a group of values) starting at `offset` that fits
 * in `budget` bytes, as `[name, next, ...values]`.
 */
function page(name: string, items: string[][], offset: number, budget: number): string[] {
  // Room for `next` at its longest.
  let used = name.length + String(items.length).length + 2;
  let end = offset;
  for (; end < items.length; end++) {
    const size = rowSize(items[end]);
    if (used + size > budget) break;
    used += size;
  }
  if (end === offset && end < items.length) nope(`No room to send ${name}`);
  return [name, end < items.length ? String(end) : '', ...items.slice(offset, end).flat()];
}

// --- Field values -------------------------------------------------------------

function titleValue(wire: string, max: number): string {
  if (wire.length > max) nope(`Titles are at most ${max} characters`);
  const text = unescapeText(wire)?.trim() ?? nope('Bad escape in title');
  if (!text) nope('Title is required');
  if (!ASCII_LINE.test(text)) nope('Titles are one line');
  return text;
}

function textValue(wire: string, field: string, max: number): string {
  if (wire.length > max) nope(`${field} is at most ${max} characters (line breaks count as 2)`);
  const text = unescapeText(wire) ?? nope(`Bad escape in ${field}`);
  if (!ASCII_TEXT.test(text)) nope(`${field} must be ASCII`);
  return text;
}

function dueValue(wire: string): bigint | null {
  if (wire === '') return null;
  if (!/^\d{1,10}$/.test(wire) || BigInt(wire) > TIMESTAMP_MAX) nope('due must be epoch seconds, or empty');
  return BigInt(wire);
}

function idValue(wire: string): Id {
  return /^\d{1,20}$/.test(wire) && BigInt(wire) < 1n << 64n ? BigInt(wire) : nope('Bad ID');
}

/** The single value of a payload like `[[title]]`. */
function single(payload: string[][]): string {
  return payload.length === 1 && payload[0].length === 1 ? payload[0][0] : nope('Expected a single value');
}

/** Splits `tasks@20` into its name and offset. */
function pageRequest(property: string): { name: string; offset: number } {
  const match = /^([a-z]+)(?:@(\d{1,6}))?$/.exec(property);
  return match ? { name: match[1], offset: Number(match[2] ?? 0) } : { name: property, offset: 0 };
}

const unknownProperty = (name: string): never => nope(`Unknown property ${name.slice(0, 40)}`);

// --- Handler ------------------------------------------------------------------

export function lmpHandler(db: Db, log: { error(obj: unknown, msg?: string): void }) {
  const c = collections(db);

  async function usernames(userIds: Id[]): Promise<Map<Id, string>> {
    const users = await c.users.find({ _id: { $in: [...new Set(userIds)] } }, { projection: { username: 1 } }).toArray();
    return new Map(users.map((u) => [u._id, u.username]));
  }

  async function username(userId: Id): Promise<string> {
    return (await c.users.findOne({ _id: userId }, { projection: { username: 1 } }))?.username ?? '';
  }

  async function loadBoard(boardId: Id, userId: Id) {
    const board = (await c.boards.findOne({ _id: boardId })) ?? nope('Board not found');
    const role = boardRole(board, userId) ?? reject();
    return { board, role };
  }

  async function loadList(listId: Id, userId: Id) {
    const list = (await c.lists.findOne({ _id: listId })) ?? nope('List not found');
    return { list, ...(await loadBoard(list.boardId, userId)) };
  }

  async function loadTask(taskId: Id, userId: Id) {
    const task = (await c.tasks.findOne({ _id: taskId })) ?? nope('Task not found');
    return { task, ...(await loadList(task.listId, userId)) };
  }

  function checkVersion(current: Version, expected: number | undefined) {
    if (BigInt(expected ?? -1) !== current) conflict(BigInt(expected ?? 0), current);
  }

  /** Applies `update` if the document is still at `expected`, bumping its version. */
  async function commit<T extends { _id: Id; version: Version }>(
    coll: Collection<T>,
    id: Id,
    expected: Version,
    update: UpdateFilter<T>,
  ): Promise<Version> {
    const updated = await coll.findOneAndUpdate(
      { _id: id, version: expected } as Filter<T>,
      // long + int stays a long. (The driver's types can't see `version` through T.)
      { ...update, $inc: { version: 1 } } as unknown as UpdateFilter<T>,
      { returnDocument: 'after' },
    );
    if (updated) return updated.version;
    const current = (await coll.findOne({ _id: id } as Filter<T>)) ?? nope('It was deleted');
    return conflict(expected, current.version);
  }

  /** The one resource of `scope` in INIT, which a CREATE goes into. */
  function parent(ctx: ActionContext, scope: number, kind: string): Id {
    const found = ctx.resources.filter((r) => r.scope === scope && r.id !== 0n);
    return found.length === 1 ? found[0].id : nope(`CREATE needs exactly one ${kind} in INIT`);
  }

  // --- OBTAIN ---------------------------------------------------------------

  async function obtainRoot(property: string, ctx: ActionContext, budget: number): Promise<string[]> {
    const { name, offset } = pageRequest(property);
    if (name !== 'boards') unknownProperty(property);
    const boards = await c.boards
      .find({ $or: [{ createdBy: ctx.userId }, { 'members.userId': ctx.userId }] }, { projection: { _id: 1 } })
      .sort({ createdDate: 1, _id: 1 })
      .toArray();
    return page(name, boards.map((b) => [b._id.toString()]), offset, budget);
  }

  async function obtainBoard(board: Board, role: Role, property: string, budget: number): Promise<string[]> {
    const { name, offset } = pageRequest(property);
    switch (name) {
      case 'title':
        return [name, escapeText(board.title)];
      case 'owner':
        return [name, board.createdBy.toString(), await username(board.createdBy)];
      case 'created':
        return [name, board.createdDate.toString()];
      case 'role':
        return [name, role];
      case 'lists': {
        const lists = await c.lists.find({ boardId: board._id }, { projection: { _id: 1 } }).sort({ createdDate: 1, _id: 1 }).toArray();
        return page(name, lists.map((l) => [l._id.toString()]), offset, budget);
      }
      case 'members': {
        const names = await usernames(board.members.map((m) => m.userId));
        const items = board.members.map((m) => [m.userId.toString(), names.get(m.userId) ?? '', m.permission]);
        return page(name, items, offset, budget);
      }
    }
    return unknownProperty(property);
  }

  async function obtainList(list: List, role: Role, property: string, budget: number): Promise<string[]> {
    const { name, offset } = pageRequest(property);
    switch (name) {
      case 'title':
        return [name, escapeText(list.title)];
      case 'owner':
        return [name, list.createdBy.toString(), await username(list.createdBy)];
      case 'created':
        return [name, list.createdDate.toString()];
      case 'role':
        return [name, role];
      case 'board':
        return [name, list.boardId.toString()];
      case 'tasks': {
        const tasks = await c.tasks.find({ listId: list._id }, { projection: { _id: 1 } }).sort({ createdDate: 1, _id: 1 }).toArray();
        return page(name, tasks.map((t) => [t._id.toString()]), offset, budget);
      }
    }
    return unknownProperty(property);
  }

  async function obtainTask(task: Task, role: Role, row: string[]): Promise<string[]> {
    const [name] = row;
    const comments = task.comments ?? [];
    if (name === 'comments' && row.length === 2) {
      const index = Number(row[1]);
      const comment = comments[index] ?? nope(`No comment ${row[1]}`);
      const author = await username(comment.createdBy);
      return [name, row[1], escapeText(comment.text), comment.createdBy.toString(), author, comment.createdDate.toString()];
    }
    switch (name) {
      case 'title':
        return [name, escapeText(task.title)];
      case 'desc':
        return [name, escapeText(task.desc ?? '')];
      case 'due':
        return [name, task.dueDate == null ? '' : task.dueDate.toString()];
      case 'done':
        return [name, task.done ? '1' : '0'];
      case 'owner':
        return [name, task.createdBy.toString(), await username(task.createdBy)];
      case 'created':
        return [name, task.createdDate.toString()];
      case 'role':
        return [name, role];
      case 'list':
        return [name, task.listId.toString()];
      case 'commentcount':
        return [name, String(comments.length)];
    }
    return unknownProperty(name);
  }

  async function obtain(req: Packet, ctx: ActionContext): Promise<Reply> {
    let version: Version = 0n;
    let property: (row: string[], budget: number) => Promise<string[]>;
    if (req.scope === Scope.Board && req.scopeId === 0n) {
      property = (row, budget) => obtainRoot(row[0], ctx, budget);
    } else if (req.scope === Scope.Board) {
      const { board, role } = await loadBoard(req.scopeId, ctx.userId);
      version = board.version;
      property = (row, budget) => obtainBoard(board, role, row[0], budget);
    } else if (req.scope === Scope.List) {
      const { list, role } = await loadList(req.scopeId, ctx.userId);
      version = list.version;
      property = (row, budget) => obtainList(list, role, row[0], budget);
    } else {
      const { task, role } = await loadTask(req.scopeId, ctx.userId);
      version = task.version;
      property = (row) => obtainTask(task, role, row);
    }
    const rows: string[][] = [];
    let used = 0;
    for (const row of req.payload ?? []) {
      const value = await property(row, MAX_PAYLOAD - used);
      used += rowSize(value);
      if (used > MAX_PAYLOAD) nope('Too much to send at once; ask for fewer properties');
      rows.push(value);
    }
    return done(version, rows);
  }

  // --- CREATE ---------------------------------------------------------------

  async function create(req: Packet, ctx: ActionContext): Promise<Reply> {
    const id = ids.next();
    const created = now();
    if (req.scope === Scope.Board) {
      const title = titleValue(single(req.payload ?? []), TITLE_MAX);
      await c.boards.insertOne({ _id: id, title, createdBy: ctx.userId, createdDate: created, members: [], version: 1n });
    } else if (req.scope === Scope.List) {
      const { board, role } = await loadBoard(parent(ctx, Scope.Board, 'board'), ctx.userId);
      need(role, 'read_write_comment');
      const title = titleValue(single(req.payload ?? []), TITLE_MAX);
      await c.lists.insertOne({ _id: id, title, createdBy: ctx.userId, createdDate: created, boardId: board._id, version: 1n });
    } else {
      const { list, role } = await loadList(parent(ctx, Scope.List, 'list'), ctx.userId);
      need(role, 'read_write_comment');
      const title = titleValue(single(req.payload ?? []), TEXT_MAX);
      await c.tasks.insertOne({
        _id: id,
        title,
        dueDate: null,
        done: false,
        createdBy: ctx.userId,
        createdDate: created,
        listId: list._id,
        comments: [],
        version: 1n,
      });
    }
    return done(1n, [['id', id.toString()]]);
  }

  // --- UPDATE ---------------------------------------------------------------

  async function update(req: Packet, ctx: ActionContext): Promise<Reply> {
    const rows = req.payload ?? [];
    if (req.scope === Scope.Board) {
      if (req.scopeId === 0n) nope("Board 0 can't change");
      const { board, role } = await loadBoard(req.scopeId, ctx.userId);
      need(role, 'owner');
      checkVersion(board.version, req.version);
      const set: Partial<Board> = {};
      for (const [name, value] of rows) {
        if (name === 'title') set.title = titleValue(value, TITLE_MAX);
        else unknownProperty(name);
      }
      return done(await commit(c.boards, board._id, board.version, { $set: set }));
    }

    if (req.scope === Scope.List) {
      const { list, role } = await loadList(req.scopeId, ctx.userId);
      need(role, 'read_write_comment');
      checkVersion(list.version, req.version);
      const set: Partial<List> = {};
      for (const [name, value] of rows) {
        if (name === 'title') set.title = titleValue(value, TITLE_MAX);
        else unknownProperty(name);
      }
      return done(await commit(c.lists, list._id, list.version, { $set: set }));
    }

    const { task, role } = await loadTask(req.scopeId, ctx.userId);
    checkVersion(task.version, req.version);
    const set: Partial<Task> = {};
    const added: NonNullable<Task['comments']> = [];
    const count = task.comments?.length ?? 0;
    for (const row of rows) {
      const [name, value] = row;
      if (name === 'comments') {
        need(role, 'read_comment');
        // Comments can only be added, at the end.
        if (Number(row[1]) !== count + added.length) nope(`New comments go at index ${count + added.length}`);
        const text = textValue(row[2], 'Comment', COMMENT_MAX);
        if (!text.trim()) nope('Comment is empty');
        added.push({ _id: ids.next(), text, createdBy: ctx.userId, createdDate: now() });
        continue;
      }
      need(role, 'read_write_comment');
      if (name === 'title') set.title = titleValue(value, TEXT_MAX);
      else if (name === 'desc') set.desc = textValue(value, 'Description', TEXT_MAX);
      else if (name === 'due') set.dueDate = dueValue(value);
      else if (name === 'done') set.done = value === '1' ? true : value === '0' ? false : nope('done must be 0 or 1');
      else unknownProperty(name);
    }
    const change: UpdateFilter<Task> = { $set: set };
    if (added.length) change.$push = { comments: { $each: added } };
    return done(await commit(c.tasks, task._id, task.version, change));
  }

  // --- DELETE ---------------------------------------------------------------

  /** Deletes `id` if it is still at `expected`. */
  async function remove<T extends { _id: Id; version: Version }>(coll: Collection<T>, id: Id, expected: Version) {
    const { deletedCount } = await coll.deleteOne({ _id: id, version: expected } as Filter<T>);
    if (!deletedCount) {
      const current = (await coll.findOne({ _id: id } as Filter<T>)) ?? nope('Already deleted');
      conflict(expected, current.version);
    }
  }

  async function del(req: Packet, ctx: ActionContext): Promise<Reply> {
    if (req.scope === Scope.Board) {
      if (req.scopeId === 0n) nope("Board 0 can't be deleted");
      const { board, role } = await loadBoard(req.scopeId, ctx.userId);
      need(role, 'owner');
      checkVersion(board.version, req.version);
      await remove(c.boards, board._id, board.version);
      const lists = await c.lists.find({ boardId: board._id }, { projection: { _id: 1 } }).toArray();
      await c.tasks.deleteMany({ listId: { $in: lists.map((l) => l._id) } });
      await c.lists.deleteMany({ boardId: board._id });
      return done(board.version + 1n);
    }
    if (req.scope === Scope.List) {
      const { list, role } = await loadList(req.scopeId, ctx.userId);
      need(role, 'read_write_comment');
      checkVersion(list.version, req.version);
      await remove(c.lists, list._id, list.version);
      await c.tasks.deleteMany({ listId: list._id });
      return done(list.version + 1n);
    }
    const { task, role } = await loadTask(req.scopeId, ctx.userId);
    need(role, 'read_write_comment');
    checkVersion(task.version, req.version);
    await remove(c.tasks, task._id, task.version);
    return done(task.version + 1n);
  }

  // --- UPDATE_PERM ----------------------------------------------------------

  async function updatePermissions(req: Packet, ctx: ActionContext): Promise<Reply> {
    if (req.scopeId === 0n) nope('Board 0 has no members');
    const { board, role } = await loadBoard(req.scopeId, ctx.userId);
    need(role, 'owner');
    checkVersion(board.version, req.version);
    const members = [...board.members];
    for (const [who, permission] of req.payload ?? []) {
      if (permission !== 'none' && !(PERMISSIONS as readonly string[]).includes(permission)) nope(`Unknown permission ${permission.slice(0, 40)}`);
      const byName = who.startsWith('@');
      const user = byName
        ? await c.users.findOne({ username: who.slice(1) }, { projection: { _id: 1 } })
        : await c.users.findOne({ _id: idValue(who) }, { projection: { _id: 1 } });
      if (!user) nope(byName ? `No user named ${who.slice(1)}` : 'No such user');
      if (user!._id === board.createdBy) nope("The owner's access can't change");
      const index = members.findIndex((m) => m.userId === user!._id);
      if (permission === 'none') {
        if (index >= 0) members.splice(index, 1);
      } else if (index >= 0) {
        members[index] = { ...members[index], permission: permission as Permission };
      } else {
        members.push({ userId: user!._id, permission: permission as Permission, addedDate: now() });
      }
    }
    return done(await commit(c.boards, board._id, board.version, { $set: { members } }));
  }

  return async (req: Packet, ctx: ActionContext): Promise<Reply> => {
    try {
      switch (req.code) {
        case Action.Create:
          return await create(req, ctx);
        case Action.Update:
          return await update(req, ctx);
        case Action.Delete:
          return await del(req, ctx);
        case Action.Obtain:
          return await obtain(req, ctx);
        case Action.UpdatePerm:
          return await updatePermissions(req, ctx);
      }
      return nope('Unknown action');
    } catch (err) {
      if (err instanceof Fail) return err.reply;
      log.error(err, 'LMP action failed');
      throw err; // the dispatcher answers with a generic NOPE
    }
  };
}
