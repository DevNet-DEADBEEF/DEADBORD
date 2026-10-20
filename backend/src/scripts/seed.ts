/**
 * Seeds test users enrolled in several login methods, and their boards.
 * Re-running skips any user or board (matched by owner and title) that
 * already exists.
 *
 *   npm run db:seed
 *
 * - pilot1782: "Test Board" (two lists, four tasks each).
 * - pilot1783: "Groceries" (shared with pilot1782, read/write/comment) and
 *   "Home Projects", one list and three tasks each.
 */

import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { connect, disconnect } from '../db/connection.js';
import { now, toTimestamp, type Timestamp } from '../db/epoch.js';
import {
  collections,
  type AuthObject,
  type Board,
  type BoardMember,
  type List,
  type Task,
  type User,
} from '../db/models.js';
import { ids } from '../db/snowflake.js';

type TaskSeed = Pick<Task, 'title' | 'done'> & Partial<Pick<Task, 'desc' | 'dueDate'>> & { comments?: string[] };

const db = await connect();
const c = collections(db);
const created = now();

/** scrypt hash for knowledge factors (password, pin, security answer). */
function hashSecret(secret: string): { hash: string; salt: string } {
  const salt = randomBytes(16);
  return { hash: scryptSync(secret, salt, 32).toString('hex'), salt: salt.toString('hex') };
}

/** Local midnight `days` from today, matching how the app stores due dates. */
function dueIn(days: number): Timestamp {
  const d = new Date();
  return toTimestamp(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

function credential(type: AuthObject['type'], mfa: AuthObject['mfa'], data?: AuthObject['data']): AuthObject {
  return data ? { type, createdDate: created, mfa, data } : { type, createdDate: created, mfa };
}

/** Creates a user enrolled in username, password and PIN plus `extra`; prints the generated secrets once. */
async function seedUser(username: string, extra: AuthObject[]): Promise<User> {
  const existing = await c.users.findOne({ username });
  if (existing) {
    console.log(`User ${username} already exists (${existing._id})`);
    return existing;
  }
  const password = randomBytes(9).toString('base64url');
  const pin = String(randomInt(10_000)).padStart(4, '0');
  const user: User = {
    _id: ids.next(),
    username,
    createdDate: created,
    credentials: [
      credential('username', 'knows'),
      credential('password', 'knows', hashSecret(password)),
      credential('pin', 'knows', hashSecret(pin)),
      ...extra,
    ],
  };
  await c.users.insertOne(user);
  console.log(`Created user ${username} (${user._id})`);
  console.log(`  password: ${password}`);
  console.log(`  pin:      ${pin}`);
  return user;
}

/**
 * Creates a board with its lists and tasks. Every document is built before
 * the first write, so a bad value can't leave a half-seeded board.
 */
async function seedBoard(
  owner: User,
  title: string,
  lists: { title: string; tasks: TaskSeed[] }[],
  members: BoardMember[] = [],
): Promise<void> {
  const existing = await c.boards.findOne({ createdBy: owner._id, title });
  if (existing) {
    console.log(`Board "${title}" already exists (${existing._id})`);
    return;
  }
  const board: Board = { _id: ids.next(), title, createdBy: owner._id, createdDate: created, members };
  const listDocs: List[] = [];
  const taskDocs: Task[] = [];
  for (const l of lists) {
    const list: List = { _id: ids.next(), title: l.title, createdBy: owner._id, createdDate: created, boardId: board._id };
    listDocs.push(list);
    for (const { comments = [], ...t } of l.tasks) {
      taskDocs.push({
        ...t,
        _id: ids.next(),
        createdBy: owner._id,
        createdDate: created,
        listId: list._id,
        comments: comments.map((text) => ({ _id: ids.next(), text, createdBy: owner._id, createdDate: created })),
      });
    }
  }
  await c.boards.insertOne(board);
  await c.lists.insertMany(listDocs);
  await c.tasks.insertMany(taskDocs);
  const shared = members.length ? `, shared with ${members.length} member(s)` : '';
  console.log(`Created board "${title}" (${board._id}) with ${listDocs.length} list(s) and ${taskDocs.length} task(s)${shared}`);
}

function member(user: User, permission: BoardMember['permission']): BoardMember {
  return { userId: user._id, permission, addedDate: created };
}

// --- pilot1782 -------------------------------------------------------------

const pilot1782 = await seedUser('pilot1782', [
  credential('security_question', 'knows', { question: 'What is the best todo app?', ...hashSecret('DEADBORD') }),
  credential('favorite_color', 'knows', { color: '#1e90ff' }),
  credential('birthday', 'knows', { birthday: '1990-01-01' }),
  credential('blood_type', 'is', { bloodType: 'O+' }),
  credential('phone', 'has', { phone: '+1-555-0100' }),
]);

await seedBoard(pilot1782, 'Test Board', [
  {
    title: 'To Do',
    tasks: [
      { title: 'Renew car registration', dueDate: dueIn(-2), done: false },
      { title: 'Buy groceries', desc: 'Milk, eggs, bread, coffee', dueDate: dueIn(0), done: false, comments: ["Don't forget the coffee."] },
      { title: 'Schedule dentist appointment', dueDate: dueIn(7), done: false },
      { title: 'Clean out the garage', done: false },
    ],
  },
  {
    title: 'DEADBORD',
    tasks: [
      {
        title: 'Design the TLON format',
        desc: 'Every TLON message must fit within 500 bytes.',
        dueDate: dueIn(-1),
        done: false,
        comments: ['Fixed-width header, then ASCII key=value fields?'],
      },
      { title: 'Set up MongoDB validators', dueDate: dueIn(-2), done: true },
      { title: 'Implement OAuth2 login', dueDate: dueIn(2), done: false },
      { title: 'Write the TDLP handshake', dueDate: dueIn(14), done: false },
    ],
  },
]);

// --- pilot1783 -------------------------------------------------------------

const pilot1783 = await seedUser('pilot1783', [
  credential('favorite_color', 'knows', { color: '#2ecc71' }),
  credential('blood_type', 'is', { bloodType: 'A-' }),
  credential('phone', 'has', { phone: '+1-555-0101' }),
]);

await seedBoard(
  pilot1783,
  'Groceries',
  [
    {
      title: 'Shopping List',
      tasks: [
        { title: 'Apples and bananas', dueDate: dueIn(0), done: false },
        { title: 'Ground coffee', desc: 'The dark roast, not the decaf.', dueDate: dueIn(1), done: false, comments: ['We are almost out!'] },
        { title: 'Paper towels', dueDate: dueIn(-1), done: true },
      ],
    },
  ],
  [member(pilot1782, 'read_write_comment')],
);

await seedBoard(pilot1783, 'Home Projects', [
  {
    title: 'This Weekend',
    tasks: [
      { title: 'Fix the leaky faucet', dueDate: dueIn(-1), done: false },
      { title: 'Paint the fence', desc: 'Two coats. Check the forecast first.', dueDate: dueIn(5), done: false },
      { title: 'Hang shelves in the office', done: false },
    ],
  },
]);

await disconnect();
