import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { styles } from '@/styles';
import type { TimeOfDay } from '@/tasks';

export interface TimeFieldProps {
  value: TimeOfDay | undefined;
  /** Called with the picked time, or undefined when cleared (all-day). */
  onChange(time: TimeOfDay | undefined): void;
  placeholder?: string;
  disabled?: boolean;
  /** Take the remaining width when placed in a row. */
  grow?: boolean;
}

export function formatTime(time: TimeOfDay): string {
  return new Date(2000, 0, 1, time.hours, time.minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Native optional time field: tapping opens the platform time picker (a
 * dialog on Android, a wheel sheet on iOS). See TimeField.web.tsx for web.
 */
export function TimeField({ value, onChange, placeholder = 'Time (optional)', disabled, grow }: TimeFieldProps) {
  const [open, setOpen] = useState(false);

  function pick(_: DateTimePickerChangeEvent, date: Date) {
    setOpen(false);
    onChange({ hours: date.getHours(), minutes: date.getMinutes() });
  }

  const picker = (
    <DateTimePicker
      mode="time"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      value={value ? new Date(2000, 0, 1, value.hours, value.minutes) : new Date()}
      onValueChange={pick}
      onDismiss={() => setOpen(false)}
    />
  );

  return (
    <View style={[styles.row, grow && styles.grow, disabled && styles.disabled]}>
      <Pressable style={[styles.input, styles.grow]} disabled={disabled} onPress={() => setOpen(true)}>
        <Text style={value ? undefined : styles.muted}>{value ? formatTime(value) : placeholder}</Text>
      </Pressable>
      {value && !disabled ? (
        <Pressable onPress={() => onChange(undefined)} hitSlop={8} accessibilityLabel="Clear time">
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
