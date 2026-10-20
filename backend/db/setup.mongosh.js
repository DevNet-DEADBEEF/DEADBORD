// Applies the DEADBORD schema validators and indexes. Safe to re-run.
// Mirrors Notion: CSU / DevNet / Todo List / DB Layout/Schemas.
//
//   npm run db:setup     (reads MONGO_* from backend/.env)

const user = encodeURIComponent(process.env.MONGO_ROOT_USER);
const pass = encodeURIComponent(process.env.MONGO_ROOT_PASSWORD);
const conn = connect(`mongodb://${user}:${pass}@${process.env.MONGO_HOST}/${process.env.MONGO_DB || 'DEADBORD'}?authSource=admin`);

// Unsigned 32-bit seconds since the DEADBORD epoch (2026-10-18T06:00Z).
const date = { bsonType: 'long', minimum: 0, maximum: 4294967295 };
const id = { bsonType: 'long' };
// u32, bumped on every change; LMP UPDATE/DELETE must name the current version.
const version = { bsonType: 'long', minimum: 1, maximum: 4294967295 };
// Free text is capped at 450 characters so records fit in a 500-byte TLON message.
const TEXT_MAX = 450;
// Text is ASCII only: printable characters, plus tab/newlines in multi-line fields.
const ASCII_LINE = '^[\\x20-\\x7E]*$';
const ASCII_TEXT = '^[\\x20-\\x7E\\t\\r\\n]*$';

const schemas = {
  Users: {
    bsonType: 'object',
    title: 'User Record',
    required: ['_id', 'username', 'createdDate', 'credentials'],
    additionalProperties: false,
    properties: {
      _id: id,
      username: { bsonType: 'string', minLength: 1, maxLength: 32, pattern: ASCII_LINE },
      createdDate: date,
      credentials: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          title: 'Auth Object',
          required: ['type', 'createdDate', 'mfa'],
          additionalProperties: false,
          properties: {
            type: {
              bsonType: 'string',
              enum: [
                'lucky', 'username', 'password', 'google', 'microsoft',
                'chatgpt', 'discord', 'roblox', 'sso', 'email', 'phone',
                'billing_address', 'gov_id', 'favorite_color', 'pin',
                'security_question', 'credit_card', 'debit_card', 'bank',
                'blood_type', 'birthday', 'favorite_number', 'paragraph',
                'slider', 'coordinates', 'reaction_time',
              ],
            },
            createdDate: date,
            mfa: { bsonType: 'string', enum: ['is', 'knows', 'has'] },
            data: { bsonType: 'object' },
          },
        },
      },
    },
  },
  Bords: {
    bsonType: 'object',
    title: 'Board',
    required: ['_id', 'title', 'createdBy', 'createdDate', 'members', 'version'],
    additionalProperties: false,
    properties: {
      _id: id,
      title: { bsonType: 'string', minLength: 1, maxLength: 128, pattern: ASCII_LINE },
      createdBy: id,
      createdDate: date,
      members: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['userId', 'permission'],
          additionalProperties: false,
          properties: {
            userId: id,
            permission: { bsonType: 'string', enum: ['read', 'read_comment', 'read_write_comment'] },
            addedDate: date,
          },
        },
      },
      version,
    },
  },
  Lists: {
    bsonType: 'object',
    title: 'Task List',
    required: ['_id', 'title', 'createdBy', 'createdDate', 'boardId', 'version'],
    additionalProperties: false,
    properties: {
      _id: id,
      title: { bsonType: 'string', minLength: 1, maxLength: 128, pattern: ASCII_LINE },
      createdBy: id,
      createdDate: date,
      boardId: id,
      version,
    },
  },
  Tasks: {
    bsonType: 'object',
    title: 'Task Data',
    required: ['_id', 'title', 'done', 'createdBy', 'createdDate', 'listId', 'version'],
    additionalProperties: false,
    properties: {
      _id: id,
      title: { bsonType: 'string', minLength: 1, maxLength: TEXT_MAX, pattern: ASCII_LINE },
      desc: { bsonType: 'string', maxLength: TEXT_MAX, pattern: ASCII_TEXT },
      dueDate: { bsonType: ['long', 'null'], minimum: 0, maximum: 4294967295 },
      done: { bsonType: 'bool' },
      createdBy: id,
      createdDate: date,
      listId: id,
      comments: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'text', 'createdBy', 'createdDate'],
          additionalProperties: false,
          properties: {
            _id: id,
            text: { bsonType: 'string', minLength: 1, maxLength: TEXT_MAX, pattern: ASCII_TEXT },
            createdBy: id,
            createdDate: date,
          },
        },
      },
      version,
    },
  },
};

// Session keys are 64 random bits; only a 64-bit SHA-256 prefix of the key is stored.
schemas.Sessions = {
  bsonType: 'object',
  title: 'Session',
  required: ['_id', 'userId', 'createdDate', 'expiresDate'],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'long', description: 'Hash of the session key' },
    userId: id,
    createdDate: date,
    expiresDate: date,
    rotatedDate: { ...date, description: 'Set once the key has been rotated; it then expires after a short grace period' },
  },
};

// Email login codes; only an HMAC of the code is stored.
schemas.Verifications = {
  bsonType: 'object',
  title: 'Email Verification',
  required: ['_id', 'email', 'codeHash', 'createdDate', 'expiresDate', 'attempts'],
  additionalProperties: false,
  properties: {
    _id: id,
    email: { bsonType: 'string', maxLength: 254 },
    codeHash: { bsonType: 'string' },
    createdDate: date,
    expiresDate: date,
    attempts: { bsonType: 'int', minimum: 0 },
  },
};

const indexes = {
  Users: [
    [{ username: 1 }, { unique: true }],
    // Third-party logins: data.subject is "<provider>:<provider user id>".
    [{ 'credentials.data.subject': 1 }, { unique: true, partialFilterExpression: { 'credentials.data.subject': { $exists: true } } }],
    // Logins find users by the methods they enrolled in.
    [{ 'credentials.type': 1 }],
  ],
  Bords: [[{ createdBy: 1 }], [{ 'members.userId': 1 }]],
  Lists: [[{ boardId: 1 }]],
  // Board view: a list's tasks sorted by due date.
  Tasks: [[{ listId: 1, dueDate: 1 }]],
  // Revoke-all for a user, and purging expired sessions.
  Sessions: [[{ userId: 1 }], [{ expiresDate: 1 }]],
  Verifications: [[{ email: 1 }], [{ expiresDate: 1 }]],
};

const existing = new Set(conn.getCollectionNames());

for (const [name, schema] of Object.entries(schemas)) {
  const validation = { validator: { $jsonSchema: schema }, validationLevel: 'strict', validationAction: 'error' };
  if (existing.has(name)) conn.runCommand({ collMod: name, ...validation });
  else conn.createCollection(name, validation);
  for (const [keys, options] of indexes[name]) conn[name].createIndex(keys, options);
  print(`${name}: validator applied, indexes ${JSON.stringify(conn[name].getIndexes().map((i) => i.key))}`);
}

// Documents from before versions existed start at version 1. This runs after
// the validators above, which allow (and require) the field.
for (const name of ['Bords', 'Lists', 'Tasks']) {
  const { modifiedCount } = conn[name].updateMany({ version: { $exists: false } }, { $set: { version: NumberLong('1') } });
  if (modifiedCount) print(`${name}: set version 1 on ${modifiedCount} document(s)`);
}
