import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components';
import { useSession } from '@/session';
import { styles } from '@/styles';
import { BoardTree } from '@/workspace/BoardTree';
import { useIsWide, WorkspaceProvider } from '@/workspace/context';
import { PanelHost } from '@/workspace/PanelHost';

/**
 * The logged-in workspace. Wide windows: board tree on the left, the page in
 * the middle, the open panel (task, members) on the right. Narrow windows:
 * the tree collapses at the top and panels open as modal sheets.
 */
export default function WorkspaceLayout() {
  const { user } = useSession();
  if (!user) return <Redirect href="/" />;
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

const TREE_WIDTH = 260;

function Shell() {
  const wide = useIsWide();
  const center = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }} />;

  if (wide) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <TopBar />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView
            style={{ width: TREE_WIDTH, flexGrow: 0, borderRightWidth: 1, borderRightColor: '#e5e5e5', backgroundColor: '#fafafa' }}
            contentContainerStyle={{ padding: 12 }}
          >
            <BoardTree />
          </ScrollView>
          <View style={{ flex: 1 }}>{center}</View>
          <PanelHost />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <TopBar />
      <CollapsibleTree />
      <View style={{ flex: 1 }}>{center}</View>
      <PanelHost />
    </View>
  );
}

function TopBar() {
  const { user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.row,
        styles.divider,
        { justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, paddingTop: insets.top + 10 },
      ]}
    >
      <Text style={styles.title}>DEADBORD</Text>
      <View style={styles.row}>
        <Text style={styles.muted} numberOfLines={1}>
          {user?.username}
        </Text>
        <Button label="Log out" size="small" onPress={() => signOut()} />
      </View>
    </View>
  );
}

/** Narrow windows: the board tree as a collapsible section above the page. */
function CollapsibleTree() {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.divider, { backgroundColor: '#fafafa' }]}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={[styles.row, { paddingHorizontal: 16, paddingVertical: 10 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.muted}>{open ? '▾' : '▸'}</Text>
        <Text style={{ fontWeight: '600' }}>Boards &amp; lists</Text>
      </Pressable>
      {open ? (
        <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <BoardTree onNavigate={() => setOpen(false)} />
        </ScrollView>
      ) : null}
    </View>
  );
}
