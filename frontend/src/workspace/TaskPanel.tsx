import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { client } from '@/api/client';
import { can, COMMENT_MAX, TEXT_MAX, type Id, type TaskView } from '@/api/types';
import { Button, TextField } from '@/components';
import { DateField } from '@/DateField';
import { fromTimestamp, toTimestamp } from '@/epoch';
import { formatDateTime, styles } from '@/styles';
import { dueAt, formatDue, isOverdue, timeOf, type TimeOfDay } from '@/tasks';
import { TimeField } from '@/TimeField';
import { useWorkspace } from './context';

/** Task details, editing and comments, shown in the side panel. Render with key={taskId} so switching tasks resets it. */
export function TaskPanel({ taskId }: { taskId: Id }) {
  const { version, changed, closePanel } = useWorkspace();
  const [view, setView] = useState<TaskView>();
  const [error, setError] = useState<string>();
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState<Date>();
  const [time, setTime] = useState<TimeOfDay>();

  useEffect(() => {
    client.getTask(taskId).then(
      (v) => {
        setView(v);
        setError(undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [taskId, version]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!view) return <Text style={styles.muted}>Loading…</Text>;

  const { task, role, usernames } = view;
  const canWrite = can(role, 'read_write_comment');
  const overdue = isOverdue(task);

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      setError(undefined);
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEditing() {
    setTitle(task.title);
    setDesc(task.desc ?? '');
    const current = task.dueDate != null ? fromTimestamp(task.dueDate) : undefined;
    setDue(current);
    setTime(current && timeOf(current));
    setEditing(true);
  }

  const status = task.done ? 'Done' : overdue ? 'Overdue' : undefined;
  const dueText = task.dueDate != null ? `Due ${formatDue(task.dueDate)}` : 'No due date';

  return (
    <View style={{ gap: 12 }}>
      {editing ? (
        <>
          <TextField placeholder="Title" maxLength={TEXT_MAX} value={title} onChangeText={setTitle} />
          <TextField
            placeholder="Description"
            multiline
            maxLength={TEXT_MAX}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
            value={desc}
            onChangeText={setDesc}
          />
          <View style={styles.row}>
            <DateField
              value={due}
              onChange={(d) => {
                setDue(d);
                if (!d) setTime(undefined);
              }}
              grow
            />
            <TimeField value={time} onChange={setTime} disabled={!due} grow />
          </View>
          <View style={styles.row}>
            <Button
              label="Save"
              disabled={!title.trim()}
              onPress={() =>
                act(async () => {
                  await client.updateTask(taskId, { title: title.trim(), desc, dueDate: due ? toTimestamp(dueAt(due, time)) : null });
                  setEditing(false);
                })
              }
            />
            <Button label="Cancel" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>{task.title}</Text>
          <Text style={overdue ? styles.danger : styles.muted}>{status ? `${status} · ${dueText}` : dueText}</Text>
          {task.desc ? <Text>{task.desc}</Text> : null}
          {canWrite ? (
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Button label={task.done ? 'Mark not done' : 'Mark done'} onPress={() => act(() => client.updateTask(taskId, { done: !task.done }))} />
              <Button label="Edit" onPress={startEditing} />
              <Button
                label="Delete"
                tone="danger"
                onPress={() =>
                  act(async () => {
                    await client.removeTask(taskId);
                    closePanel();
                  })
                }
              />
            </View>
          ) : null}
        </>
      )}

      <Text style={styles.heading}>Comments</Text>
      {task.comments.length === 0 ? <Text style={styles.muted}>No comments.</Text> : null}
      {task.comments.map((c) => (
        <View key={c.id} style={styles.card}>
          <Text>{c.text}</Text>
          <Text style={styles.muted}>
            {usernames[c.createdBy] ?? 'deleted user'} · {formatDateTime(c.createdDate)}
          </Text>
        </View>
      ))}
      {can(role, 'read_comment') ? (
        <View style={styles.row}>
          <TextField style={styles.grow} placeholder="Add a comment" maxLength={COMMENT_MAX} value={comment} onChangeText={setComment} />
          <Button
            label="Comment"
            disabled={!comment.trim()}
            onPress={() =>
              act(async () => {
                await client.addComment(taskId, comment.trim());
                setComment('');
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}
