import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { login, loginWithProvider, signup, ssoProvider, type AuthSession, type Candidate, type CodeSent } from '@/auth/auth';
import { CodeEntry } from '@/auth/CodeEntry';
import { LOGIN_METHODS, type AuthMode, type LoginMethod } from '@/auth/methods';
import { Button, Choice, TextField } from '@/components';
import { useSession } from '@/session';
import { INK, styles } from '@/styles';

const USERNAME = /^[\x20-\x7E]{1,32}$/;

/**
 * Log in or sign up. Top to bottom: the selected method's inputs, the submit
 * button, then a grid of every login method (src/auth/methods).
 */
export default function LoginScreen() {
  const { user, signIn } = useSession();
  const [mode, setMode] = useState<AuthMode>('login');
  const [methodType, setMethodType] = useState('username');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [signupUsername, setSignupUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [candidates, setCandidates] = useState<Candidate[]>();
  /** Email logins: where the code went, and the code typed so far. */
  const [codeSentTo, setCodeSentTo] = useState<string>();
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState<string>();

  if (user) return <Redirect href="/boards" />;

  const methods = LOGIN_METHODS.filter((m) => mode === 'login' || m.signup !== false);
  const method = methods.find((m) => m.type === methodType) ?? methods[0];
  const value = values[method.type] ?? method.initial;
  // Signing up needs a username; the username method already asks for one, OAuth takes it from the provider.
  const askUsername = mode === 'signup' && method.kind === 'form' && method.type !== 'username';
  const valid =
    method.isValid(value, mode) && (!askUsername || USERNAME.test(signupUsername)) && (!codeSentTo || /^\d{6}$/.test(code));
  /** The method's data, plus the email code once one was sent. */
  const data = (extra: Record<string, unknown> = codeSentTo ? { code } : {}) => ({
    ...(method.toData?.(value) ?? (value as Record<string, unknown>)),
    ...extra,
  });

  function reset() {
    setError(undefined);
    setCandidates(undefined);
    setCodeSentTo(undefined);
    setCode('');
    setTicket(undefined);
  }

  function codeSent(sent: CodeSent): undefined {
    setCodeSentTo(sent.to);
    setCode('');
    return undefined;
  }

  function selectMethod(m: LoginMethod) {
    setMethodType(m.type);
    reset();
  }

  async function run(action: () => Promise<AuthSession | undefined>) {
    setBusy(true);
    setError(undefined);
    try {
      const session = await action();
      if (session) {
        await signIn(session);
        router.replace('/boards');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** `extra` replaces the email code: {} asks for a new one. */
  async function loginAs(userId?: string, extra?: Record<string, unknown>): Promise<AuthSession | undefined> {
    const result = await login(method.type, data(userId && ticket ? { ticket } : extra), userId);
    if ('codeSent' in result) return codeSent(result);
    if ('candidates' in result) {
      setCandidates(result.candidates);
      setTicket(result.ticket);
      return undefined;
    }
    return result.session;
  }

  async function signupWith(username: string, extra?: Record<string, unknown>): Promise<AuthSession | undefined> {
    const result = await signup(username, method.type, data(extra));
    return 'codeSent' in result ? codeSent(result) : result;
  }

  function submit() {
    if (method.kind === 'oauth') return run(() => loginWithProvider(method.type));
    if (method.kind === 'sso') {
      const { email } = value as { email: string };
      return run(async () => loginWithProvider(await ssoProvider(email), email));
    }
    if (mode === 'login') return run(() => loginAs());
    return run(() => signupWith(method.type === 'username' ? (value as { username: string }).username : signupUsername));
  }

  function resend() {
    return run(() => (mode === 'login' ? loginAs(undefined, {}) : signupWith(signupUsername, {})));
  }

  const submitLabel =
    method.kind === 'oauth'
      ? `Continue with ${method.label}`
      : codeSentTo
        ? 'Verify'
        : method.kind === 'sso'
          ? 'Continue'
          : mode === 'login'
            ? 'Log in'
            : 'Sign up';

  return (
    <ScrollView style={{ backgroundColor: '#fff' }} contentContainerStyle={[styles.screen, { maxWidth: 520, width: '100%', alignSelf: 'center' }]}>
      <Text style={styles.title}>DEADBORD</Text>

      <View style={styles.row}>
        {(['login', 'signup'] as const).map((m) => (
          <Choice
            key={m}
            label={m === 'login' ? 'Log in' : 'Sign up'}
            selected={mode === m}
            onPress={() => {
              setMode(m);
              reset();
            }}
            style={{ flex: 1 }}
          />
        ))}
      </View>

      {candidates ? (
        <CandidatePicker
          candidates={candidates}
          busy={busy}
          onPick={(id) => run(() => loginAs(id))}
          onCancel={() => setCandidates(undefined)}
        />
      ) : (
        <>
          <View style={styles.row}>
            <method.icon size={20} color={INK} />
            <Text style={styles.heading}>{method.label}</Text>
          </View>
          {askUsername ? (
            <TextField
              placeholder="Choose a username"
              autoCapitalize="none"
              autoComplete="username-new"
              maxLength={32}
              value={signupUsername}
              onChangeText={setSignupUsername}
            />
          ) : null}
          {method.Input ? (
            <method.Input
              value={value}
              onChange={(v: unknown) => {
                setValues({ ...values, [method.type]: v });
                // A code is for the address it was sent to.
                if (codeSentTo) reset();
              }}
              mode={mode}
            />
          ) : null}
          {codeSentTo ? (
            <CodeEntry to={codeSentTo} code={code} onChange={setCode} busy={busy} onResend={resend} />
          ) : null}
          {method.kind === 'oauth' ? (
            <Text style={styles.muted}>
              You&apos;ll continue on {method.label}&apos;s site.
              {mode === 'signup' ? ' Your username comes from your profile.' : ''}
            </Text>
          ) : null}
          {method.note ? <Text style={styles.muted}>{method.note}</Text> : null}

          <Button label={submitLabel} disabled={!valid || busy} onPress={submit} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}

      <Text style={[styles.muted, { marginTop: 8 }]}>{mode === 'login' ? 'Log in with' : 'Sign up with'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {methods.map((m) => (
          <Choice
            key={m.type}
            label={m.label}
            icon={m.icon}
            selected={m.type === method.type}
            onPress={() => selectMethod(m)}
            style={{ flexBasis: '30%', flexGrow: 1, maxWidth: '33%' }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/** Several users matched: ask which one, and have them confirm (per the Login Methods page). */
function CandidatePicker({
  candidates,
  busy,
  onPick,
  onCancel,
}: {
  candidates: Candidate[];
  busy: boolean;
  onPick(userId: string): void;
  onCancel(): void;
}) {
  const [chosen, setChosen] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Which one are you?</Text>
      <Text style={styles.muted}>More than one account matches what you entered.</Text>
      {candidates.map((c) => (
        <Choice key={c.id} label={c.username} selected={c.id === chosen} onPress={() => setChosen(c.id)} />
      ))}
      <Pressable style={styles.row} onPress={() => setConfirmed(!confirmed)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
        <Text style={{ fontSize: 18 }}>{confirmed ? '☑' : '☐'}</Text>
        <Text>The information I selected is correct</Text>
      </Pressable>
      <Button label="Continue" disabled={!chosen || !confirmed || busy} onPress={() => onPick(chosen!)} />
      <Button label="Cancel" onPress={onCancel} />
    </View>
  );
}
