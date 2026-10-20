import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { firstDueDay, startOfDay } from '@/tasks';
import { styles } from '@/styles';

export interface DateFieldProps {
  value: Date | undefined;
  /** Called with local midnight of the picked day, or undefined when cleared. */
  onChange(date: Date | undefined): void;
  placeholder?: string;
  /** Defaults to the first day representable as a Timestamp (due dates). */
  minimumDate?: Date;
  maximumDate?: Date;
  /** Take the remaining width when placed in a row. */
  grow?: boolean;
}

/**
 * Native date field: tapping opens the platform picker (a dialog on Android,
 * an inline calendar sheet on iOS). See DateField.web.tsx for web.
 */
export function DateField({ value, onChange, placeholder = 'Due date', minimumDate, maximumDate, grow }: DateFieldProps) {
  const [open, setOpen] = useState(false);

  function pick(_: DateTimePickerChangeEvent, date: Date) {
    setOpen(false);
    onChange(startOfDay(date));
  }

  const picker = (
    <DateTimePicker
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      value={value ?? new Date()}
      minimumDate={minimumDate ?? firstDueDay()}
      maximumDate={maximumDate}
      onValueChange={pick}
      onDismiss={() => setOpen(false)}
    />
  );

  return (
    <View style={[styles.row, grow && styles.grow]}>
      <Pressable style={[styles.input, styles.grow]} onPress={() => setOpen(true)}>
        <Text style={value ? undefined : styles.muted}>{value ? value.toLocaleDateString() : placeholder}</Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange(undefined)} hitSlop={8} accessibilityLabel="Clear date">
          <Text style={styles.muted}>✕</Text>
        </Pressable>
      ) : null}

      {open && Platform.OS === 'android' ? picker : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={[styles.screen, { flex: 0 }]}>{picker}</View>
        </Modal>
      ) : null}
    </View>
  );
}
