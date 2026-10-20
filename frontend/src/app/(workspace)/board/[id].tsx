import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { client } from '@/api/client';
import { can, PERMISSION_LABELS, TEXT_MAX, TITLE_MAX, type BoardView, type Id, type List, type TaskSummary } from '@/api/types';
import { Button, TextField } from '@/components';
import { DateField } from '@/DateField';
import { toTimestamp } from '@/epoch';
import { INK, styles } from '@/styles';
import { dueAt, formatDue, isOverdue, type TimeOfDay } from '@/tasks';
import { TimeField } from '@/TimeField';
import { useWorkspace } from '@/workspace/context';

/** One board: its lists and their tasks. Tasks and members open in the side panel. */
export default function BoardPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { version, changed, openMembers, panel, focusList, setFocusList } = useWorkspace();
  const [view, setView] = useState<BoardView>();
  const [error, setError] = useState<string>();
  const [listTitle, setListTitle] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const listY = useRef(new Map<Id, number>());

  useEffect(() => {
    client.getBoard(id).then(
      (v) => {
        setView(v);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [id, version]);

  // Scroll to a list picked in the tree, once it has been laid out.
  useEffect(() => {
    const y = focusList ? listY.current.get(focusList) : undefined;
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, [focusList, view]);

  if (error) return <View style={styles.page}><Text style={styles.error}>{error}</Text></View>;
  if (!view) return <View style={styles.page}><Text style={styles.muted}>Loading…</Text></View>;

  const { board, role, lists } = view;
  const canWrite = can(role, 'read_write_comment');
  const membersOpen = panel?.kind === 'members' && panel.boardId === id;

  async function createList() {
    try {
      await client.createList(id, listTitle.trim());
      setListTitle('');
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <ScrollView ref={scroll} contentContainerStyle={styles.page} onScrollBeginDrag={() => setFocusList(undefined)}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.title}>{board.title}</Text>
          <Text style={styles.muted}>{role === 'owner' ? 'Owner' : `Your access: ${PERMISSION_LABELS[role]}`}</Text>
        </View>
        {role === 'owner' ? (
          <Button label={`Members (${board.members.length})`} size="small" selected={membersOpen} onPress={() => openMembers(id)} />
        ) : null}
      </View>

      {lists.length === 0 ? <Text style={styles.muted}>No lists yet.</Text> : null}
      {lists.map((list) => (
        <View key={list.id} onLayout={(e) => listY.current.set(list.id, e.nativeEvent.layout.y)}>
          <ListCard list={list} canWrite={canWrite} focused={list.id === focusList} />
        </View>
      ))}

      {canWrite ? (
        <View style={styles.row}>
          <TextField style={styles.grow} placeholder="New list title" maxLength={TITLE_MAX} value={listTitle} onChangeText={setListTitle} />
          <Button label="Add list" disabled={!listTitle.trim()} onPress={createList} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ListCard({ list, canWrite, focused }: { list: List & { tasks: TaskSummary[] }; canWrite: boolean; focused: boolean }) {
  const { changed, openTask, panel } = useWorkspace();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<Date>();
  const [time, setTime] = useState<TimeOfDay>();
  const [showCompleted, setShowCompleted] = useState(false);
  const open = list.tasks.filter((t) => !t.done);
  const completed = list.tasks.filter((t) => t.done);

  async function createTask() {
    await client.createTask(list.id, { title: title.trim(), dueDate: due ? toTimestamp(dueAt(due, time)) : null });
    setTitle('');
    setDue(undefined);
    setTime(undefined);
    changed();
  }

  const row = (task: TaskSummary) => (
    <TaskRow
      key={task.id}
      task={task}
      canWrite={canWrite}
      open={panel?.kind === 'task' && panel.taskId === task.id}
      onToggle={() => toggleDone(task)}
      onOpen={() => openTask(task.id)}
    />
  );

  async function toggleDone(task: TaskSummary) {
    await client.updateTask(task.id, { done: !task.done });
    changed();
  }

  return (
    <View style={[styles.card, { gap: 4 }, focused && { borderColor: INK }]}>
      <Text style={[styles.heading, { marginBottom: 4 }]}>{list.title}</Text>
      {open.length === 0 ? <Text style={styles.muted}>{completed.length ? 'All done!' : 'No tasks.'}</Text> : null}
      {open.map(row)}
      {canWrite ? (
        <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
          <TextField style={styles.grow} placeholder="New task" maxLength={TEXT_MAX} value={title} onChangeText={setTitle} />
          <DateField
            value={due}
            onChange={(d) => {
              setDue(d);
              if (!d) setTime(undefined);
            }}
            grow
          />
          <TimeField value={time} onChange={setTime} disabled={!due} grow />
          <Button label="Add" disabled={!title.trim()} onPress={createTask} />
        </View>
      ) : null}
      {completed.length ? (
        <>
          <Pressable
            onPress={() => setShowCompleted(!showCompleted)}
            style={[styles.row, { marginTop: 8, paddingVertical: 4 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded: showCompleted }}
          >
            <Text style={styles.muted}>{showCompleted ? '▾' : '▸'}</Text>
            <Text style={[styles.muted, { fontWeight: '600' }]}>Completed ({completed.length})</Text>
          </Pressable>
          {showCompleted ? completed.map(row) : null}
        </>
      ) : null}
    </View>
  );
}

function TaskRow({
  task,
  canWrite,
  open,
  onToggle,
  onOpen,
}: {
  task: TaskSummary;
  canWrite: boolean;
  open: boolean;
  onToggle(): void;
  onOpen(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const overdue = isOverdue(task);
  return (
    <View style={[styles.row, { borderRadius: 6, paddingHorizontal: 4, backgroundColor: open ? '#eee' : hovered ? '#f5f5f5' : 'transparent' }]}>
      <Pressable disabled={!canWrite} onPress={onToggle} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: task.done }}>
        <Text style={{ fontSize: 18 }}>{task.done ? '☑' : '☐'}</Text>
      </Pressable>
      <Pressable
        onPress={onOpen}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.row, { flex: 1, paddingVertical: 6, justifyContent: 'space-between' }]}
      >
        <Text style={[{ flexShrink: 1 }, task.done && [styles.muted, { textDecorationLine: 'line-through' }]]}>{task.title}</Text>
        {task.dueDate != null ? (
          <Text style={overdue ? styles.danger : styles.muted}>
            {overdue ? 'Overdue · ' : ''}
            {formatDue(task.dueDate)}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
