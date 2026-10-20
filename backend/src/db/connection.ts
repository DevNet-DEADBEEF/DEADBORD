import { MongoClient, type Db } from 'mongodb';

const DEFAULT_DB_NAME = 'deadbord';

let client: MongoClient | undefined;

function mongoUri(): string {
  const { MONGO_ROOT_USER, MONGO_ROOT_PASSWORD, MONGO_HOST } = process.env;
  if (!MONGO_ROOT_USER || !MONGO_ROOT_PASSWORD || !MONGO_HOST) {
    throw new Error('MONGO_ROOT_USER, MONGO_ROOT_PASSWORD and MONGO_HOST must be set');
  }
  const user = encodeURIComponent(MONGO_ROOT_USER);
  const pass = encodeURIComponent(MONGO_ROOT_PASSWORD);
  // Root users live in the admin database.
  return `mongodb://${user}:${pass}@${MONGO_HOST}/?authSource=admin`;
}

export async function connect(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri());
    await client.connect();
  }
  return client.db(process.env.MONGO_DB ?? DEFAULT_DB_NAME);
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = undefined;
}
