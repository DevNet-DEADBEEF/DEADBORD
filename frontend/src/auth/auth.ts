/**
 * Client side of auth (backend/src/http/server.ts). Every login yields a
 * session key, sent to the server as `Authorization: Bearer <key>`.
 */

import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_URL, ApiError, request as api } from '@/api/request';
import type { User } from '@/api/types';
import { desktop } from '@/desktop';

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

/**
 * Browsers leave the app for third-party logins and come back to
 * /auth/callback. The desktop and native apps show a login window instead.
 */
const navigatesAway = Platform.OS === 'web' && !desktop;

/** Where the server sends the browser after a third-party login. */
function redirectUrl(): string {
  if (navigatesAway) return `${window.location.origin}/auth/callback`;
  return desktop ? 'deadbord://auth' : Linking.createURL('auth');
}

/** Shows `url` in a login window; resolves with the URL it finished at, or undefined if cancelled. */
async function authSession(url: string): Promise<string | undefined> {
  if (desktop) return desktop.openAuthSession(url, redirectUrl());
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl());
  return result.type === 'success' ? result.url : undefined;
}

function startUrl(provider: string): string {
  return `${API_URL}/auth/oauth/${provider}/start?redirect=${encodeURIComponent(redirectUrl())}`;
}

/**
 * Logs in with a third-party provider. The desktop and native apps use a
 * login window and resolve with the session (undefined if the user cancels);
 * web navigates away and finishes on the /auth/callback route.
 */
export async function loginWithProvider(provider: string): Promise<AuthSession | undefined> {
  if (!(await fetchProviders()).includes(provider)) {
    throw new ApiError(`${PROVIDER_LABELS[provider] ?? provider} login isn't set up yet`);
  }
  if (navigatesAway) {
    window.location.assign(startUrl(provider));
    return new Promise(() => {}); // the page is unloading
  }
  const finished = await authSession(startUrl(provider));
  return finished ? completeLogin(finished) : undefined;
}

// --- Account -----------------------------------------------------------------

export interface EnrolledMethod {
  type: string;
  mfa: 'is' | 'knows' | 'has';
  createdDate: number;
}

export interface AccountInfo {
  user: User;
  credentials: EnrolledMethod[];
}

export function getAccount(key: string): Promise<AccountInfo> {
  return api<AccountInfo>('/auth/account', { key });
}

export function renameAccount(key: string, username: string): Promise<AccountInfo> {
  return api<AccountInfo>('/auth/account', { method: 'PATCH', key, body: { username } });
}

/** Enrolls (or re-enrolls) a form-based login method. */
export function enroll(key: string, method: string, data: Record<string, unknown>): Promise<AccountInfo> {
  return api<AccountInfo>('/auth/account/credentials', { method: 'POST', key, body: { method, data } });
}

export function unenroll(key: string, method: string): Promise<AccountInfo> {
  return api<AccountInfo>(`/auth/account/credentials/${method}`, { method: 'DELETE', key });
}

/** Deletes the account; `confirm` must be the username. */
export function deleteAccount(key: string, confirm: string): Promise<void> {
  return api<void>('/auth/account', { method: 'DELETE', key, body: { confirm } });
}

/**
 * Links a third-party account to the logged-in user. Desktop and native
 * resolve true once linked (false if cancelled); web navigates away and
 * returns to /auth/callback.
 */
export async function linkProvider(key: string, provider: string): Promise<boolean> {
  const { url } = await api<{ url: string }>(`/auth/oauth/${provider}/link`, {
    method: 'POST',
    key,
    body: { redirect: redirectUrl() },
  });
  if (navigatesAway) {
    window.location.assign(url);
    return new Promise(() => {}); // the page is unloading
  }
  const finished = await authSession(url);
  if (!finished) return false;
  const error = new URLSearchParams(finished.split('#')[1] ?? '').get('error');
  if (error) throw new ApiError(error);
  return true;
}
