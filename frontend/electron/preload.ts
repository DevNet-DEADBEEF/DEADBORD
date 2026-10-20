/**
 * Runs in the sandboxed renderer before the app. Exposes the DesktopBridge
 * as `window.deadbord`; the app never gets Node or ipcRenderer directly.
 *
 * Sandboxed preloads can only require 'electron', so this file imports types
 * alone; the strings below must match API_URL_SWITCH, AUTH_SESSION_CHANNEL
 * and TDLP_BATCH_CHANNEL in bridge.ts.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';

const API_URL_SWITCH = '--deadbord-api-url=';
const AUTH_SESSION_CHANNEL = 'auth:open-session';
const TDLP_BATCH_CHANNEL = 'tdlp:batch';

const apiUrl = process.argv.find((arg) => arg.startsWith(API_URL_SWITCH))?.slice(API_URL_SWITCH.length) ?? '';

const bridge: DesktopBridge = {
  apiUrl,
  openAuthSession: (url, redirect) => ipcRenderer.invoke(AUTH_SESSION_CHANNEL, url, redirect),
  tdlpBatch: (batch) => ipcRenderer.invoke(TDLP_BATCH_CHANNEL, batch),
};

contextBridge.exposeInMainWorld('deadbord', bridge);
