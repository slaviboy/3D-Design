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

import { createLogger } from './app/diagnostics/log';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AutosaveController } from './app/autosave/AutosaveController';
import { Editor } from './app/Editor';
import { projectToScreen } from './app/camera/camera';
import { ViewCaptureRelay } from './app/io/viewCapture';
import type { Platform } from './app/shortcuts/shortcuts';
import { vec3 } from './kernel/math/vec3';
import {
  DEFAULT_PREFERENCES,
  MILLISECONDS_PER_MINUTE,
  parsePreferences,
  serializePreferences,
} from './app/preferences/preferences';
import { exportShortcuts, parseStoredOverrides } from './app/shortcuts/customization';
import { createEditorStore } from './app/stores/editorStore';
import { createBrowserFileAccess } from './io/fs/browserFileAccess';
import { IndexedDbRecentFilesRepository, type RecentFilesRepository } from './io/idb/recent';
import { IndexedDbRecoveryRepository, openPlanarDatabase } from './io/idb/recovery';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { EditorProvider } from './ui/EditorContext';
import { App, type RecoveryOptions } from './ui/shell/App';
import './ui/shell/base.css';
import { DEFAULT_DOCK_LAYOUT, parseDockLayout, serializeDockLayout } from './app/dock/dockLayout';

const startupLog = createLogger('startup');

declare global {
  interface Window {
    /** End-to-end test access, present only in `--mode e2e` builds. */
    __planar?: {
      readonly editor: Editor;
      /** Viewport pixel position of a world point, or null when it is behind the camera. */
      readonly screenOf: (point: { x: number; y: number; z: number }) => { x: number; y: number } | null;
    };
  }
}

/**
 * Which key acts as Mod (Command or Ctrl). Uses the reported OS platform rather than the user agent string, which
 * browsers and tools can override without changing the physical keyboard.
 */
function detectPlatform(): Platform {
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  // An empty navigator.platform (possible in privacy modes) falls back to the client hints value.
  const platform = navigator.platform !== '' ? navigator.platform : (userAgentData?.platform ?? '');
  return /mac|iphone|ipad/i.test(platform) ? 'mac' : 'other';
}

async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Planar: the #root element is missing from index.html');

  const editor = new Editor({
    platform: detectPlatform(),
    appVersion: __APP_VERSION__,
    fileAccess: createBrowserFileAccess(),
    viewCapture: new ViewCaptureRelay(),
    confirmDiscardChanges: (name) => Promise.resolve(window.confirm(`Discard unsaved changes to "${name}"?`)),
  });
  const store = createEditorStore(editor);
  if (__PLANAR_TEST_HOOKS__) {
    window.__planar = {
      editor,
      screenOf: (point) =>
        projectToScreen(editor.session.camera, vec3(point.x, point.y, point.z), editor.viewportSize),
    };
  }

  const shortcutsKey = 'planar.shortcuts';
  editor.setShortcutStorage({
    load: () => {
      try {
        return parseStoredOverrides(window.localStorage.getItem(shortcutsKey), editor.commands.all());
      } catch {
        return {};
      }
    },
    save: (overrides) => {
      window.localStorage.setItem(shortcutsKey, exportShortcuts(overrides));
    },
  });

  const preferencesKey = 'planar.preferences';
  editor.setPreferenceStorage({
    load: () => {
      try {
        return parsePreferences(window.localStorage.getItem(preferencesKey));
      } catch {
        return DEFAULT_PREFERENCES;
      }
    },
    save: (preferences) => {
      window.localStorage.setItem(preferencesKey, serializePreferences(preferences));
    },
  });

  const dockKey = 'planar.dock';
  editor.setDockLayoutStorage({
    load: () => {
      try {
        return parseDockLayout(window.localStorage.getItem(dockKey));
      } catch {
        return DEFAULT_DOCK_LAYOUT;
      }
    },
    save: (layout) => {
      window.localStorage.setItem(dockKey, serializeDockLayout(layout));
    },
  });

  let recovery: RecoveryOptions | undefined;
  let recent: RecentFilesRepository | undefined;
  try {
    const db = await openPlanarDatabase(indexedDB);
    const repository = new IndexedDbRecoveryRepository(db);
    const autosave = new AutosaveController({
      session: editor.session,
      repository,
      encode: () => editor.encodeDocument(),
      sessionId: crypto.randomUUID(),
      intervalMs: editor.preferences.autosaveMinutes * MILLISECONDS_PER_MINUTE,
      onError: (error) => {
        startupLog.warn('Autosave failed', error);
        editor.notify('error', `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    autosave.start();
    editor.subscribe((event) => {
      if (event.kind === 'preferences') {
        autosave.setIntervalMs(editor.preferences.autosaveMinutes * MILLISECONDS_PER_MINUTE);
      }
    });
    editor.setBackupRepository(repository, autosave.sessionId);
    recovery = { repository, sessionId: autosave.sessionId };
    const recentFiles = new IndexedDbRecentFilesRepository(db);
    editor.setRecentFiles({
      record: (name, handle, thumbnail) => {
        recentFiles.add({ name, openedAt: Date.now(), handle, thumbnail }).catch((error: unknown) => {
          startupLog.warn('Recent files update failed', error);
          editor.notify(
            'error',
            `Could not update recent files: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
    });
    recent = recentFiles;
    window.addEventListener('pagehide', () => {
      if (!editor.session.isDirty) void autosave.discard();
    });
  } catch (error) {
    editor.notify(
      'error',
      `Local storage is unavailable, so autosave is off: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  window.addEventListener('beforeunload', (event) => {
    if (editor.session.isDirty) event.preventDefault();
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const { registerSW } = await import('virtual:pwa-register');
    void registerSW({ immediate: true });
  }

  createRoot(container).render(
    <StrictMode>
      <EditorProvider editor={editor} store={store}>
        {/* Last line of defence: a rendering error anywhere else still leaves a way to reload, never a blank page. */}
        <ErrorBoundary area="Planar" layout="page">
          <App {...(recovery ? { recovery } : {})} {...(recent ? { recent } : {})} />
        </ErrorBoundary>
      </EditorProvider>
    </StrictMode>,
  );
}

void start();
