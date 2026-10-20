import { loadConfig } from './config.js';
import { connect } from './db/connection.js';
import { addMissingVersions } from './db/models.js';
import { buildServer } from './http/server.js';
import { startTdlp } from './tdlp/server.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const config = loadConfig();
const db = await connect();
await addMissingVersions(db);
const { app, sessions } = await buildServer(db, config);

setInterval(() => {
  sessions.purgeExpired().catch((err) => app.log.error(err));
}, PURGE_INTERVAL_MS).unref();

await app.listen({ port: config.port, host: config.host });
await startTdlp(db, config, sessions, app.log);
