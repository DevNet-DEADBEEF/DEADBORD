/**
 * What the Electron preload exposes to the web app as `window.deadbord`.
 * Type-only, so the app (src/desktop.ts) can import it without pulling in
 * Electron code.
 */
export interface DesktopBridge {
  /** Backend base URL, e.g. http://localhost:3000 (no trailing slash). */
  apiUrl: string;
  /** The server in use, and what is saved (electron/config.ts). */
  server: ServerInfo;
  /** Saves which server to use and restarts the app to connect to it. Rejects with a message if invalid. */
  setServer(settings: ServerSettings): Promise<void>;
  /**
   * Opens `url` in a login window and resolves with the URL the server
   * redirected to once it starts with `redirect`, or undefined if the user
   * closed the window first.
   */
  openAuthSession(url: string, redirect: string): Promise<string | undefined>;
  /** Runs one TDLP connection: INIT with `resources`, then every action. */
  tdlpBatch(batch: TdlpBatch): Promise<TdlpBatchResult>;
}

/** Which server to connect to, as saved in config.json. Unset TDLP fields follow the API URL's host and port 3001. */
export interface ServerSettings {
  apiUrl: string;
  tdlpHost?: string;
  tdlpPort?: number;
}

export interface ServerInfo {
  apiUrl: string;
  tdlpHost: string;
  tdlpPort: number;
  saved: ServerSettings;
  /** Environment variables overriding the saved settings, if any; the app can't change those. */
  overriddenBy?: string;
}

/** 0 board, 1 list, 2 task (LMP scopes). */
export type TdlpScope = 0 | 1 | 2;

/** IDs are decimal strings: 64-bit snowflakes don't fit a JS number, and IPC can't carry bigints. */
export interface TdlpResource {
  scope: TdlpScope;
  id: string;
}

/** An LMP action (see @deadbord/lmp), minus the response flag. */
export interface TdlpAction {
  scope: TdlpScope;
  /** CREATE 0, UPDATE 1, DELETE 2, OBTAIN 3, UPDATE_PERM 4. */
  code: number;
  scopeId: string;
  /** UUID; reuse it when retrying the same action. */
  actionId: string;
  /** Required on UPDATE, DELETE and UPDATE_PERM. */
  version?: number;
  /** TLON entries. */
  payload: string[][];
}

/** An LMP response: DONE 0, REJECT 1, NOPE 2, CONFLICT 3. */
export interface TdlpReply {
  code: number;
  version?: number;
  payload: string[][];
}

export interface TdlpBatch {
  sessionKey: string;
  resources: TdlpResource[];
  actions: TdlpAction[];
}

/**
 * `error` when the connection failed (rejected, unreachable, expired);
 * otherwise one entry per action, in order, which is an error if that action
 * got no response.
 */
export type TdlpBatchResult = { error: string } | { replies: (TdlpReply | { error: string })[] };

/** IPC channels behind the bridge. */
export const AUTH_SESSION_CHANNEL = 'auth:open-session';
export const TDLP_BATCH_CHANNEL = 'tdlp:batch';
export const SET_SERVER_CHANNEL = 'server:set';

/** Command-line switch the main process uses to hand the server (ServerInfo, URI-encoded JSON) to the preload. */
export const SERVER_SWITCH = '--deadbord-server=';
