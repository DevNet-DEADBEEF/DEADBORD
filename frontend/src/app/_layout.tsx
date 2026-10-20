import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/session';
import { styles } from '@/styles';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Screens />
    </SessionProvider>
  );
}

function Screens() {
  // Hold every route until the stored session has been checked, so deep links survive a reload.
  const { loading } = useSession();
  if (loading) return <View style={styles.screen}><Text style={styles.muted}>Loading…</Text></View>;
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Log in', headerShown: false }} />
      <Stack.Screen name="auth/callback" options={{ title: 'Logging in' }} />
      <Stack.Screen name="auth/index" options={{ headerShown: false }} />
      <Stack.Screen name="(workspace)" options={{ headerShown: false }} />
    </Stack>
  );
}
