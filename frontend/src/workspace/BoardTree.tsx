import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { client } from '@/api/client';
import type { BoardSummary, Id, List } from '@/api/types';
import { INK, styles } from '@/styles';
import { useWorkspace } from './context';

interface TreeBoard extends BoardSummary {
  lists: List[];
}

/** Boards and their lists. Picking a board opens it; picking a list opens its board and scrolls to it. */
export function BoardTree({ onNavigate }: { onNavigate?(): void }) {
  const { version, setFocusList } = useWorkspace();
  const pathname = usePathname();
  const { id: currentBoard } = useGlobalSearchParams<{ id?: string }>();
  const [boards, setBoards] = useState<TreeBoard[]>([]);
  const [error, setError] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<Id>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const summaries = await client.listBoards();
        const withLists = await Promise.all(
          summaries.map(async (s) => ({ ...s, lists: await client.getLists(s.board.id) })),
        );
        if (!cancelled) {
          setBoards(withLists);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  function go(boardId: Id, listId?: Id) {
    setFocusList(listId);
    router.push({ pathname: '/board/[id]', params: { id: boardId } });
    onNavigate?.();
  }

  function toggle(boardId: Id) {
    const next = new Set(collapsed);
    if (next.has(boardId)) next.delete(boardId);
    else next.add(boardId);
    setCollapsed(next);
  }

  const onBoards = pathname === '/boards';
  return (
    <View style={{ gap: 2 }}>
      <TreeItem
        label="All boards"
        selected={onBoards}
        onPress={() => {
          router.push('/boards');
          onNavigate?.();
        }}
      />
      {error ? <Text style={[styles.error, { padding: 8 }]}>{error}</Text> : null}
      {boards.map(({ board, lists }) => {
        const open = !collapsed.has(board.id);
        return (
          <View key={board.id}>
            <TreeItem
              label={board.title}
              selected={board.id === currentBoard}
              bold
              twisty={lists.length ? (open ? '▾' : '▸') : ' '}
              onTwisty={() => toggle(board.id)}
              onPress={() => go(board.id)}
            />
            {open
              ? lists.map((l) => <TreeItem key={l.id} label={l.title} indent onPress={() => go(board.id, l.id)} />)
              : null}
          </View>
        );
      })}
    </View>
  );
}

function TreeItem({
  label,
  selected,
  bold,
  indent,
  twisty,
  onTwisty,
  onPress,
}: {
  label: string;
  selected?: boolean;
  bold?: boolean;
  indent?: boolean;
  twisty?: string;
  onTwisty?(): void;
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <View style={[styles.row, { gap: 0 }]}>
      {indent ? <View style={{ width: 28 }} /> : null}
      {twisty !== undefined ? (
        <Pressable onPress={onTwisty} hitSlop={6} style={{ width: 24, alignItems: 'center' }} accessibilityLabel="Expand or collapse">
          <Text style={styles.muted}>{twisty}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="link"
        style={{
          flex: 1,
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderRadius: 6,
          backgroundColor: selected ? INK : hovered ? '#eee' : 'transparent',
        }}
      >
        <Text numberOfLines={1} style={{ color: selected ? '#fff' : INK, fontWeight: bold || selected ? '600' : '400' }}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
