import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components';
import { completeLogin, setPendingChallenge } from '@/auth/auth';
import { useSession } from '@/session';
import { styles } from '@/styles';

/**
 * Web: the server redirects here after a third-party login (session key in
 * the fragment) or after linking a provider to the account (#linked=...).
 * A login that needs more factors goes back to the login screen for them.
 */
export default function AuthCallbackScreen() {
  const { signIn } = useSession();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const url = window.location.href;
    // Drop the key from the address bar and history.
    window.history.replaceState(null, '', window.location.pathname);
    if (new URLSearchParams(url.split('#')[1] ?? '').has('linked')) {
      router.replace('/boards');
      return;
    }
    completeLogin(url)
      .then(async (result) => {
        if ('challenge' in result) {
          setPendingChallenge(result);
          router.replace('/');
          return;
        }
        await signIn(result);
        router.replace('/boards');
      })
      .catch((e: Error) => setError(e.message));
  }, [signIn]);

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Button label="Back to log in" onPress={() => router.replace('/')} />
        </>
      ) : (
        <Text style={styles.muted}>Logging in…</Text>
      )}
    </View>
  );
}
