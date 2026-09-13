import { useCallback, useEffect, useState } from 'react';
import { isEditableTarget } from '../../app/shortcuts/shortcuts';
import type { RecoveryRepository, RecoverySnapshot } from '../../io/idb/recovery';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Notifications } from '../common/Notifications';
import { RecoveryDialog } from '../dialogs/RecoveryDialog';
import { useEditor, useEditorState } from '../EditorContext';
import { MenuBar } from '../menubar/MenuBar';
import { CommandPalette } from '../palette/CommandPalette';
import { ComponentsPanel } from '../panels/ComponentsPanel';
import { EntityInfoPanel } from '../panels/EntityInfoPanel';
import { OutlinerPanel } from '../panels/OutlinerPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { StatusBar } from '../statusbar/StatusBar';
import { Toolbar, ToolPalette } from '../toolbar/Toolbar';
import { ViewportHost } from '../viewport/ViewportHost';
import './app.css';

export interface RecoveryOptions {
  readonly repository: RecoveryRepository;
  /** This session's id; its own snapshot is never offered for recovery. */
  readonly sessionId: string;
}

export function App({ recovery }: { readonly recovery?: RecoveryOptions }) {
  const editor = useEditor();
  const documentName = useEditorState((state) => state.documentName);
  const isDirty = useEditorState((state) => state.isDirty);
  const paletteRequests = useEditorState((state) => state.commandPaletteRequests);
  const openPanels = useEditorState((state) => state.openPanels);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<readonly RecoverySnapshot[]>([]);

  useEffect(() => {
    document.title = `${isDirty ? '• ' : ''}${documentName} — Planar`;
  }, [documentName, isDirty]);

  useEffect(() => {
    if (paletteRequests > 0) setPaletteOpen(true);
  }, [paletteRequests]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (editor.handleKey(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editor]);

  const refreshRecoverable = useCallback(async () => {
    if (!recovery) return;
    try {
      const snapshots = await recovery.repository.list();
      setRecoverable(snapshots.filter((snapshot) => snapshot.id !== recovery.sessionId));
    } catch (error) {
      editor.notify(
        'error',
        `Recovery storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [editor, recovery]);

  useEffect(() => {
    void refreshRecoverable();
  }, [refreshRecoverable]);

  const discard = async (snapshot: RecoverySnapshot) => {
    await recovery?.repository.delete(snapshot.id);
    await refreshRecoverable();
  };

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <div className="workspace">
        <ToolPalette />
        <main className="workspace__viewport" aria-label="Modeling workspace">
          <ErrorBoundary area="the 3D view">
            <ViewportHost />
          </ErrorBoundary>
        </main>
        <aside className="dock" aria-label="Panels">
          {openPanels.includes('entityInfo') && (
            <ErrorBoundary area="the Entity Info panel">
              <EntityInfoPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('outliner') && (
            <ErrorBoundary area="the Outliner panel">
              <OutlinerPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('components') && (
            <ErrorBoundary area="the Components panel">
              <ComponentsPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('tags') && (
            <ErrorBoundary area="the Tags panel">
              <TagsPanel />
            </ErrorBoundary>
          )}
        </aside>
      </div>
      <StatusBar />
      <Notifications />
      {paletteOpen && (
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}
      {recoverable.length > 0 && (
        <RecoveryDialog
          snapshots={recoverable}
          onRestore={(snapshot) => {
            if (
              editor.loadFile(snapshot.bytes, `${snapshot.documentName} (recovered)`, null, { dirty: true })
            ) {
              void discard(snapshot);
            }
          }}
          onDiscard={(snapshot) => {
            void discard(snapshot);
          }}
          onClose={() => {
            setRecoverable([]);
          }}
        />
      )}
    </div>
  );
}
