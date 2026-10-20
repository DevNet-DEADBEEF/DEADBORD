import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { client } from '@/api/client';
import type { User } from '@/api/types';
import { logout as logoutRequest, resume, type AuthSession } from '@/auth/auth';
import { clearSessionKey, loadSessionKey, saveSessionKey } from '@/auth/storage';

interface Session {
  /** True until the stored session key has been checked. */
  loading: boolean;
  user: User | undefined;
  /** Session key, 16 hex digits. */
  sessionKey: string | undefined;
  signIn(session: AuthSession): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession>();

  const apply = useCallback((next: AuthSession | undefined) => {
    client.setSessionKey(next?.key);
    setSession(next);
  }, []);

  // Resume a stored session on launch.
  useEffect(() => {
    (async () => {
      try {
        const key = await loadSessionKey();
        const resumed = key ? await resume(key) : undefined;
        if (resumed) {
          if (resumed.key !== key) await saveSessionKey(resumed.key);
          apply(resumed);
        } else if (key) {
          await clearSessionKey();
        }
      } catch {
        // Server unreachable; show the login screen.
      } finally {
        setLoading(false);
      }
    })();
  }, [apply]);

  const signIn = useCallback(
    async (next: AuthSession) => {
      await saveSessionKey(next.key);
      apply(next);
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    if (session) await logoutRequest(session.key);
    await clearSessionKey();
    apply(undefined);
  }, [apply, session]);

  return (
    <SessionContext.Provider value={{ loading, user: session?.user, sessionKey: session?.key, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
