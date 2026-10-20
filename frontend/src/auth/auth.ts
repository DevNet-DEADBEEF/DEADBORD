/**
 * Client side of auth (backend/src/http/server.ts). Every login yields a
 * session key, sent to the server as `Authorization: Bearer <key>`.
 */

import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_URL, ApiError, request as api } from '@/api/request';
import type { User } from '@/api/types';

export interface AuthSession {
  /** Session key, 16 hex digits. */
  key: string;
  user: User;
}

export const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  chatgpt: 'ChatGPT',
  discord: 'Discord',
  roblox: 'Roblox',
};

/** Login methods the server has configured, besides username. */
export async function fetchProviders(): Promise<string[]> {
  return (await api<{ providers: string[] }>('/auth/providers')).providers;
}

/** A user the login matched, when it matched more than one. */
export interface Candidate {
  id: string;
  username: string;
}

export type LoginResult = { session: AuthSession } | { candidates: Candidate[] };

/**
 * Logs in with a non-OAuth method (see src/auth/methods). Methods that can
 * match several users return candidates; repeat with the chosen userId.
 */
export async function login(method: string, data: Record<string, unknown>, userId?: string): Promise<LoginResult> {
  const res = await api<AuthSession | { candidates: Candidate[] }>('/auth/login', {
    method: 'POST',
    body: { method, data, userId },
  });
  return 'candidates' in res ? { candidates: res.candidates } : { session: { key: res.key, user: res.user } };
}

/** Creates an account with a username, enrolled in one login method. */
export async function signup(username: string, method: string, data: Record<string, unknown>): Promise<AuthSession> {
  const { key, user } = await api<AuthSession>('/auth/signup', { method: 'POST', body: { username, method, data } });
  return { key, user };
}

/** Checks a stored key; rotates it first when the server asks. Undefined if it is no longer valid. */
export async function resume(key: string): Promise<AuthSession | undefined> {
  try {
    const me = await api<{ user: User; needsRotation: boolean }>('/auth/me', { key });
    if (!me.needsRotation) return { key, user: me.user };
    const rotated = await api<AuthSession>('/auth/rotate', { method: 'POST', key });
    return { key: rotated.key, user: rotated.user };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 409)) return undefined;
    throw err;
  }
}

export async function logout(key: string): Promise<void> {
  await api('/auth/logout', { method: 'POST', key }).catch(() => undefined);
}

/** Reads the key (or error) the server put in the redirect's fragment, and checks it. */
export async function completeLogin(url: string): Promise<AuthSession> {
  const params = new URLSearchParams(url.split('#')[1] ?? '');
  const error = params.get('error');
  const key = params.get('key');
  if (error || !key) throw new ApiError(error ?? 'Login failed');
  const session = await resume(key);
  if (!session) throw new ApiError('Login failed');
  return session;
}

/** Where the server sends the browser after a third-party login. */
function redirectUrl(): string {
  return Platform.OS === 'web' ? `${window.location.origin}/auth/callback` : Linking.createURL('auth');
}

function startUrl(provider: string): string {
  return `${API_URL}/auth/oauth/${provider}/start?redirect=${encodeURIComponent(redirectUrl())}`;
}

/**
 * Logs in with a third-party provider. Native apps use an in-app browser and
 * resolve with the session (undefined if the user cancels); web navigates
 * away and finishes on the /auth/callback route.
 */
export async function loginWithProvider(provider: string): Promise<AuthSession | undefined> {
  if (!(await fetchProviders()).includes(provider)) {
    throw new ApiError(`${PROVIDER_LABELS[provider] ?? provider} login isn't set up yet`);
  }
  if (Platform.OS === 'web') {
    window.location.assign(startUrl(provider));
    return new Promise(() => {}); // the page is unloading
  }
  const result = await WebBrowser.openAuthSessionAsync(startUrl(provider), redirectUrl());
  return result.type === 'success' ? completeLogin(result.url) : undefined;
}
