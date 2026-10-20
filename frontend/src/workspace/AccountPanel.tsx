import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  deleteAccount,
  enroll,
  getAccount,
  linkProvider,
  renameAccount,
  ssoProvider,
  unenroll,
  type CodeSent,
  type AccountInfo,
  type EnrolledMethod,
} from '@/auth/auth';
import { CodeEntry } from '@/auth/CodeEntry';
import { LOGIN_METHODS, type LoginMethod } from '@/auth/methods';
import { Button, Choice, TextField } from '@/components';
import { fromTimestamp } from '@/epoch';
import { useSession } from '@/session';
import { INK, styles } from '@/styles';

const USERNAME = /^[\x20-\x7E]{1,32}$/;

const FACTOR: Record<EnrolledMethod['mfa'], string> = {
  knows: 'Something you know',
  is: 'Something you are',
  has: 'Something you have',
};

/** Methods that can't be added from here: lucky picks a random user, and everyone already has a username. */
const NOT_ADDABLE = new Set(['lucky', 'username']);

const methodOf = (type: string) => LOGIN_METHODS.find((m) => m.type === type);

/** The logged-in user's account: username, login methods, and deleting the account. */
export function AccountPanel() {
  const { sessionKey, updateUser, signOut } = useSession();
  const key = sessionKey!;
  const [account, setAccount] = useState<AccountInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getAccount(key).then(setAccount, (e: Error) => setError(e.message));
  }, [key]);

  if (!account) return <Text style={error ? styles.error : styles.muted}>{error ?? 'Loading…'}</Text>;

  /** Runs an account change; returns whether it worked. */
  async function run(action: () => Promise<AccountInfo>): Promise<boolean> {
    try {
      const next = await action();
      setAccount(next);
      updateUser(next.user);
      setError(undefined);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  return (
    <View style={{ gap: 20 }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <UsernameSection current={account.user.username} onSave={(name) => run(() => renameAccount(key, name))} />
      <MethodsSection
        enrolled={account.credentials}
        onRemove={(type) => run(() => unenroll(key, type))}
        onAdd={async (method, data) => {
          let sent: CodeSent | undefined;
          const added = await run(async () => {
            const result = await enroll(key, method.type, data);
            if (!('codeSent' in result)) return result;
            sent = result;
            return account;
          });
          return sent ?? added;
        }}
        onLink={async (method, value) => {
          try {
            // SSO links whichever provider signs in the email's domain.
            const provider = method.kind === 'sso' ? await ssoProvider((value as { email: string }).email) : method.type;
            await linkProvider(key, provider);
            await run(() => getAccount(key));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <DeleteSection
        username={account.user.username}
        onDelete={async (confirm) => {
          try {
            await deleteAccount(key, confirm);
            await signOut();
            router.replace('/');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </View>
  );
}

function UsernameSection({ current, onSave }: { current: string; onSave(name: string): Promise<boolean> }) {
  const [name, setName] = useState(current);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Username</Text>
      <View style={styles.row}>
        <TextField style={styles.grow} autoCapitalize="none" maxLength={32} value={name} onChangeText={setName} />
        <Button label="Save" disabled={name === current || !USERNAME.test(name)} onPress={() => onSave(name)} />
      </View>
    </View>
  );
}

function MethodsSection({
  enrolled,
  onRemove,
  onAdd,
  onLink,
}: {
  enrolled: EnrolledMethod[];
  onRemove(type: string): void;
  /** Resolves whether it was added, or that an email code was sent first. */
  onAdd(method: LoginMethod, data: Record<string, unknown>): Promise<boolean | CodeSent>;
  onLink(method: LoginMethod, value: unknown): void;
}) {
  const [adding, setAdding] = useState<string>();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [codeSentTo, setCodeSentTo] = useState<string>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const addable = LOGIN_METHODS.filter((m) => !NOT_ADDABLE.has(m.type) && !enrolled.some((e) => e.type === m.type));
  const method = addable.find((m) => m.type === adding);
  const value = method ? (values[method.type] ?? method.initial) : undefined;

  /** `extra` is the email code, or {} to ask for one. */
  async function add(extra: Record<string, unknown>) {
    if (!method) return;
    setBusy(true);
    const result = await onAdd(method, { ...(method.toData?.(value) ?? (value as Record<string, unknown>)), ...extra });
    setBusy(false);
    if (typeof result === 'object') {
      setCodeSentTo(result.to);
      setCode('');
    } else if (result) {
      setAdding(undefined);
      setCodeSentTo(undefined);
      setValues({ ...values, [method.type]: method.initial });
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.heading}>Login methods</Text>
      {enrolled.map((e) => {
        const m = methodOf(e.type);
        return (
          <View key={e.type} style={[styles.card, styles.row, { justifyContent: 'space-between' }]}>
            <View style={[styles.row, { flexShrink: 1, gap: 10 }]}>
              {m ? <m.icon size={20} color={INK} /> : null}
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontWeight: '600' }}>{m?.label ?? e.type}</Text>
                <Text style={styles.muted}>
                  {FACTOR[e.mfa]} · added {fromTimestamp(e.createdDate).toLocaleDateString()}
                </Text>
              </View>
            </View>
            <Button label="Remove" tone="danger" size="small" disabled={enrolled.length === 1} onPress={() => onRemove(e.type)} />
          </View>
        );
      })}

      <Text style={[styles.muted, { marginTop: 8 }]}>Add a login method</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {addable.map((m) => (
          <Choice
            key={m.type}
            label={m.label}
            icon={m.icon}
            selected={m.type === adding}
            onPress={() => {
              setAdding(m.type === adding ? undefined : m.type);
              setCodeSentTo(undefined);
            }}
          />
        ))}
      </View>

      {method ? (
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={{ fontWeight: '600' }}>{method.label}</Text>
          {method.Input ? (
            <method.Input
              value={value}
              onChange={(v: unknown) => {
                setValues({ ...values, [method.type]: v });
                setCodeSentTo(undefined);
              }}
              mode="signup"
            />
          ) : null}
          {codeSentTo ? <CodeEntry to={codeSentTo} code={code} onChange={setCode} busy={busy} onResend={() => add({})} /> : null}
          {method.kind !== 'form' ? <Text style={styles.muted}>You&apos;ll continue on the provider&apos;s site to link it.</Text> : null}
          {method.note ? <Text style={styles.muted}>{method.note}</Text> : null}
          <Button
            label={method.kind !== 'form' ? `Link ${method.label}` : codeSentTo ? 'Verify' : `Add ${method.label}`}
            disabled={busy || !method.isValid(value, 'signup') || (!!codeSentTo && !/^\d{6}$/.test(code))}
            onPress={() => (method.kind !== 'form' ? onLink(method, value) : add(codeSentTo ? { code } : {}))}
          />
        </View>
      ) : null}
    </View>
  );
}

function DeleteSection({ username, onDelete }: { username: string; onDelete(confirm: string): void }) {
  const [confirm, setConfirm] = useState('');
  return (
    <View style={[styles.card, { gap: 8, borderColor: '#e8b4ad' }]}>
      <Text style={[styles.heading, styles.danger]}>Delete account</Text>
      <Text style={styles.muted}>
        Deletes your account and every board you own, including their lists and tasks, for everyone they are shared with. You
        will be removed from boards shared with you. This can&apos;t be undone.
      </Text>
      <TextField placeholder={`Type ${username} to confirm`} autoCapitalize="none" maxLength={32} value={confirm} onChangeText={setConfirm} />
      <Button label="Delete my account" tone="danger" disabled={confirm !== username} onPress={() => onDelete(confirm)} />
    </View>
  );
}
