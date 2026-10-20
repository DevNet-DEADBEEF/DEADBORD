import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, SubmitScope, TextField } from '@/components';
import { desktop } from '@/desktop';
import { styles } from '@/styles';

/** Whether a DEADBORD backend answers at `apiUrl`. */
async function reachable(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/auth/providers`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Desktop app: which server to connect to (electron/config.ts). Saving
 * restarts the app. Renders nothing in browsers, which use the server that
 * served them.
 */
export function ServerSettings() {
  const [editing, setEditing] = useState(false);
  const [apiUrl, setApiUrl] = useState(desktop?.server.saved.apiUrl ?? '');
  const [tdlpHost, setTdlpHost] = useState(desktop?.server.saved.tdlpHost ?? '');
  const [tdlpPort, setTdlpPort] = useState(desktop?.server.saved.tdlpPort?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** The address didn't answer; a second press saves it anyway. */
  const [unreachable, setUnreachable] = useState(false);

  if (!desktop) return null;
  const { server } = desktop;

  if (!editing) {
    return (
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Text style={styles.muted}>Server: {server.apiUrl}</Text>
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button">
          <Text style={[styles.muted, { textDecorationLine: 'underline' }]}>Change</Text>
        </Pressable>
      </View>
    );
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      if (!unreachable && !(await reachable(apiUrl))) {
        setUnreachable(true);
        setError(`No DEADBORD server answered at ${apiUrl}.`);
        return;
      }
      // Restarts the app on success.
      await desktop!.setServer({ apiUrl, tdlpHost: tdlpHost || undefined, tdlpPort: tdlpPort ? Number(tdlpPort) : undefined });
    } catch (e) {
      // Electron prefixes errors from the main process.
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  }

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setUnreachable(false);
  };

  return (
    <SubmitScope onSubmit={() => apiUrl.trim() && !busy && save()}>
      <View style={[styles.card, { gap: 8 }]}>
        <Text style={{ fontWeight: '600' }}>Server</Text>
        {server.overriddenBy ? (
          <Text style={styles.muted}>Set by {server.overriddenBy}, which overrides what you save here.</Text>
        ) : null}
        <TextField
          placeholder="http://192.168.1.10:3000"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={200}
          value={apiUrl}
          onChangeText={edit(setApiUrl)}
        />
        <View style={styles.row}>
          <TextField
            placeholder="TDLP host (same as server)"
            style={styles.grow}
            autoCapitalize="none"
            maxLength={253}
            value={tdlpHost}
            onChangeText={edit(setTdlpHost)}
          />
          <TextField
            placeholder="Port (3001)"
            style={{ width: 110 }}
            keyboardType="number-pad"
            maxLength={5}
            value={tdlpPort}
            onChangeText={edit((v) => setTdlpPort(v.replace(/\D/g, '')))}
          />
        </View>
        <Text style={styles.muted}>Saving restarts the app.</Text>
        <View style={styles.row}>
          <Button label={unreachable ? 'Save anyway' : 'Save'} disabled={!apiUrl.trim() || busy} onPress={save} />
          <Button
            label="Cancel"
            onPress={() => {
              setEditing(false);
              setError(undefined);
              setUnreachable(false);
            }}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SubmitScope>
  );
}
