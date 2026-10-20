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
 * - Twelve more users (alice_chen ... leo_b) with themed boards, several
 *   shared with each other at different permissions. Their login details
 *   overlap on purpose (blood types, birthdays, colors, places within a mile)
 *   so logins that match several users can be tried.
 */

import { randomBytes, randomInt } from 'node:crypto';
import { buildCredential } from '../auth/credentials.js';
import { loadConfig } from '../config.js';
import { connect, disconnect } from '../db/connection.js';
import { fromTimestamp, now, toTimestamp, type Timestamp } from '../db/epoch.js';
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

/** A comment is the owner's, or [author, text]. */
type CommentSeed = string | [User, string];
type TaskSeed = Pick<Task, 'title' | 'done'> & Partial<Pick<Task, 'desc' | 'dueDate'>> & { comments?: CommentSeed[] };

// Secrets' lookup hashes are keyed with AUTH_SECRET, so seed with the server's.
const { authSecret } = loadConfig();
const db = await connect();
const c = collections(db);
const created = now();

/**
 * Local midnight `days` from today, matching how the app stores due dates.
 * Dates can't precede the epoch (2026-10-18), so overdue tasks are moved
 * up to the first day that fits until enough time has passed.
 */
function dueIn(days: number): Timestamp {
  const d = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  const epoch = fromTimestamp(0n);
  const firstDay = new Date(epoch.getFullYear(), epoch.getMonth(), epoch.getDate() + (epoch.getHours() || epoch.getMinutes() ? 1 : 0));
  return toTimestamp(day < firstDay ? firstDay : day);
}

function credential(type: AuthObject['type'], input: Record<string, unknown> = {}): AuthObject {
  return { ...buildCredential(type, input, authSecret), createdDate: created };
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
      credential('username'),
      credential('password', { password }),
      credential('pin', { pin }),
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
  const board: Board = { _id: ids.next(), title, createdBy: owner._id, createdDate: created, members, version: 1n };
  const listDocs: List[] = [];
  const taskDocs: Task[] = [];
  for (const l of lists) {
    const list: List = { _id: ids.next(), title: l.title, createdBy: owner._id, createdDate: created, boardId: board._id, version: 1n };
    listDocs.push(list);
    for (const { comments = [], ...t } of l.tasks) {
      taskDocs.push({
        ...t,
        _id: ids.next(),
        createdBy: owner._id,
        createdDate: created,
        listId: list._id,
        comments: comments.map((c) => {
          const [author, text] = typeof c === 'string' ? [owner, c] : c;
          return { _id: ids.next(), text, createdBy: author._id, createdDate: created };
        }),
        version: 1n,
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
  credential('security_question', { question: 'What is the best todo app?', answer: 'DEADBORD' }),
  credential('favorite_color', { color: '#1e90ff' }),
  credential('birthday', { birthday: '1990-01-01' }),
  credential('blood_type', { bloodType: 'O+' }),
  credential('phone', { phone: '+1-555-555-0100' }),
  credential('slider', { position: 500 }),
  credential('reaction_time', { ms: 250 }),
  // Fort Collins, CO.
  credential('coordinates', { lat: 40.5734, lng: -105.0865 }),
  credential('paragraph', { paragraph: 'I build network protocols and todo apps, and I fly small airplanes on weekends.' }),
  credential('gov_id', { idNumber: 'TEST1782' }),
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
  credential('favorite_color', { color: '#2ecc71' }),
  credential('blood_type', { bloodType: 'A-' }),
  credential('phone', { phone: '+1-555-555-0101' }),
  credential('reaction_time', { ms: 310 }),
  credential('paragraph', { paragraph: 'I cook big dinners for friends, grow tomatoes in my garden, and fix old bicycles.' }),
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

// --- More test users -------------------------------------------------------

/** An open task due `due` days from today (undefined: no due date). */
function task(title: string, due?: number, more: Partial<TaskSeed> = {}): TaskSeed {
  return { title, done: false, ...(due !== undefined && { dueDate: dueIn(due) }), ...more };
}

const alice = await seedUser('alice_chen', [
  credential('blood_type', { bloodType: 'O+' }),
  credential('birthday', { birthday: '1990-01-01' }),
  credential('favorite_color', { color: '#1e90ff' }),
  credential('coordinates', { lat: 40.58, lng: -105.08 }),
  credential('paragraph', { paragraph: 'I run marathons, plan every detail of every trip, and keep three spreadsheets for my budget.' }),
]);
const ben = await seedUser('bmarsh', [
  credential('blood_type', { bloodType: 'A-' }),
  credential('reaction_time', { ms: 250 }),
  credential('slider', { position: 500 }),
  credential('paragraph', { paragraph: 'I play bass guitar in a garage band and repair vintage amplifiers on weekends.' }),
]);
const carmen = await seedUser('carmen.ortiz', [
  credential('blood_type', { bloodType: 'B+' }),
  credential('favorite_number', { number: 7 }),
  credential('security_question', { question: 'What was my first pet called?', answer: 'Biscuit' }),
  credential('billing_address', { street: '123 Main St', city: 'Fort Collins', state: 'CO', zip: '80521' }),
]);
const dev = await seedUser('dev_patel', [
  credential('blood_type', { bloodType: 'O+' }),
  credential('favorite_number', { number: 42 }),
  credential('reaction_time', { ms: 190 }),
  credential('gov_id', { idNumber: 'TESTDEV42' }),
  credential('paragraph', { paragraph: 'I write backend code, drink too much espresso, and am building a startup with friends.' }),
]);
const ellie = await seedUser('ellie_k', [
  credential('favorite_color', { color: '#2ecc71' }),
  credential('birthday', { birthday: '1995-06-15' }),
  credential('coordinates', { lat: 40.585, lng: -105.077 }),
  credential('paragraph', { paragraph: 'I grow vegetables, run a neighborhood book club, and read mystery novels in the garden.' }),
]);
const frank = await seedUser('frank_n', [
  credential('blood_type', { bloodType: 'AB+' }),
  credential('favorite_number', { number: 7 }),
  credential('slider', { position: 777 }),
  credential('phone', { phone: '+1-555-555-0107' }),
]);
const grace = await seedUser('grace_ho', [
  credential('birthday', { birthday: '1990-01-01' }),
  credential('favorite_color', { color: '#ff69b4' }),
  credential('reaction_time', { ms: 275 }),
  credential('gov_id', { idNumber: 'TESTGRACE1' }),
]);
const hiro = await seedUser('hiro_t', [
  credential('blood_type', { bloodType: 'A+' }),
  credential('coordinates', { lat: 35.6762, lng: 139.6503 }),
  credential('paragraph', { paragraph: 'I photograph trains, cook ramen from scratch, and am planning a trip home to Japan.' }),
]);
const isla = await seedUser('isla_m', [
  credential('blood_type', { bloodType: 'O-' }),
  credential('favorite_color', { color: '#8e44ad' }),
  credential('security_question', { question: 'Where did I go to high school?', answer: 'Poudre High' }),
  credential('paragraph', { paragraph: 'I am a graduate student writing a thesis on river ecology and I count fish for science.' }),
]);
const jamal = await seedUser('jamal_w', [
  credential('blood_type', { bloodType: 'O+' }),
  credential('reaction_time', { ms: 310 }),
  credential('slider', { position: 123 }),
  credential('phone', { phone: '+1-555-555-0110' }),
]);
const kate = await seedUser('kate_r', [
  credential('birthday', { birthday: '1988-03-30' }),
  credential('favorite_color', { color: '#ff69b4' }),
  credential('bank', { routing: '011000015', account: '000123456789' }),
  credential('paragraph', { paragraph: 'I organize office parties, coach youth soccer, and never miss a deadline at work.' }),
]);
const leo = await seedUser('leo_b', [
  credential('blood_type', { bloodType: 'B-' }),
  credential('coordinates', { lat: 40.5853, lng: -105.0844 }),
  credential('credit_card', { number: '4242424242424242', exp: '12/30', cvv: '123' }),
  credential('paragraph', { paragraph: 'I host board game nights, change my own oil, and restore old cars in my garage.' }),
]);

await seedBoard(
  alice,
  'Wedding Planning',
  [
    {
      title: 'Venue',
      tasks: [
        task('Tour the botanical garden', -3),
        task('Sign the venue contract', 4, { desc: 'Deposit is due when we sign.', comments: [[carmen, 'I can come with you to read the fine print.']] }),
        task('Book the caterer', 18),
        task('Visit the lodge in Estes Park', -10, { done: true }),
      ],
    },
    {
      title: 'Guests',
      tasks: [
        task('Finalize the guest list', 1, { comments: [[grace, 'Do not forget the cousins from Denver!'], 'Added them, thanks.'] }),
        task('Order invitations', 9),
        task('Mail save-the-dates', 45),
      ],
    },
    { title: 'Day Of', tasks: [task('Write vows', 150), task('Pick a playlist'), task('Arrange shuttles from the hotel', 160)] },
  ],
  [member(carmen, 'read_write_comment'), member(grace, 'read_comment')],
);
await seedBoard(alice, 'Running Log', [
  {
    title: 'Training',
    tasks: [task('Long run, 18 miles', 2), task('Tempo run', 0), task('Buy new running shoes', 6), task('Recovery week', -1, { done: true })],
  },
  { title: 'Races', tasks: [task('Register for the Horsetooth Half', 25), task('Denver Marathon', 340)] },
]);

await seedBoard(
  ben,
  'Garage Band',
  [
    {
      title: 'Setlist',
      tasks: [
        task('Learn the bridge of the new song', 1, { comments: [[hiro, 'I recorded a demo, it is in the shared drive.']] }),
        task('Pick a closing song', 5),
        task('Cut the drum solo down', undefined, { comments: [[dev, 'Never.'], 'It is six minutes long, Dev.'] }),
      ],
    },
    { title: 'Gear', tasks: [task('Replace bass strings', -2), task('Fix the crackling amp', 3), task('Buy a new mic stand', 30)] },
    { title: 'Gigs', tasks: [task('Coffee shop open mic', 8), task('Battle of the bands signup', 20), task('Summer festival application', 200)] },
  ],
  [member(dev, 'read_write_comment'), member(hiro, 'read_write_comment'), member(jamal, 'read')],
);

await seedBoard(
  carmen,
  'Spanish Class',
  [
    {
      title: 'Homework',
      tasks: [
        task('Chapter 4 worksheet', 0),
        task('Record a 2 minute speaking sample', 2, { comments: [[isla, 'Can we practice together on Thursday?']] }),
        task('Chapter 3 quiz corrections', -4, { done: true }),
      ],
    },
    { title: 'Vocab', tasks: [task('Food and cooking words', 6), task('Irregular past tense verbs', 13), task('Final exam review', 52)] },
  ],
  [member(isla, 'read_comment')],
);

await seedBoard(
  dev,
  'Startup MVP',
  [
    {
      title: 'Backlog',
      tasks: [task('Billing page'), task('Dark mode'), task('Export to CSV', 90), task('Mobile app', 300)],
    },
    {
      title: 'This Sprint',
      tasks: [
        task('Sign-up flow', 1, { comments: [[ellie, 'Designs are ready for review.']] }),
        task('Password reset email', 3),
        task('Onboarding checklist', 5, { comments: [[kate, 'Can we keep it under five steps?'], 'Agreed, four steps max.'] }),
        task('Set up CI', -2, { done: true }),
      ],
    },
    {
      title: 'Bugs',
      tasks: [
        task('Login button does nothing on Safari', -1, { desc: 'Reported by two beta users.', comments: [[leo, 'Same for me on my iPad.']] }),
        task('Dates show in UTC', 2),
      ],
    },
  ],
  [member(ellie, 'read_write_comment'), member(kate, 'read_write_comment'), member(leo, 'read'), member(pilot1782, 'read_comment')],
);

await seedBoard(ellie, 'Garden', [
  {
    title: 'Planting',
    tasks: [task('Start tomato seedlings indoors', 7), task('Order garlic bulbs', 12), task('Plant tulip bulbs', 28), task('Build a raised bed', 160)],
  },
  { title: 'Chores', tasks: [task('Water the herbs', 0), task('Turn the compost', 1), task('Weed the front bed', -3)] },
]);
await seedBoard(
  ellie,
  'Book Club',
  [
    {
      title: 'Reading',
      tasks: [
        task('Finish chapters 10-15', 4, { comments: [[grace, 'No spoilers please!'], [isla, 'Chapter 12 is wild.']] }),
        task('Vote on next month book', 10),
        task('Pick the summer reading list', 95),
      ],
    },
    { title: 'Meetings', tasks: [task('Book the library room', 2), task('Bring snacks', 11, { comments: [[kate, 'I will bring cookies.']] })] },
  ],
  [member(grace, 'read_comment'), member(isla, 'read_comment'), member(kate, 'read_comment')],
);

await seedBoard(
  frank,
  'Fantasy Football League',
  [
    {
      title: 'League Admin',
      tasks: [
        task('Collect league dues', -5, { comments: [[jamal, 'Sent mine on Venmo.'], [leo, 'Paying Friday, promise.']] }),
        task('Set the trade deadline', 6),
        task('Order the trophy', 40),
      ],
    },
    { title: 'My Team', tasks: [task('Set lineup for Sunday', 0), task('Pick up a backup kicker', 1), task('Draft day snacks', 300)] },
  ],
  [member(jamal, 'read_write_comment'), member(leo, 'read_write_comment'), member(ben, 'read_comment')],
);

await seedBoard(
  grace,
  'Moving Apartments',
  [
    {
      title: 'Pack',
      tasks: [
        task('Get boxes from the liquor store', -1),
        task('Pack the kitchen', 3, { comments: [[hiro, 'I can help Saturday morning.']] }),
        task('Pack the books', 5),
      ],
    },
    { title: 'Utilities', tasks: [task('Cancel old internet', 12), task('Set up electricity', 8), task('Forward mail', 9)] },
    { title: 'Unpack', tasks: [task('Hang curtains', 20), task('Throw a housewarming party', 35)] },
  ],
  [member(hiro, 'read_write_comment')],
);

await seedBoard(
  hiro,
  'Japan Trip',
  [
    {
      title: 'Before We Go',
      tasks: [
        task('Renew passport', -2, { desc: 'Takes 6-8 weeks, do it now!' }),
        task('Buy JR rail passes', 15, { comments: [[grace, 'I found a cheaper option online.']] }),
        task('Book flights', 6),
        task('Exchange yen', 70),
      ],
    },
    { title: 'Tokyo', tasks: [task('Reserve a ramen class'), task('Visit the train museum', 80), task('Shibuya at night', 81)] },
    { title: 'Kyoto', tasks: [task('Fushimi Inari at sunrise', 84), task('Book a ryokan', 21)] },
  ],
  [member(grace, 'read_write_comment'), member(pilot1783, 'read')],
);

await seedBoard(
  isla,
  'Thesis',
  [
    {
      title: 'Research',
      tasks: [task('Fish counts at site B', 0), task('Analyze water samples', 4), task('Literature review for chapter 2', -6, { done: true })],
    },
    {
      title: 'Writing',
      tasks: [
        task('Draft chapter 3', 10, { comments: [[carmen, 'Happy to proofread when it is ready.']] }),
        task('Make figures for chapter 2', 2),
        task('Send draft to advisor', 27),
      ],
    },
    { title: 'Defense', tasks: [task('Schedule the defense', 60), task('Practice talk', 180)] },
  ],
  [member(carmen, 'read_comment')],
);

await seedBoard(jamal, 'Gym Plan', [
  {
    title: 'This Week',
    tasks: [task('Leg day', 0), task('Upper body', 1), task('Rest day', 2), task('Deadlift PR attempt', 5)],
  },
  { title: 'Goals', tasks: [task('Run a 5K under 25 minutes', 30), task('Bench 225', 120), task('Find a new gym')] },
]);

await seedBoard(
  kate,
  'Office Party',
  [
    {
      title: 'Planning',
      tasks: [
        task('Book the rooftop', -1, { comments: [[ellie, 'They only have Friday open.']] }),
        task('Send the invite', 2),
        task('Order catering', 7, { comments: [[dev, 'Vegetarian options please!']] }),
      ],
    },
    { title: 'Day Of', tasks: [task('Pick up the cake', 14), task('Set up decorations', 14), task('Holiday party next year', 400)] },
  ],
  [member(dev, 'read_write_comment'), member(ellie, 'read_write_comment'), member(leo, 'read')],
);

await seedBoard(leo, 'Car Maintenance', [
  {
    title: 'Daily Driver',
    tasks: [task('Oil change', -7), task('Rotate tires', 3), task('Replace wiper blades', 9), task('Registration renewal', 150)],
  },
  { title: 'Project Car', tasks: [task('Order the carburetor kit', 1), task('Rebuild the carburetor', 24), task('Paint job', 365)] },
]);
await seedBoard(
  leo,
  'Board Game Night',
  [
    {
      title: 'Next Game Night',
      tasks: [
        task('Pick the game', 1, { comments: [[ben, 'Wingspan again?'], [frank, 'Something with fewer birds.'], [kate, 'I vote Catan.']] }),
        task('Buy snacks', 3),
        task('Clean the game table', 3),
      ],
    },
    { title: 'Wishlist', tasks: [task('Buy the Gloomhaven expansion', 45), task('Replace the missing Catan pieces')] },
  ],
  [member(frank, 'read_comment'), member(ben, 'read_comment'), member(jamal, 'read_comment'), member(kate, 'read_comment')],
);

await disconnect();
