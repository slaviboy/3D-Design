import { useCallback, useEffect, useRef, useState } from 'react';
import { isEditableTarget } from '../../app/shortcuts/shortcuts';
import type { RecentFilesRepository } from '../../io/idb/recent';
import type { RecoveryRepository, RecoverySnapshot } from '../../io/idb/recovery';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Notifications } from '../common/Notifications';
import { InputDialog } from '../dialogs/InputDialog';
import { RecoveryDialog } from '../dialogs/RecoveryDialog';
import { KeyboardShortcutsDialog } from '../dialogs/KeyboardShortcutsDialog';
import { PreferencesDialog } from '../dialogs/PreferencesDialog';
import { StartScreen, startScreenEnabled } from '../dialogs/StartScreen';
import { useEditor, useEditorState } from '../EditorContext';
import { MenuBar } from '../menubar/MenuBar';
import { CommandPalette } from '../palette/CommandPalette';
import { ComponentsPanel } from '../panels/ComponentsPanel';
import { EntityInfoPanel } from '../panels/EntityInfoPanel';
import { OutlinerPanel } from '../panels/OutlinerPanel';
import { SoftenPanel } from '../panels/SoftenPanel';
import { MaterialsPanel } from '../panels/MaterialsPanel';
import { TagsPanel } from '../panels/TagsPanel';
import { ScenesPanel } from '../panels/ScenesPanel';
import { ShadowsPanel } from '../panels/ShadowsPanel';
import { SceneTabs } from '../scenes/SceneTabs';
import { StatusBar } from '../statusbar/StatusBar';
import { Toolbar, ToolPalette } from '../toolbar/Toolbar';
import { ViewportHost } from '../viewport/ViewportHost';
import './app.css';

export interface RecoveryOptions {
  readonly repository: RecoveryRepository;
  /** This session's id; its own snapshot is never offered for recovery. */
  readonly sessionId: string;
}

export function App({
  recovery,
  recent,
}: {
  readonly recovery?: RecoveryOptions;
  readonly recent?: RecentFilesRepository;
}) {
  const editor = useEditor();
  const documentName = useEditorState((state) => state.documentName);
  const isDirty = useEditorState((state) => state.isDirty);
  const paletteRequests = useEditorState((state) => state.commandPaletteRequests);
  const backupRequests = useEditorState((state) => state.backupRequests);
  const startScreenRequests = useEditorState((state) => state.startScreenRequests);
  const shortcutsDialogRequests = useEditorState((state) => state.shortcutsDialogRequests);
  const preferencesDialogRequests = useEditorState((state) => state.preferencesDialogRequests);
  const preferences = useEditorState((state) => state.preferences);
  const openPanels = useEditorState((state) => state.openPanels);
  const inputRequest = useEditorState((state) => state.inputRequest);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<readonly RecoverySnapshot[]>([]);
  const [backups, setBackups] = useState<readonly RecoverySnapshot[] | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const startupChecked = useRef(false);

  useEffect(() => {
    document.title = `${isDirty ? '• ' : ''}${documentName} — Planar`;
  }, [documentName, isDirty]);

  useEffect(() => {
    if (paletteRequests > 0) setPaletteOpen(true);
  }, [paletteRequests]);

  useEffect(() => {
    if (startScreenRequests > 0) setStartOpen(true);
  }, [startScreenRequests]);

  useEffect(() => {
    if (shortcutsDialogRequests > 0) setShortcutsOpen(true);
  }, [shortcutsDialogRequests]);

  useEffect(() => {
    if (preferencesDialogRequests > 0) setPreferencesOpen(true);
  }, [preferencesDialogRequests]);

  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preferences.theme);
    root.style.setProperty('--ui-scale', String(preferences.uiScale));
  }, [preferences]);

  useEffect(() => {
    if (backupRequests === 0 || !recovery) return;
    recovery.repository.list().then(
      (snapshots) => {
        setBackups(snapshots.filter((snapshot) => snapshot.kind === 'backup'));
      },
      (error: unknown) => {
        editor.notify(
          'error',
          `Backups are unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }, [backupRequests, editor, recovery]);

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

  const refreshRecoverable = useCallback(async (): Promise<readonly RecoverySnapshot[]> => {
    if (!recovery) return [];
    try {
      const snapshots = (await recovery.repository.list()).filter(
        (snapshot) => snapshot.kind === 'autosave' && snapshot.sessionId !== recovery.sessionId,
      );
      setRecoverable(snapshots);
      return snapshots;
    } catch (error) {
      editor.notify(
        'error',
        `Recovery storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }, [editor, recovery]);

  useEffect(() => {
    let cancelled = false;
    void refreshRecoverable().then((pending) => {
      // The start screen opens once at startup, and not over work waiting to be recovered.
      if (cancelled || startupChecked.current) return;
      startupChecked.current = true;
      if (pending.length === 0 && startScreenEnabled()) setStartOpen(true);
    });
    return () => {
      cancelled = true;
    };
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
          <ErrorBoundary area="the scene tabs">
            <SceneTabs />
          </ErrorBoundary>
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
          {openPanels.includes('soften') && (
            <ErrorBoundary area="the Soften Edges panel">
              <SoftenPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('materials') && (
            <ErrorBoundary area="the Materials panel">
              <MaterialsPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('scenes') && (
            <ErrorBoundary area="the Scenes panel">
              <ScenesPanel />
            </ErrorBoundary>
          )}
          {openPanels.includes('shadows') && (
            <ErrorBoundary area="the Shadows panel">
              <ShadowsPanel />
            </ErrorBoundary>
          )}
        </aside>
      </div>
      <StatusBar />
      <Notifications />
      {preferencesOpen && (
        <PreferencesDialog
          onClose={() => {
            setPreferencesOpen(false);
          }}
        />
      )}
      {shortcutsOpen && (
        <KeyboardShortcutsDialog
          onClose={() => {
            setShortcutsOpen(false);
          }}
        />
      )}
      {startOpen && (
        <StartScreen
          {...(recent ? { recent } : {})}
          onClose={() => {
            setStartOpen(false);
          }}
        />
      )}
      {inputRequest && <InputDialog request={inputRequest} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}
      {backups && (
        <RecoveryDialog
          title="Restore a backup"
          intro="Planar keeps the previous version of a file each time you save over it. Backups are stored only on this device."
          emptyText="There are no backups yet. One is kept the next time you save over a file."
          snapshots={backups}
          onRestore={(snapshot) => {
            if (editor.loadFile(snapshot.bytes, `${snapshot.documentName} (backup)`, null, { dirty: true })) {
              setBackups(null);
            }
          }}
          onDiscard={(snapshot) => {
            void recovery?.repository.delete(snapshot.id).then(() => {
              setBackups((current) => current?.filter((entry) => entry.id !== snapshot.id) ?? null);
            });
          }}
          onClose={() => {
            setBackups(null);
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
