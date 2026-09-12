import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Projection } from '../camera/camera';
import type { Editor, EditorNotification } from '../Editor';
import type { ToolOverlay } from '../tools/Tool';

/** Flat, UI-facing snapshot of editor state. Components subscribe to individual fields. */
export interface EditorViewState {
  readonly revision: number;
  readonly documentName: string;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly undoLabel: string | undefined;
  readonly canRedo: boolean;
  readonly redoLabel: string | undefined;
  readonly selectionTotal: number;
  readonly selectionFaces: number;
  readonly selectionEdges: number;
  readonly selectionInstances: number;
  readonly selectionVersion: number;
  readonly activeToolId: string;
  readonly statusHint: string;
  readonly overlay: ToolOverlay | null;
  readonly projection: Projection;
  readonly notifications: readonly EditorNotification[];
  /** Increments each time something asks for the command palette. */
  readonly commandPaletteRequests: number;
}

export interface EditorStore extends StoreApi<EditorViewState> {
  dispose(): void;
}

/** Keeps a zustand store in sync with the editor's session, tools and notifications. */
export function createEditorStore(editor: Editor): EditorStore {
  let selectionVersion = 0;
  let commandPaletteRequests = 0;
  const snapshot = (): EditorViewState => {
    const { session, tools } = editor;
    const { doc, selection } = session;
    return {
      revision: session.revision,
      documentName: session.documentName,
      isDirty: session.isDirty,
      canUndo: doc.canUndo,
      undoLabel: doc.undoLabel,
      canRedo: doc.canRedo,
      redoLabel: doc.redoLabel,
      selectionTotal: selection.size,
      selectionFaces: selection.count('face'),
      selectionEdges: selection.count('edge'),
      selectionInstances: selection.count('instance'),
      selectionVersion,
      activeToolId: tools.activeToolId,
      statusHint: tools.statusHint,
      overlay: tools.overlay,
      projection: session.camera.projection,
      notifications: editor.notifications,
      commandPaletteRequests,
    };
  };
  const store = createStore<EditorViewState>(snapshot);
  const refresh = (): void => {
    store.setState(snapshot());
  };
  const unsubscribers = [
    editor.session.subscribe((event) => {
      if (event.kind === 'selection' || event.kind === 'document') selectionVersion++;
      refresh();
    }),
    editor.tools.subscribe(refresh),
    editor.subscribe((event) => {
      if (event.kind === 'ui-request') commandPaletteRequests++;
      refresh();
    }),
  ];
  return Object.assign(store, {
    dispose: () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  });
}
