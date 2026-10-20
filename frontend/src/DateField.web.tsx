import type { MouseEvent } from 'react';
import { firstDueDay } from '@/tasks';
import type { DateFieldProps } from './DateField';

/** "YYYY-MM-DD" in local time, as <input type="date"> expects. */
function toInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Typed dates outside the allowed range are treated as cleared. */
function fromInputValue(value: string, min: Date, max: Date | undefined): Date | undefined {
  const [y, m, d] = value.split('-').map(Number);
  const date = value ? new Date(y, m - 1, d) : undefined;
  return date && date >= min && (!max || date <= max) ? date : undefined;
}

function openPicker(e: MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker();
  } catch {
    // Not supported or not allowed; the field still accepts typing.
  }
}

/**
 * Web date field: the browser's native date input. Clicking pops up its
 * calendar; desktop users can also type the date straight into the field.
 */
export function DateField({ value, onChange, minimumDate, maximumDate, grow }: DateFieldProps) {
  const min = minimumDate ?? firstDueDay();
  return (
    <input
      type="date"
      value={value ? toInputValue(value) : ''}
      min={toInputValue(min)}
      max={maximumDate ? toInputValue(maximumDate) : undefined}
      onChange={(e) => onChange(fromInputValue(e.target.value, min, maximumDate))}
      onClick={openPicker}
      style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        padding: 10,
        fontSize: 14,
        fontFamily: 'inherit',
        flexGrow: grow ? 1 : 0,
        minWidth: 0,
      }}
    />
  );
}
