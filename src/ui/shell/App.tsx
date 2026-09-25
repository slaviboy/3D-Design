/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useStore } from 'zustand';
import { panelOrder } from '../../app/dock/dockLayout';
import type { PanelId } from '../../app/panels/panels';
import type { PreferencesTab } from '../../app/preferences/preferences';
import { isEditableTarget } from '../../app/shortcuts/shortcuts';
import type { RecentFilesRepository } from '../../io/idb/recent';
import type { RecoveryRepository, RecoverySnapshot } from '../../io/idb/recovery';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Notifications } from '../common/Notifications';
import { TooltipLayer } from '../common/Tooltip';
import { ExchangeDialog } from '../dialogs/ExchangeDialogs';
import { InputDialog } from '../dialogs/InputDialog';
import { RecoveryDialog } from '../dialogs/RecoveryDialog';
import { PreferencesDialog } from '../dialogs/PreferencesDialog';
import { StartScreen, startScreenEnabled } from '../dialogs/StartScreen';
import { Text3DDialog } from '../dialogs/Text3DDialog';
import { useEditor, useEditorState } from '../EditorContext';
import { dockDrawerStore, NARROW_LAYOUT_QUERY, setDockDrawerOpen, useMediaQuery } from './dockDrawer';
import { FileDrop } from './FileDrop';
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
import { EnvironmentPanel } from '../panels/EnvironmentPanel';
import { FogPanel } from '../panels/FogPanel';
import { StylesPanel } from '../panels/StylesPanel';
import { SceneTabs } from '../scenes/SceneTabs';
import { StatusBar } from '../statusbar/StatusBar';
import { Toolbar, ToolPalette } from '../toolbar/Toolbar';
import { ViewportHost } from '../viewport/ViewportHost';
import { ContextMenuLayer } from '../contextmenu/ContextMenu';
import { DockSplitter } from '../dock/DockSplitter';
import { InstructorPanel } from '../panels/InstructorPanel';
import './app.css';

/** The component for each dock panel, and how its error boundary names it. */
const DOCK_PANELS: Record<PanelId, { readonly area: string; readonly Component: ComponentType }> = {
  entityInfo: { area: 'the Entity Info panel', Component: EntityInfoPanel },
  outliner: { area: 'the Outliner panel', Component: OutlinerPanel },
  components: { area: 'the Components panel', Component: ComponentsPanel },
  tags: { area: 'the Tags panel', Component: TagsPanel },
  soften: { area: 'the Soften Edges panel', Component: SoftenPanel },
  materials: { area: 'the Materials panel', Component: MaterialsPanel },
  scenes: { area: 'the Scenes panel', Component: ScenesPanel },
  shadows: { area: 'the Shadows panel', Component: ShadowsPanel },
  instructor: { area: 'the Instructor panel', Component: InstructorPanel },
  styles: { area: 'the Styles panel', Component: StylesPanel },
  fog: { area: 'the Fog panel', Component: FogPanel },
  environment: { area: 'the Environment panel', Component: EnvironmentPanel },
};

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
  const preferencesDialogRequests = useEditorState((state) => state.preferencesDialogRequests);
  const preferencesDialogTab = useEditorState((state) => state.preferencesDialogTab);
  const text3dDialogRequests = useEditorState((state) => state.text3dDialogRequests);
  const preferences = useEditorState((state) => state.preferences);
  const openPanels = useEditorState((state) => state.openPanels);
  const dockLayout = useEditorState((state) => state.dockLayout);
  const panelFocusRequest = useEditorState((state) => state.panelFocusRequest);
  const narrow = useMediaQuery(NARROW_LAYOUT_QUERY);
  const drawerOpen = useStore(dockDrawerStore, (state) => state.open);
  const inputRequest = useEditorState((state) => state.inputRequest);
  const exchangeRequest = useEditorState((state) => state.exchangeRequest);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recoverable, setRecoverable] = useState<readonly RecoverySnapshot[]>([]);
  const [backups, setBackups] = useState<readonly RecoverySnapshot[] | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesTab, setPreferencesTab] = useState<PreferencesTab>('general');
  const [text3dOpen, setText3dOpen] = useState(false);
  const startupChecked = useRef(false);

  useEffect(() => {
    document.title = `${isDirty ? '• ' : ''}${documentName} — Planar`;
  }, [documentName, isDirty]);

  // On a narrow screen the panels are a drawer over the view: showing or asking for a panel opens it, and Escape
  // closes it. Only changes count, so turning a tablet doesn't open it.
  const seenPanels = useRef({ open: openPanels, focus: panelFocusRequest?.serial });
  useEffect(() => {
    const seen = seenPanels.current;
    const shown =
      openPanels.some((id) => !seen.open.includes(id)) || panelFocusRequest?.serial !== seen.focus;
    seenPanels.current = { open: openPanels, focus: panelFocusRequest?.serial };
    if (shown && narrow) setDockDrawerOpen(true);
  }, [openPanels, panelFocusRequest, narrow]);

  useEffect(() => {
    if (!narrow) setDockDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDockDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [narrow, drawerOpen]);

  useEffect(() => {
    if (paletteRequests > 0) setPaletteOpen(true);
  }, [paletteRequests]);

  useEffect(() => {
    if (startScreenRequests > 0) setStartOpen(true);
  }, [startScreenRequests]);

  useEffect(() => {
    if (preferencesDialogRequests === 0) return;
    setPreferencesTab(preferencesDialogTab);
    setPreferencesOpen(true);
  }, [preferencesDialogRequests, preferencesDialogTab]);

  useEffect(() => {
    if (text3dDialogRequests > 0) setText3dOpen(true);
  }, [text3dDialogRequests]);

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
      <ErrorBoundary area="file drop" layout="overlay">
        <FileDrop />
      </ErrorBoundary>
      <ErrorBoundary area="the menu bar" layout="line">
        <MenuBar />
      </ErrorBoundary>
      <ErrorBoundary area="the toolbar" layout="line">
        <Toolbar />
      </ErrorBoundary>
      <div className="workspace">
        <ErrorBoundary area="the tool palette" layout="line">
          <ToolPalette />
        </ErrorBoundary>
        <main className="workspace__viewport" aria-label="Modeling workspace">
          <ErrorBoundary area="the scene tabs">
            <SceneTabs />
          </ErrorBoundary>
          <ErrorBoundary area="the 3D view">
            <ViewportHost />
          </ErrorBoundary>
        </main>
        {narrow && drawerOpen && (
          <div
            className="dock-scrim"
            aria-hidden="true"
            onPointerDown={() => {
              setDockDrawerOpen(false);
            }}
          />
        )}
        <aside
          className="dock"
          id="dock"
          aria-label="Panels"
          data-open={drawerOpen ? 'true' : undefined}
          // A closed drawer is off screen: nothing in it can be reached.
          inert={narrow && !drawerOpen}
        >
          {/* Rendered in dock order, so keyboard focus moves through panels in the order the user arranged. */}
          {panelOrder(dockLayout.order)
            .filter((id) => openPanels.includes(id))
            .map((id) => {
              const { area, Component } = DOCK_PANELS[id];
              return (
                <ErrorBoundary key={id} area={area}>
                  <Component />
                </ErrorBoundary>
              );
            })}
        </aside>
        <ErrorBoundary area="the panel splitter" layout="line">
          <DockSplitter />
        </ErrorBoundary>
      </div>
      <ErrorBoundary area="the status bar" layout="line">
        <StatusBar />
      </ErrorBoundary>
      <ErrorBoundary area="tool tips" layout="overlay">
        <TooltipLayer />
      </ErrorBoundary>
      <ErrorBoundary area="notifications" layout="overlay">
        <Notifications />
      </ErrorBoundary>
      <ErrorBoundary area="the context menu" layout="overlay">
        <ContextMenuLayer />
      </ErrorBoundary>
      {preferencesOpen && (
        <ErrorBoundary
          area="Preferences"
          layout="overlay"
          onDismiss={() => {
            setPreferencesOpen(false);
          }}
        >
          <PreferencesDialog
            tab={preferencesTab}
            onTabChange={setPreferencesTab}
            onClose={() => {
              setPreferencesOpen(false);
            }}
          />
        </ErrorBoundary>
      )}
      {text3dOpen && (
        <ErrorBoundary
          area="3D Text"
          layout="overlay"
          onDismiss={() => {
            setText3dOpen(false);
          }}
        >
          <Text3DDialog
            onClose={() => {
              setText3dOpen(false);
            }}
          />
        </ErrorBoundary>
      )}
      {startOpen && (
        <ErrorBoundary
          area="the start screen"
          layout="overlay"
          onDismiss={() => {
            setStartOpen(false);
          }}
        >
          <StartScreen
            {...(recent ? { recent } : {})}
            onClose={() => {
              setStartOpen(false);
            }}
          />
        </ErrorBoundary>
      )}
      {inputRequest && (
        <ErrorBoundary
          area="the input dialog"
          layout="overlay"
          onDismiss={() => {
            editor.resolveInput(null);
          }}
        >
          <InputDialog request={inputRequest} />
        </ErrorBoundary>
      )}
      {exchangeRequest && (
        <ErrorBoundary
          area="the import and export options"
          layout="overlay"
          onDismiss={() => {
            editor.exchange.dismissRequest();
          }}
        >
          <ExchangeDialog request={exchangeRequest} />
        </ErrorBoundary>
      )}
      {paletteOpen && (
        <ErrorBoundary
          area="the command palette"
          layout="overlay"
          onDismiss={() => {
            setPaletteOpen(false);
          }}
        >
          <CommandPalette
            onClose={() => {
              setPaletteOpen(false);
            }}
          />
        </ErrorBoundary>
      )}
      {backups && (
        <ErrorBoundary
          area="backups"
          layout="overlay"
          onDismiss={() => {
            setBackups(null);
          }}
        >
          <RecoveryDialog
            title="Restore a backup"
            intro="Planar keeps the previous version of a file each time you save over it. Backups are stored only on this device."
            emptyText="There are no backups yet. One is kept the next time you save over a file."
            snapshots={backups}
            onRestore={(snapshot) => {
              if (
                editor.loadFile(snapshot.bytes, `${snapshot.documentName} (backup)`, null, { dirty: true })
              ) {
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
        </ErrorBoundary>
      )}
      {recoverable.length > 0 && (
        <ErrorBoundary
          area="recovery"
          layout="overlay"
          onDismiss={() => {
            setRecoverable([]);
          }}
        >
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
        </ErrorBoundary>
      )}
    </div>
  );
}
