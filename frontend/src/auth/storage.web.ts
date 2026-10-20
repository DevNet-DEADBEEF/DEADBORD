/** Web: localStorage, which can be unavailable (private mode, blocked storage); then sessions last one page load. */

const KEY = 'deadbord.sessionKey';

export async function loadSessionKey(): Promise<string | null> {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveSessionKey(key: string): Promise<void> {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    // Not persisted; the user logs in again next visit.
  }
}

export async function clearSessionKey(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
