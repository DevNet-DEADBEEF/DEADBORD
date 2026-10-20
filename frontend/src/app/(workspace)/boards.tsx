import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { client } from '@/api/client';
import { PERMISSION_LABELS, TITLE_MAX, type BoardSummary } from '@/api/types';
import { Button, TextField } from '@/components';
import { styles } from '@/styles';
import { useWorkspace } from '@/workspace/context';

/** Every board you own or that is shared with you. */
export default function BoardsPage() {
  const { version, changed } = useWorkspace();
  const [boards, setBoards] = useState<BoardSummary[]>();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    client.listBoards().then(
      (b) => {
        setBoards(b);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [version]);

  async function create() {
    try {
      const board = await client.createBoard(title.trim());
      setTitle('');
      changed();
      router.push({ pathname: '/board/[id]', params: { id: board.id } });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Boards</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <TextField style={styles.grow} placeholder="New board title" maxLength={TITLE_MAX} value={title} onChangeText={setTitle} />
        <Button label="Create" disabled={!title.trim()} onPress={create} />
      </View>
      {boards?.length === 0 ? <Text style={styles.muted}>No boards yet.</Text> : null}
      {boards?.map(({ board, role }) => (
        <Pressable
          key={board.id}
          style={styles.card}
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/board/[id]', params: { id: board.id } })}
        >
          <Text style={{ fontWeight: '600' }}>{board.title}</Text>
          <Text style={styles.muted}>{role === 'owner' ? 'Owner' : `Shared with you · ${PERMISSION_LABELS[role]}`}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
