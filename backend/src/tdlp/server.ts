/**
 * TDLP server (the @deadbord/tdlp library, in ../TDLP): boards, lists and
 * tasks over UDP. A connection's INIT carries the session key and every
 * resource it will touch; authorize() lets it open only if the session can
 * read all of them. actions.ts then handles each LMP action.
 */

import { readFileSync } from 'node:fs';
import { Dispatcher, Scope } from '@deadbord/lmp';
import { Server, type Resource } from '@deadbord/tdlp';
import type { Db } from 'mongodb';
import { parseKey, type SessionStore } from '../auth/sessions.js';
import type { Config } from '../config.js';
import { boardRole, collections } from '../db/models.js';
import type { Id } from '../db/snowflake.js';
import { lmpHandler, type ActionContext } from './actions.js';

/**
 * How long a finished action's response is kept, so a retried action ID gets
 * the same answer instead of running twice. Past this, a very late retry
 * would run again.
 */
const ACTION_TTL_MS = 10 * 60_000;
/** The dispatcher refuses new actions once this many are remembered. */
const MAX_REMEMBERED_ACTIONS = 50_000;

interface Log {
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** True if every resource exists and `userId` can at least read its board. */
async function canReadAll(db: Db, resources: Resource[], userId: Id): Promise<boolean> {
  const c = collections(db);
  const of = (scope: number) => [...new Set(resources.filter((r) => r.scope === scope && r.id !== 0n).map((r) => r.id))];

  const taskIds = of(Scope.Task);
  const tasks = taskIds.length ? await c.tasks.find({ _id: { $in: taskIds } }, { projection: { listId: 1 } }).toArray() : [];
  if (tasks.length !== taskIds.length) return false;

  const listIds = [...new Set([...of(Scope.List), ...tasks.map((t) => t.listId)])];
  const lists = listIds.length ? await c.lists.find({ _id: { $in: listIds } }, { projection: { boardId: 1 } }).toArray() : [];
  if (lists.length !== listIds.length) return false;

  const boardIds = [...new Set([...of(Scope.Board), ...lists.map((l) => l.boardId)])];
  const boards = boardIds.length ? await c.boards.find({ _id: { $in: boardIds } }).toArray() : [];
  return boards.length === boardIds.length && boards.every((b) => boardRole(b, userId));
}

export async function startTdlp(db: Db, config: Config, sessions: SessionStore, log: Log): Promise<Server> {
  let privateKey: Buffer;
  try {
    privateKey = readFileSync(config.tdlp.privateKeyFile);
  } catch {
    throw new Error(`No TDLP private key at ${config.tdlp.privateKeyFile}; run \`npm run tdlp:keygen\` (or set TDLP_PRIVATE_KEY_FILE)`);
  }

  const dispatcher = new Dispatcher<ActionContext>(lmpHandler(db, log), {
    ttlMs: ACTION_TTL_MS,
    maxEntries: MAX_REMEMBERED_ACTIONS,
  });

  const server = new Server({
    privateKey,
    dispatcher,
    async authorize({ sessionKey, resources }) {
      const key = parseKey(sessionKey);
      const session = key === undefined ? undefined : await sessions.resolve(key);
      if (!session || !(await canReadAll(db, resources, session.userId))) return null;
      return { principal: session.userId.toString(), userId: session.userId };
    },
  });
  server.on('invalidPacket', (err) => log.debug(err, 'Invalid TDLP packet'));
  server.on('networkError', (err) => log.warn(err, 'TDLP network error'));

  const address = await server.listen(config.tdlp.port, config.tdlp.host);
  log.info(`TDLP listening on udp://${address.address}:${address.port}`);
  return server;
}
