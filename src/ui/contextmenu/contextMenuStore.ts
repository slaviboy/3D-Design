import { createStore } from 'zustand/vanilla';
import { contextMenuFor, type ContextMenuEntry } from '../../app/contextMenu/contextMenu';
import type { Editor } from '../../app/Editor';

/** How long after opening a menu the browser's own contextmenu event for the same gesture is ignored. */
const DUPLICATE_OPEN_MS = 250;

export interface ContextMenuRequest {
  readonly id: number;
  /** Requested top-left corner in window coordinates; the menu is kept inside the window. */
  readonly x: number;
  readonly y: number;
  readonly entries: readonly ContextMenuEntry[];
  /** Receives focus again when the menu closes. */
  readonly returnFocus: HTMLElement | null;
  readonly openedAt: number;
}

interface ContextMenuState {
  readonly request: ContextMenuRequest | null;
}

/** The one open context menu, shared by the viewport, the Outliner and the keyboard shortcut. */
export const contextMenuStore = createStore<ContextMenuState>(() => ({ request: null }));

let nextRequestId = 1;

/** Opens the context menu for the current selection. Returns false when no command applies. */
export function showContextMenu(
  editor: Editor,
  position: { readonly x: number; readonly y: number },
  returnFocus: HTMLElement | null,
): boolean {
  const entries = contextMenuFor(editor);
  if (entries.length === 0) return false;
  contextMenuStore.setState({
    request: {
      id: nextRequestId++,
      x: position.x,
      y: position.y,
      entries,
      returnFocus,
      openedAt: performance.now(),
    },
  });
  return true;
}

export function closeContextMenu(): void {
  contextMenuStore.setState({ request: null });
}

/** Whether a menu opened a moment ago, so a second open request for the same key press or click is ignored. */
export function contextMenuJustOpened(): boolean {
  const { request } = contextMenuStore.getState();
  return request !== null && performance.now() - request.openedAt < DUPLICATE_OPEN_MS;
}
