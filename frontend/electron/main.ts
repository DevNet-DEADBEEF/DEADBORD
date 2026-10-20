/**
 * Electron main process: hosts the Expo web app in a desktop window.
 *
 * Production loads the exported web build (`npx expo export --platform web`,
 * in ../dist) from the app://deadbord origin. With `--dev-url=<url>` it loads
 * the Expo dev server instead (`npm run web`).
 *
 * Auth goes over the backend's HTTP API; boards, lists and tasks over TDLP
 * (UDP), via tdlp.ts. Which server is in config.ts.
 */

import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, net, protocol, shell, type WebContents } from 'electron';
import { AUTH_SESSION_CHANNEL, SERVER_SWITCH, SET_SERVER_CHANNEL, TDLP_BATCH_CHANNEL, type ServerInfo, type TdlpBatch } from './bridge';
import { loadServer, saveServer, validate } from './config';
import { runBatch, type TdlpConfig } from './tdlp';

const APP_ORIGIN = 'app://deadbord';
const WEB_DIR = join(__dirname, '..', 'dist');

// Launched as `electron dist-electron/main.js`, Electron would name the app
// (and its data folder, which holds the session key and config.json) "Electron".
app.setName('DEADBORD');
app.setPath('userData', join(app.getPath('appData'), 'DEADBORD'));

const SERVER = loadServer(app.getPath('userData'));
const API_URL = SERVER.apiUrl;
const DEV_URL = process.argv.find((arg) => arg.startsWith('--dev-url='))?.slice('--dev-url='.length);

const TDLP: TdlpConfig = {
  host: SERVER.tdlpHost,
  port: SERVER.tdlpPort,
  // Built with the app; see backend/src/scripts/tdlp-keygen.ts.
  publicKeyFile: process.env.DEADBORD_TDLP_PUBLIC_KEY_FILE ?? join(__dirname, '..', 'electron', 'tdlp-public.pem'),
};

/** Where the app itself lives; anything else opens in the system browser. */
const appOrigin = DEV_URL ? new URL(DEV_URL).origin : APP_ORIGIN;

// Must run before `ready`. `standard` gives app:// a real origin, so
// localStorage, fetch and the router's absolute paths work.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** Serves ../dist; unknown paths get index.html so router URLs like /boards load. */
function serveWebBuild() {
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url);
    if (host !== 'deadbord') return new Response('Not found', { status: 404 });
    const file = normalize(join(WEB_DIR, decodeURIComponent(pathname)));
    const inside = file.startsWith(WEB_DIR + sep);
    const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(WEB_DIR, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Keeps `contents` on `origin`; other links open in the system browser. */
function confineTo(contents: WebContents, origin: string) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isHttp(url)) void shell.openExternal(url);
  });
}

/**
 * Third-party login: shows the provider in a child window and waits for the
 * server to redirect to `redirect` (deadbord://auth#key=...), which never
 * actually loads.
 */
function openAuthSession(parent: BrowserWindow | null, url: string, redirect: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    let result: string | undefined;

    const intercept = (event: Electron.Event, target: string) => {
      if (!target.startsWith(redirect)) return;
      event.preventDefault();
      result = target;
      win.close();
    };
    win.webContents.on('will-redirect', intercept);
    win.webContents.on('will-navigate', intercept);
    win.webContents.setWindowOpenHandler(({ url: popup }) => {
      if (isHttp(popup)) void shell.openExternal(popup);
      return { action: 'deny' };
    });
    win.on('closed', () => resolve(result));
    void win.loadURL(url);
  });
}

ipcMain.handle(AUTH_SESSION_CHANNEL, (event, url: unknown, redirect: unknown) => {
  if (typeof url !== 'string' || !url.startsWith(`${API_URL}/`)) throw new Error('Login URL must be on the server');
  if (typeof redirect !== 'string' || !redirect.startsWith('deadbord://')) throw new Error('Bad login redirect');
  return openAuthSession(BrowserWindow.fromWebContents(event.sender), url, redirect);
});

ipcMain.handle(TDLP_BATCH_CHANNEL, (_event, batch: TdlpBatch) => runBatch(TDLP, batch));

/** Saves a new server and restarts, since the window, CORS origin and TDLP target are all set up at launch. */
ipcMain.handle(SET_SERVER_CHANNEL, (_event, settings: unknown) => {
  saveServer(app.getPath('userData'), validate(settings));
  app.relaunch();
  app.exit(0);
});

const serverInfo: ServerInfo = {
  apiUrl: SERVER.apiUrl,
  tdlpHost: SERVER.tdlpHost,
  tdlpPort: SERVER.tdlpPort,
  saved: SERVER.saved,
  overriddenBy: SERVER.overriddenBy,
};

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    title: 'DEADBORD',
    icon: join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      additionalArguments: [`${SERVER_SWITCH}${encodeURIComponent(JSON.stringify(serverInfo))}`],
    },
  });
  confineTo(win.webContents, appOrigin);
  win.once('ready-to-show', () => win.show());
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let main: BrowserWindow | undefined;

  app.on('second-instance', () => {
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.focus();
  });

  void app.whenReady().then(() => {
    if (!DEV_URL) {
      if (!existsSync(join(WEB_DIR, 'index.html'))) {
        console.error(`No web build in ${WEB_DIR}; run \`npx expo export --platform web\` first.`);
      }
      serveWebBuild();
    }
    main = createWindow();
    main.on('closed', () => (main = undefined));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) main = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
