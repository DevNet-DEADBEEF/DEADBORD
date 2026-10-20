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
export function isOverdue(task: Pick<Task, 'done' | 'dueDate'>): boolean {
  if (task.done || task.dueDate == null) return false;
  const due = fromTimestamp(task.dueDate);
  const now = new Date();
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
