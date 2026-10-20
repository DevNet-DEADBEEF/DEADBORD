import { desktop } from '@/desktop';
import { sortTasks } from '@/tasks';
import type { TdlpAction, TdlpReply, TdlpResource, TdlpScope } from '../../electron/bridge';
import { ApiError } from './request';
import { escapeText, unescapeText } from './text';
import {
  COMMENT_MAX,
  TEXT_MAX,
  TITLE_MAX,
  type Board,
  type BoardSummary,
  type BoardView,
  type Id,
  type List,
  type NewTask,
  type Permission,
  type Role,
  type Task,
  type TaskPatch,
  type TaskSummary,
  type TaskView,
} from './types';

/**
 * Board, list and task data. Calls act as the logged-in user (logging in is
 * handled by src/auth).
 */
export interface DeadbordClient {
  /** Called whenever the session key changes; undefined when logged out. */
  setSessionKey(key: string | undefined): void;

  listBoards(): Promise<BoardSummary[]>;
  createBoard(title: string): Promise<Board>;
  /** A board with its lists and their tasks. */
  getBoard(boardId: Id): Promise<BoardView>;
  /** Just the board and its members. */
  getBoardSummary(boardId: Id): Promise<BoardSummary>;

  getLists(boardId: Id): Promise<List[]>;
  createList(boardId: Id, title: string): Promise<List>;

  getTask(taskId: Id): Promise<TaskView>;
  createTask(listId: Id, input: NewTask): Promise<Task>;
  updateTask(taskId: Id, patch: TaskPatch): Promise<Task>;
  removeTask(taskId: Id): Promise<void>;
  addComment(taskId: Id, text: string): Promise<Task>;

  /** Owner only. */
  inviteMember(boardId: Id, username: string, permission: Permission): Promise<Board>;
  setMemberPermission(boardId: Id, userId: Id, permission: Permission): Promise<Board>;
  removeMember(boardId: Id, userId: Id): Promise<Board>;
}

// LMP codes (Notion: TDLP / LMP).
const Scope = { Board: 0, List: 1, Task: 2 } as const;
const Action = { Create: 0, Update: 1, Delete: 2, Obtain: 3, UpdatePerm: 4 } as const;
const Response = { Done: 0, Reject: 1, Nope: 2, Conflict: 3 } as const;

/** Largest LMP payload. */
const MAX_PAYLOAD = 500;
/** Actions per TDLP connection. INIT lists every resource a connection touches, so keep it modest. */
const BATCH_SIZE = 128;
/** Board 0 stands for "my boards": OBTAIN `boards` on it, and new boards are made under it. */
const ROOT = '0';

interface Act {
  scope: TdlpScope;
  /** The target; unused by CREATE. */
  id: Id;
  code: number;
  payload: string[][];
  version?: number;
  /** INIT resources; defaults to the target. CREATE names the parent instead. */
  resources?: TdlpResource[];
}

interface Done {
  version: number;
  /** One `[name, ...values]` row per property. */
  rows: string[][];
}

/** A row's values after the property name. */
type Values = string[];

/** Bytes a TLON row takes. */
const rowSize = (row: string[]) => row.reduce((n, v) => n + v.length + 1, 0);

/** `text` escaped for TLON, if it fits in `max`. */
function wire(text: string, max: number, field: string): string {
  const escaped = escapeText(text);
  if (escaped.length > max) throw new ApiError(`${field} is too long (${escaped.length}/${max}; line breaks count as 2)`);
  return escaped;
}

const dueDate = (value: string) => (value === '' ? null : Number(value));

function createdId(rows: string[][]): Id {
  const id = rows.find((r) => r[0] === 'id')?.[1];
  if (!id) throw new ApiError('The server did not say what it created');
  return id;
}

/**
 * Talks LMP over TDLP through the desktop app (electron/tdlp.ts). Each call
 * opens one or more connections, each a batch of actions. OBTAIN asks for
 * one property per action. The properties are documented in
 * backend/src/tdlp/actions.ts.
 */
class TdlpClient implements DeadbordClient {
  private key: string | undefined;
  /** Last version seen per `scope:id`, which UPDATE, DELETE and UPDATE_PERM must name. */
  private readonly versions = new Map<string, number>();

  setSessionKey(key: string | undefined): void {
    this.key = key;
    this.versions.clear();
  }

  // --- Transport ----------------------------------------------------------

  /** Runs `acts` over as many connections as BATCH_SIZE needs; throws on the first that fails. */
  private async run(acts: Act[]): Promise<Done[]> {
    if (!desktop) throw new ApiError('Boards need the DEADBORD desktop app');
    if (!this.key) throw new ApiError('Not logged in');
    const batches: Act[][] = [];
    for (let i = 0; i < acts.length; i += BATCH_SIZE) batches.push(acts.slice(i, i + BATCH_SIZE));
    return (await Promise.all(batches.map((batch) => this.batch(batch)))).flat();
  }

  private async batch(acts: Act[]): Promise<Done[]> {
    const resources = new Map<string, TdlpResource>();
    for (const a of acts) {
      for (const r of a.resources ?? [{ scope: a.scope, id: a.id }]) resources.set(`${r.scope}:${r.id}`, r);
    }
    const actions: TdlpAction[] = acts.map((a) => ({
      scope: a.scope,
      code: a.code,
      scopeId: a.code === Action.Create ? '0' : a.id,
      actionId: crypto.randomUUID(),
      version: a.version,
      payload: a.payload,
    }));
    const result = await desktop!.tdlpBatch({ sessionKey: this.key!, resources: [...resources.values()], actions });
    if ('error' in result) throw new ApiError(result.error);
    return result.replies.map((reply, i) => this.done(acts[i], reply));
  }

  private done(act: Act, reply: TdlpReply | { error: string }): Done {
    if ('error' in reply) throw new ApiError(reply.error);
    if (reply.code === Response.Reject) throw new ApiError("You don't have permission to do that");
    if (reply.code === Response.Nope) throw new ApiError(reply.payload[0]?.[0] ?? "The server couldn't do that");
    if (reply.code === Response.Conflict) throw new ApiError('Someone else changed this; reload and try again');
    const version = reply.version ?? 0;
    if (act.code === Action.Create) this.versions.set(`${act.scope}:${createdId(reply.payload)}`, version);
    else if (act.code === Action.Delete) this.versions.delete(`${act.scope}:${act.id}`);
    else this.versions.set(`${act.scope}:${act.id}`, version);
    return { version, rows: reply.payload };
  }

  /** The version to send with a change, from the last time we saw it. */
  private async versionOf(scope: TdlpScope, id: Id): Promise<number> {
    const known = this.versions.get(`${scope}:${id}`);
    if (known !== undefined) return known;
    const [{ version }] = await this.run([{ scope, id, code: Action.Obtain, payload: [['role']] }]);
    return version;
  }

  /** OBTAINs `properties` on each of `ids`, one action each: id -> property -> values. */
  private async fields(scope: TdlpScope, ids: Id[], properties: string[]): Promise<Map<Id, Record<string, Values>>> {
    const acts = ids.flatMap((id) => properties.map((p): Act => ({ scope, id, code: Action.Obtain, payload: [[p]] })));
    const results = await this.run(acts);
    const found = new Map(ids.map((id) => [id, {} as Record<string, Values>]));
    results.forEach(({ rows }, i) => {
      const [name, ...values] = rows[0] ?? [];
      found.get(acts[i].id)![name] = values;
    });
    return found;
  }

  /** Follows a paged property (boards, lists, tasks, members) on each of `ids` to its end: id -> items of `width` values. */
  private async pages(scope: TdlpScope, ids: Id[], name: string, width = 1): Promise<Map<Id, string[][]>> {
    const found = new Map(ids.map((id) => [id, [] as string[][]]));
    let pending = ids.map((id) => ({ id, offset: 0 }));
    while (pending.length) {
      const asked = pending;
      const results = await this.run(
        asked.map(({ id, offset }) => ({ scope, id, code: Action.Obtain, payload: [[offset ? `${name}@${offset}` : name]] })),
      );
      pending = [];
      results.forEach(({ rows }, i) => {
        const [, next = '', ...values] = rows[0] ?? [];
        const items = found.get(asked[i].id)!;
        for (let j = 0; j < values.length; j += width) items.push(values.slice(j, j + width));
        if (next && Number(next) > asked[i].offset) pending.push({ id: asked[i].id, offset: Number(next) });
      });
    }
    return found;
  }

  /** UPDATEs `rows`, split into as many packets as they need, each naming the version the last one left. */
  private async update(scope: TdlpScope, id: Id, rows: string[][]): Promise<void> {
    const packets: string[][][] = [];
    let size = MAX_PAYLOAD;
    for (const row of rows) {
      if (size + rowSize(row) > MAX_PAYLOAD) {
        packets.push([]);
        size = 0;
      }
      packets.at(-1)!.push(row);
      size += rowSize(row);
    }
    for (const payload of packets) {
      await this.run([{ scope, id, code: Action.Update, version: await this.versionOf(scope, id), payload }]);
    }
  }

  // --- Boards -------------------------------------------------------------

  private async summaries(ids: Id[]): Promise<BoardSummary[]> {
    const [fields, members] = await Promise.all([
      this.fields(Scope.Board, ids, ['title', 'owner', 'created', 'role']),
      this.pages(Scope.Board, ids, 'members', 3),
    ]);
    return ids.map((id) => {
      const f = fields.get(id)!;
      return {
        board: {
          id,
          title: unescapeText(f.title[0]),
          createdBy: f.owner[0],
          createdDate: Number(f.created[0]),
          members: members.get(id)!.map(([userId, username, permission]) => ({
            userId,
            username: username || 'deleted user',
            permission: permission as Permission,
          })),
        },
        role: f.role[0] as Role,
      };
    });
  }

  async listBoards() {
    const ids = (await this.pages(Scope.Board, [ROOT], 'boards')).get(ROOT)!.map(([id]) => id);
    return this.summaries(ids);
  }

  async createBoard(title: string) {
    const [{ rows }] = await this.run([
      { scope: Scope.Board, id: ROOT, code: Action.Create, payload: [[wire(title.trim(), TITLE_MAX, 'Title')]] },
    ]);
    return (await this.summaries([createdId(rows)]))[0].board;
  }

  async getBoardSummary(boardId: Id) {
    return (await this.summaries([boardId]))[0];
  }

  async getBoard(boardId: Id): Promise<BoardView> {
    const listIds = (await this.pages(Scope.Board, [boardId], 'lists')).get(boardId)!.map(([id]) => id);
    const [summary, lists, taskIds] = await Promise.all([
      this.getBoardSummary(boardId),
      this.listsById(boardId, listIds),
      this.pages(Scope.List, listIds, 'tasks'),
    ]);
    const ids = [...taskIds.values()].flat().map(([id]) => id);
    const fields = await this.fields(Scope.Task, ids, ['title', 'due', 'done']);
    const summarize = (id: Id, listId: Id): TaskSummary => {
      const f = fields.get(id)!;
      return { id, listId, title: unescapeText(f.title[0]), dueDate: dueDate(f.due[0]), done: f.done[0] === '1' };
    };
    return {
      ...summary,
      lists: lists.map((l) => ({ ...l, tasks: sortTasks(taskIds.get(l.id)!.map(([id]) => summarize(id, l.id))) })),
    };
  }

  // --- Members (owner only) -----------------------------------------------

  private async setPermissions(boardId: Id, rows: string[][]): Promise<Board> {
    const version = await this.versionOf(Scope.Board, boardId);
    await this.run([{ scope: Scope.Board, id: boardId, code: Action.UpdatePerm, version, payload: rows }]);
    return (await this.getBoardSummary(boardId)).board;
  }

  inviteMember(boardId: Id, username: string, permission: Permission) {
    return this.setPermissions(boardId, [[`@${username}`, permission]]);
  }

  setMemberPermission(boardId: Id, userId: Id, permission: Permission) {
    return this.setPermissions(boardId, [[userId, permission]]);
  }

  removeMember(boardId: Id, userId: Id) {
    return this.setPermissions(boardId, [[userId, 'none']]);
  }

  // --- Lists --------------------------------------------------------------

  private async listsById(boardId: Id, ids: Id[]): Promise<List[]> {
    const fields = await this.fields(Scope.List, ids, ['title', 'owner', 'created']);
    return ids.map((id) => {
      const f = fields.get(id)!;
      return { id, boardId, title: unescapeText(f.title[0]), createdBy: f.owner[0], createdDate: Number(f.created[0]) };
    });
  }

  async getLists(boardId: Id) {
    const ids = (await this.pages(Scope.Board, [boardId], 'lists')).get(boardId)!.map(([id]) => id);
    return this.listsById(boardId, ids);
  }

  async createList(boardId: Id, title: string) {
    const [{ rows }] = await this.run([
      {
        scope: Scope.List,
        id: '',
        code: Action.Create,
        resources: [{ scope: Scope.Board, id: boardId }],
        payload: [[wire(title.trim(), TITLE_MAX, 'Title')]],
      },
    ]);
    return (await this.listsById(boardId, [createdId(rows)]))[0];
  }

  // --- Tasks --------------------------------------------------------------

  async getTask(taskId: Id): Promise<TaskView> {
    const properties = ['title', 'desc', 'due', 'done', 'owner', 'created', 'role', 'list', 'commentcount'];
    const f = (await this.fields(Scope.Task, [taskId], properties)).get(taskId)!;
    const count = Number(f.commentcount[0]);
    const comments = await this.run(
      Array.from({ length: count }, (_, i): Act => ({
        scope: Scope.Task,
        id: taskId,
        code: Action.Obtain,
        payload: [['comments', String(i)]],
      })),
    );
    const usernames: Record<Id, string> = {};
    if (f.owner[1]) usernames[f.owner[0]] = f.owner[1];
    const task: Task = {
      id: taskId,
      title: unescapeText(f.title[0]),
      desc: unescapeText(f.desc[0]),
      dueDate: dueDate(f.due[0]),
      done: f.done[0] === '1',
      createdBy: f.owner[0],
      createdDate: Number(f.created[0]),
      listId: f.list[0],
      // Rows are `comments, index, text, authorId, authorName, created`.
      comments: comments.map(({ rows: [[, index, text, authorId, authorName, created]] }) => {
        if (authorName) usernames[authorId] = authorName;
        return { id: index, text: unescapeText(text), createdBy: authorId, createdDate: Number(created) };
      }),
    };
    return { task, role: f.role[0] as Role, usernames };
  }

  async createTask(listId: Id, input: NewTask) {
    const [{ rows }] = await this.run([
      {
        scope: Scope.Task,
        id: '',
        code: Action.Create,
        resources: [{ scope: Scope.List, id: listId }],
        payload: [[wire(input.title.trim(), TEXT_MAX, 'Title')]],
      },
    ]);
    // CREATE only takes a title; the rest is an UPDATE.
    const id = createdId(rows);
    const patch: TaskPatch = {};
    if (input.desc) patch.desc = input.desc;
    if (input.dueDate != null) patch.dueDate = input.dueDate;
    return this.updateTask(id, patch);
  }

  async updateTask(taskId: Id, patch: TaskPatch) {
    const rows: string[][] = [];
    if (patch.title !== undefined) rows.push(['title', wire(patch.title.trim(), TEXT_MAX, 'Title')]);
    if (patch.desc !== undefined) rows.push(['desc', wire(patch.desc, TEXT_MAX, 'Description')]);
    if (patch.dueDate !== undefined) rows.push(['due', patch.dueDate == null ? '' : String(patch.dueDate)]);
    if (patch.done !== undefined) rows.push(['done', patch.done ? '1' : '0']);
    if (rows.length) await this.update(Scope.Task, taskId, rows);
    return (await this.getTask(taskId)).task;
  }

  async removeTask(taskId: Id) {
    const version = await this.versionOf(Scope.Task, taskId);
    await this.run([{ scope: Scope.Task, id: taskId, code: Action.Delete, version, payload: [] }]);
  }

  async addComment(taskId: Id, text: string) {
    // New comments go at the end, so ask where that is now.
    const [{ version, rows }] = await this.run([{ scope: Scope.Task, id: taskId, code: Action.Obtain, payload: [['commentcount']] }]);
    const comment = ['comments', rows[0][1], wire(text.trim(), COMMENT_MAX, 'Comment')];
    await this.run([{ scope: Scope.Task, id: taskId, code: Action.Update, version, payload: [comment] }]);
    return (await this.getTask(taskId)).task;
  }
}

export const client: DeadbordClient = new TdlpClient();
