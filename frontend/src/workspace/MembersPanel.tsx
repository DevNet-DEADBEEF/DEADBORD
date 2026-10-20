import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { client } from '@/api/client';
import { PERMISSION_LABELS, PERMISSIONS, type Board, type Id, type Permission } from '@/api/types';
import { Button, Choice, TextField } from '@/components';
import { styles } from '@/styles';
import { useWorkspace } from './context';

/** Owner-only: invite members and set their permissions. */
export function MembersPanel({ boardId }: { boardId: Id }) {
  const { version, changed } = useWorkspace();
  const [board, setBoard] = useState<Board>();
  const [username, setUsername] = useState('');
  const [permission, setPermission] = useState<Permission>('read');
  const [error, setError] = useState<string>();

  useEffect(() => {
    client.getBoard(boardId).then((v) => setBoard(v.board), (e: Error) => setError(e.message));
  }, [boardId, version]);

  if (!board) return <Text style={styles.muted}>{error ?? 'Loading…'}</Text>;

  async function run(action: () => Promise<Board>): Promise<boolean> {
    try {
      setBoard(await action());
      setError(undefined);
      changed();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.heading}>Invite</Text>
      <TextField placeholder="Username" autoCapitalize="none" maxLength={32} value={username} onChangeText={setUsername} />
      <PermissionPicker value={permission} onChange={setPermission} />
      <Button
        label="Invite"
        disabled={!username.trim()}
        onPress={async () => {
          if (await run(() => client.inviteMember(boardId, username.trim(), permission))) setUsername('');
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.heading}>Members</Text>
      {board.members.length === 0 ? <Text style={styles.muted}>Only you so far.</Text> : null}
      {board.members.map((m) => (
        <View key={m.userId} style={[styles.card, { gap: 8 }]}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontWeight: '600' }}>{m.username}</Text>
            <Button label="Remove" tone="danger" size="small" onPress={() => run(() => client.removeMember(boardId, m.userId))} />
          </View>
          <PermissionPicker value={m.permission} onChange={(p) => run(() => client.setMemberPermission(boardId, m.userId, p))} />
        </View>
      ))}
    </View>
  );
}

function PermissionPicker({ value, onChange }: { value: Permission; onChange(p: Permission): void }) {
  return (
    <View style={[styles.row, { flexWrap: 'wrap' }]}>
      {PERMISSIONS.map((p) => (
        <Choice key={p} label={PERMISSION_LABELS[p]} selected={p === value} onPress={() => onChange(p)} />
      ))}
    </View>
  );
}
