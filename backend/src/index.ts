import { loadConfig } from './config.js';
import { connect } from './db/connection.js';
import { buildServer } from './http/server.js';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const config = loadConfig();
const db = await connect();
const { app, sessions } = await buildServer(db, config);

setInterval(() => {
  sessions.purgeExpired().catch((err) => app.log.error(err));
}, PURGE_INTERVAL_MS).unref();

await app.listen({ port: config.port, host: config.host });
