import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AutosaveController } from './app/autosave/AutosaveController';
import { Editor } from './app/Editor';
import { projectToScreen } from './app/camera/camera';
import type { Platform } from './app/shortcuts/shortcuts';
import { vec3 } from './kernel/math/vec3';
import { createEditorStore } from './app/stores/editorStore';
import { createBrowserFileAccess } from './io/fs/browserFileAccess';
import { IndexedDbRecoveryRepository, openPlanarDatabase } from './io/idb/recovery';
import { EditorProvider } from './ui/EditorContext';
import { App, type RecoveryOptions } from './ui/shell/App';
import './ui/shell/base.css';

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

  let recovery: RecoveryOptions | undefined;
  try {
    const repository = new IndexedDbRecoveryRepository(await openPlanarDatabase(indexedDB));
    const autosave = new AutosaveController({
      session: editor.session,
      repository,
      encode: () => editor.encodeDocument(),
      sessionId: crypto.randomUUID(),
      onError: (error) => {
        editor.notify('error', `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    autosave.start();
    recovery = { repository, sessionId: autosave.sessionId };
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
        <App {...(recovery ? { recovery } : {})} />
      </EditorProvider>
    </StrictMode>,
  );
}

void start();
