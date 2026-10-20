/**
 * Login method templates. Each method from the Login Methods page lives in
 * its own file in this folder and is registered in index.ts. A method
 * declares its inputs and how to validate them; the login screen renders
 * whichever one is selected.
 *
 * To add a method: copy a similar file, set `type` to its backend AuthType
 * (backend/src/db/models.ts AUTH_TYPES), and register it in index.ts.
 */

import type { ComponentType } from 'react';

export type AuthMode = 'login' | 'signup';

export interface MethodInputProps<V> {
  value: V;
  onChange(value: V): void;
  mode: AuthMode;
}

export interface LoginMethod<V = any> {
  /** Backend AuthType. */
  type: string;
  label: string;
  /** 'oauth' methods have no inputs; they continue on the provider's site. */
  kind: 'form' | 'oauth';
  /** Empty value when the method is selected. */
  initial: V;
  /** The method's inputs; omitted when it needs none. */
  Input?: ComponentType<MethodInputProps<V>>;
  /** Whether the inputs are complete enough to submit. */
  isValid(value: V, mode: AuthMode): boolean;
  /** Converts the value to the JSON sent to the server; defaults to the value itself. */
  toData?(value: V): Record<string, unknown>;
  /** Shown under the inputs. */
  note?: string;
  /** False if the method can't be used to sign up (e.g. "I'm feeling lucky"). */
  signup?: boolean;
}

export function defineMethod<V>(method: LoginMethod<V>): LoginMethod<V> {
  return method;
}

/** Third-party providers: no inputs, the server runs the OAuth2 flow. */
export function oauthMethod(type: string, label: string): LoginMethod<Record<string, never>> {
  return { type, label, kind: 'oauth', initial: {}, isValid: () => true };
}
