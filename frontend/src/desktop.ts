/** The Electron bridge (electron/preload.ts); undefined in browsers and native builds. */

import type { DesktopBridge } from '../electron/bridge';

declare global {
  interface Window {
    deadbord?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window === 'undefined' ? undefined : window.deadbord;
