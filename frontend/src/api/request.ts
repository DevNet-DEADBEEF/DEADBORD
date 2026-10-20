/** HTTP requests to the backend, authenticated with the session key. */

import { Platform } from 'react-native';
import { desktop } from '@/desktop';

/**
 * The backend's base URL. The desktop app is told it by Electron. A
 * production web build is served by the backend itself (same origin); in
 * development the Expo dev server serves the app, so calls go to the backend
 * on its own port.
 */
export const API_URL = (
  desktop?.apiUrl ||
  (process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' && !__DEV__ ? '' : 'http://localhost:3000'))
).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init: { method?: string; key?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.key) headers.Authorization = `Bearer ${init.key}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Can't reach the server");
  }
  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // e.g. an HTML page because API_URL points at something other than the backend.
    throw new ApiError(`Unexpected response from ${API_URL || 'the server'} (${res.status})`, res.status);
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}
