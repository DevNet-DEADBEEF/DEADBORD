import type { Task } from '@/api/types';
import { fromTimestamp, type Timestamp } from '@/epoch';

/**
 * Due dates are an instant. A task due on a day with no time is stored at
 * local midnight of that day and treated as all-day (so a task explicitly due
 * at 12:00 AM is indistinguishable from an all-day one).
 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A time of day, local. */
export interface TimeOfDay {
  hours: number;
  minutes: number;
}

/** The due instant for a picked day and optional time. */
export function dueAt(day: Date, time: TimeOfDay | undefined): Date {
  const d = startOfDay(day);
  if (time) d.setHours(time.hours, time.minutes);
  return d;
}

/** The time part of a due date, or undefined for an all-day due date. */
export function timeOf(date: Date): TimeOfDay | undefined {
  return date.getHours() || date.getMinutes() ? { hours: date.getHours(), minutes: date.getMinutes() } : undefined;
}

/** The first day whose local midnight is representable as a Timestamp. */
export function firstDueDay(): Date {
  const epoch = fromTimestamp(0);
  const day = startOfDay(epoch);
  return day < epoch ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) : day;
}

/** All-day tasks are overdue once their day has passed; timed tasks once their time has. */
export function isOverdue(task: Pick<Task, 'done' | 'dueDate'>, now = new Date()): boolean {
  if (task.done || task.dueDate == null) return false;
  const due = fromTimestamp(task.dueDate);
  return timeOf(due) ? due < now : due < startOfDay(now);
}

/** "10/21/2026" for all-day, "10/21/2026, 3:30 PM" with a time. */
export function formatDue(ts: Timestamp): string {
  const due = fromTimestamp(ts);
  const day = due.toLocaleDateString();
  return timeOf(due) ? `${day}, ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : day;
}

/** Overdue tasks first, then by due date; tasks with no due date last. */
export function sortTasks<T extends Pick<Task, 'dueDate'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity));
}

/** 0 = Sunday … 6 = Saturday: the locale's first day of the week, Sunday if unknown. */
export function firstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
      getWeekInfo?(): { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    // weekInfo counts Monday as 1 and Sunday as 7.
    return firstDay ? firstDay % 7 : 0;
  } catch {
    return 0;
  }
}

export type DueGroupKey = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'next30' | 'later' | 'none';

export const DUE_GROUP_LABELS: Record<DueGroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  nextWeek: 'Next week',
  next30: 'Next 30 days',
  later: 'Far future',
  none: 'No due date',
};

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * Which group a task's due date falls in. Weeks are calendar weeks starting
 * on the locale's first day; a day already in an earlier group (today,
 * tomorrow) stays there.
 */
export function dueGroup(task: Pick<Task, 'done' | 'dueDate'>, now = new Date(), weekStart = firstDayOfWeek()): DueGroupKey {
  if (task.dueDate == null) return 'none';
  if (isOverdue(task, now)) return 'overdue';
  const day = startOfDay(fromTimestamp(task.dueDate));
  const today = startOfDay(now);
  const nextWeekStart = addDays(today, 7 - ((today.getDay() - weekStart + 7) % 7));
  if (day <= today) return 'today';
  if (day < addDays(today, 2)) return 'tomorrow';
  if (day < nextWeekStart) return 'thisWeek';
  if (day < addDays(nextWeekStart, 7)) return 'nextWeek';
  if (day <= addDays(today, 30)) return 'next30';
  return 'later';
}

/** Tasks (already sorted) split into due-date groups, in order, leaving out empty groups. */
export function groupTasks<T extends Pick<Task, 'done' | 'dueDate'>>(tasks: T[], now = new Date()): { key: DueGroupKey; label: string; tasks: T[] }[] {
  const weekStart = firstDayOfWeek();
  const groups = new Map<DueGroupKey, T[]>((Object.keys(DUE_GROUP_LABELS) as DueGroupKey[]).map((k) => [k, []]));
  for (const task of tasks) groups.get(dueGroup(task, now, weekStart))!.push(task);
  return [...groups].filter(([, t]) => t.length).map(([key, t]) => ({ key, label: DUE_GROUP_LABELS[key], tasks: t }));
}
