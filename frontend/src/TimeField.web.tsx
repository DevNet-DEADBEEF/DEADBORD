import type { MouseEvent } from 'react';
import type { TimeOfDay } from '@/tasks';
import type { TimeFieldProps } from './TimeField';

const pad = (n: number) => String(n).padStart(2, '0');

function openPicker(e: MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker();
  } catch {
    // Not supported or not allowed; the field still accepts typing.
  }
}

/**
 * Web optional time field: the browser's native time input. Clicking pops up
 * its picker where supported; desktop users can type the time.
 */
export function TimeField({ value, onChange, disabled, grow }: TimeFieldProps) {
  return (
    <input
      type="time"
      step={60}
      disabled={disabled}
      value={value ? `${pad(value.hours)}:${pad(value.minutes)}` : ''}
      onChange={(e) => {
        const [h, m] = e.target.value.split(':').map(Number);
        onChange(e.target.value ? ({ hours: h, minutes: m } satisfies TimeOfDay) : undefined);
      }}
      onClick={openPicker}
      aria-label="Time (optional)"
      style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        padding: 10,
        fontSize: 14,
        fontFamily: 'inherit',
        flexGrow: grow ? 1 : 0,
        minWidth: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    />
  );
}
