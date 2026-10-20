/**
 * Which server the desktop app connects to. Saved in config.json in the
 * app's data folder (next to the session key) and changed from the login
 * screen. Environment variables, when set, win over the file:
 *
 *   DEADBORD_API_URL     HTTP server, for auth (default http://localhost:3000)
 *   DEADBORD_TDLP_HOST   TDLP (UDP) server (default: the API URL's host)
 *   DEADBORD_TDLP_PORT   TDLP port (default 3001)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerSettings } from './bridge';

const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_TDLP_PORT = 3001;

export interface Server {
  apiUrl: string;
  tdlpHost: string;
  tdlpPort: number;
  /** What config.json (or the defaults) says, for the settings form. */
  saved: ServerSettings;
  /** Set when an environment variable overrides the saved settings. */
  overriddenBy?: string;
}

const HOST = /^[A-Za-z0-9.-]{1,253}$|^\[[0-9A-Fa-f:.]+\]$/;

/** Checks settings from the file or the app; throws with a message the app can show. */
export function validate(input: unknown): ServerSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const apiUrl = typeof s.apiUrl === 'string' ? s.apiUrl.trim().replace(/\/+$/, '') : '';
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('Enter the server address, like http://192.168.1.10:3000');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The server address must start with http:// or https://');
  const settings: ServerSettings = { apiUrl: url.origin };
  if (s.tdlpHost !== undefined && s.tdlpHost !== '') {
    if (typeof s.tdlpHost !== 'string' || !HOST.test(s.tdlpHost.trim())) throw new Error('The TDLP host must be a host name or IP address');
    settings.tdlpHost = s.tdlpHost.trim();
  }
  if (s.tdlpPort !== undefined && s.tdlpPort !== '') {
    const port = Number(s.tdlpPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The TDLP port must be 1-65535');
    settings.tdlpPort = port;
  }
  return settings;
}

const fileIn = (dataDir: string) => join(dataDir, 'config.json');

function readSaved(dataDir: string): ServerSettings {
  const file = fileIn(dataDir);
  if (!existsSync(file)) return { apiUrl: DEFAULT_API_URL };
  try {
    return validate(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    console.error(`Ignoring ${file}: ${(err as Error).message}`);
    return { apiUrl: DEFAULT_API_URL };
  }
}

export function loadServer(dataDir: string, env = process.env): Server {
  const saved = readSaved(dataDir);
  const apiUrl = (env.DEADBORD_API_URL || saved.apiUrl).replace(/\/+$/, '');
  const overrides = ['DEADBORD_API_URL', 'DEADBORD_TDLP_HOST', 'DEADBORD_TDLP_PORT'].filter((name) => env[name]);
  return {
    apiUrl,
    // new URL().hostname keeps IPv6 brackets, which the UDP socket doesn't want.
    tdlpHost: env.DEADBORD_TDLP_HOST || saved.tdlpHost || new URL(apiUrl).hostname.replace(/^\[|\]$/g, ''),
    tdlpPort: Number(env.DEADBORD_TDLP_PORT || saved.tdlpPort || DEFAULT_TDLP_PORT),
    saved,
    overriddenBy: overrides.length ? overrides.join(', ') : undefined,
  };
}

export function saveServer(dataDir: string, settings: ServerSettings): void {
  writeFileSync(fileIn(dataDir), `${JSON.stringify(settings, null, 2)}\n`);
}
