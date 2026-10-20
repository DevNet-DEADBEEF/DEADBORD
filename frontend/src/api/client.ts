import { sortTasks } from '@/tasks';
import { request } from './request';
import type {
  Board,
  BoardSummary,
  BoardView,
  Id,
  List,
  NewTask,
  Permission,
  Task,
  TaskPatch,
  TaskView,
} from './types';

/**
 * Board, list and task data. Calls act as the logged-in user (logging in is
 * handled by src/auth). Today this runs over the backend's HTTP API
 * (backend/src/http/api.ts); it will move to TDLP once that exists.
 */
export interface DeadbordClient {
  /** Called whenever the session key changes; undefined when logged out. */
  setSessionKey(key: string | undefined): void;

  listBoards(): Promise<BoardSummary[]>;
  createBoard(title: string): Promise<Board>;
  getBoard(boardId: Id): Promise<BoardView>;

  createList(boardId: Id, title: string): Promise<List>;

  getTask(taskId: Id): Promise<TaskView>;
  createTask(listId: Id, input: NewTask): Promise<Task>;
  updateTask(taskId: Id, patch: TaskPatch): Promise<Task>;
  removeTask(taskId: Id): Promise<void>;
  addComment(taskId: Id, text: string): Promise<Task>;

  /** Owner only. */
  inviteMember(boardId: Id, username: string, permission: Permission): Promise<Board>;
  setMemberPermission(boardId: Id, userId: Id, permission: Permission): Promise<Board>;
  removeMember(boardId: Id, userId: Id): Promise<Board>;
}

class HttpClient implements DeadbordClient {
  private key: string | undefined;

  setSessionKey(key: string | undefined): void {
    this.key = key;
  }

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return request<T>(`/api${path}`, { method, key: this.key, body });
  }

  listBoards() {
    return this.call<BoardSummary[]>('GET', '/boards');
  }

  createBoard(title: string) {
    return this.call<Board>('POST', '/boards', { title });
  }

  async getBoard(boardId: Id) {
    const view = await this.call<BoardView>('GET', `/boards/${boardId}`);
    return { ...view, lists: view.lists.map((l) => ({ ...l, tasks: sortTasks(l.tasks) })) };
  }

  createList(boardId: Id, title: string) {
    return this.call<List>('POST', `/boards/${boardId}/lists`, { title });
  }

  getTask(taskId: Id) {
    return this.call<TaskView>('GET', `/tasks/${taskId}`);
  }

  createTask(listId: Id, input: NewTask) {
    return this.call<Task>('POST', `/lists/${listId}/tasks`, input);
  }

  updateTask(taskId: Id, patch: TaskPatch) {
    return this.call<Task>('PATCH', `/tasks/${taskId}`, patch);
  }

  removeTask(taskId: Id) {
    return this.call<void>('DELETE', `/tasks/${taskId}`);
  }

  addComment(taskId: Id, text: string) {
    return this.call<Task>('POST', `/tasks/${taskId}/comments`, { text });
  }

  inviteMember(boardId: Id, username: string, permission: Permission) {
    return this.call<Board>('POST', `/boards/${boardId}/members`, { username, permission });
  }

  setMemberPermission(boardId: Id, userId: Id, permission: Permission) {
    return this.call<Board>('PATCH', `/boards/${boardId}/members/${userId}`, { permission });
  }

  removeMember(boardId: Id, userId: Id) {
    return this.call<Board>('DELETE', `/boards/${boardId}/members/${userId}`);
  }
}

export const client: DeadbordClient = new HttpClient();
