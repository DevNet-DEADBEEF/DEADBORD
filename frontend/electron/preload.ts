/**
 * Runs in the sandboxed renderer before the app. Exposes the DesktopBridge
 * as `window.deadbord`; the app never gets Node or ipcRenderer directly.
 *
 * Sandboxed preloads can only require 'electron', so this file imports types
 * alone; the strings below must match SERVER_SWITCH and the channels in
 * bridge.ts.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, ServerInfo } from './bridge';

const SERVER_SWITCH = '--deadbord-server=';
const AUTH_SESSION_CHANNEL = 'auth:open-session';
const TDLP_BATCH_CHANNEL = 'tdlp:batch';
const SET_SERVER_CHANNEL = 'server:set';

const server = JSON.parse(
  decodeURIComponent(process.argv.find((arg) => arg.startsWith(SERVER_SWITCH))?.slice(SERVER_SWITCH.length) ?? '%7B%7D'),
) as ServerInfo;

const bridge: DesktopBridge = {
  apiUrl: server.apiUrl ?? '',
  server,
  setServer: (settings) => ipcRenderer.invoke(SET_SERVER_CHANNEL, settings),
  openAuthSession: (url, redirect) => ipcRenderer.invoke(AUTH_SESSION_CHANNEL, url, redirect),
  tdlpBatch: (batch) => ipcRenderer.invoke(TDLP_BATCH_CHANNEL, batch),
};

contextBridge.exposeInMainWorld('deadbord', bridge);
