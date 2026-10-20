import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components';
import { styles } from '@/styles';
import { useIsWide, useWorkspace } from './context';
import { AccountPanel } from './AccountPanel';
import { MembersPanel } from './MembersPanel';
import { TaskPanel } from './TaskPanel';

export const PANEL_WIDTH = 400;

/**
 * The open side panel (task details, members, account): a pane on the right of wide
 * windows, a modal sheet over the page on narrow ones.
 */
export function PanelHost() {
  const { panel, closePanel } = useWorkspace();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  if (!panel) return null;

  const title = { task: 'Task', members: 'Members', account: 'Account' }[panel.kind];
  const body =
    panel.kind === 'task' ? (
      <TaskPanel key={panel.taskId} taskId={panel.taskId} />
    ) : panel.kind === 'members' ? (
      <MembersPanel key={panel.boardId} boardId={panel.boardId} />
    ) : (
      <AccountPanel />
    );
  const header = (
    <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }, styles.divider]}>
      <Text style={styles.heading}>{title}</Text>
      <Button label="Close" size="small" onPress={closePanel} />
    </View>
  );

  if (wide) {
    return (
      <View style={{ width: PANEL_WIDTH, borderLeftWidth: 1, borderLeftColor: '#e5e5e5', backgroundColor: '#fff' }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16 }}>{body}</ScrollView>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closePanel}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
          onPress={closePanel}
          accessibilityLabel="Close"
        />
        <View
          style={{
            maxHeight: '90%',
            backgroundColor: '#fff',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            paddingBottom: insets.bottom,
          }}
        >
          {header}
          <ScrollView contentContainerStyle={{ padding: 16 }}>{body}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
