import { Redirect } from 'expo-router';

/**
 * Native: the OAuth redirect (deadbord://auth) is handled by the in-app
 * browser session in auth.ts, but Android can also deliver it to the router.
 * Nothing to do here; go back to the start.
 */
export default function AuthRedirectScreen() {
  return <Redirect href="/" />;
}
