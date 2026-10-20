/** Persists the session key in the device keychain/keystore. See storage.web.ts for web. */

import * as SecureStore from 'expo-secure-store';

const KEY = 'deadbord.sessionKey';

export function loadSessionKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export function saveSessionKey(key: string): Promise<void> {
  return SecureStore.setItemAsync(KEY, key);
}

export function clearSessionKey(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY);
}
