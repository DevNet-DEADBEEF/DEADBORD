/**
 * State shared by the logged-in workspace (src/app/(workspace)/_layout.tsx):
 * which side panel is open, which list to scroll to, and a change counter
 * that tells every pane to reload after an edit.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Id } from '@/api/types';

export type Panel = { kind: 'task'; taskId: Id } | { kind: 'members'; boardId: Id };

interface Workspace {
  panel: Panel | undefined;
  openTask(taskId: Id): void;
  openMembers(boardId: Id): void;
  closePanel(): void;
  /** Bumped after any edit; panes reload when it changes. */
  version: number;
  changed(): void;
  /** A list picked in the tree, for the board view to scroll to. */
  focusList: Id | undefined;
  setFocusList(listId: Id | undefined): void;
}

const WorkspaceContext = createContext<Workspace | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>();
  const [version, setVersion] = useState(0);
  const [focusList, setFocusList] = useState<Id>();

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo<Workspace>(
    () => ({
      panel,
      openTask: (taskId) => setPanel({ kind: 'task', taskId }),
      openMembers: (boardId) => setPanel({ kind: 'members', boardId }),
      closePanel: () => setPanel(undefined),
      version,
      changed,
      focusList,
      setFocusList,
    }),
    [panel, version, changed, focusList],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return workspace;
}

/** Wide windows get the three-pane layout; narrow ones stack the tree on top and use modals. */
export const WIDE_MIN_WIDTH = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}
