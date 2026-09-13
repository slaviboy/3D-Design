import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStore } from 'zustand';
import { contextMenuAnchor, type ContextMenuCommandEntry } from '../../app/contextMenu/contextMenu';
import { formatChord, isEditableTarget } from '../../app/shortcuts/shortcuts';
import { useEditor } from '../EditorContext';
import {
  closeContextMenu,
  contextMenuJustOpened,
  contextMenuStore,
  showContextMenu,
  type ContextMenuRequest,
} from './contextMenuStore';

/** Space kept between a menu and the window edges. */
const EDGE_MARGIN = 4;

interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Whether a key press asks for the context menu: the Menu key, or Shift+F10. */
export function isContextMenuKey(event: KeyInput): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

function menuItems(container: HTMLElement | null): HTMLElement[] {
  return container ? [...container.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
}

/** Arrow keys, Home and End move between items; a letter moves to the next item starting with it. */
function moveFocus(container: HTMLElement | null, key: string): boolean {
  const items = menuItems(container);
  if (items.length === 0) return false;
  const current = items.findIndex((item) => item === document.activeElement);
  const focusAt = (index: number) => {
    items[(index + items.length) % items.length]?.focus({ preventScroll: true });
  };
  switch (key) {
    case 'ArrowDown':
      focusAt(current + 1);
      return true;
    case 'ArrowUp':
      focusAt(current < 0 ? items.length - 1 : current - 1);
      return true;
    case 'Home':
      focusAt(0);
      return true;
    case 'End':
      focusAt(items.length - 1);
      return true;
  }
  if (key.length !== 1 || key.trim() === '') return false;
  const letter = key.toLowerCase();
  for (let step = 1; step <= items.length; step++) {
    const item = items[(current + step + items.length) % items.length];
    if (item?.dataset.label?.toLowerCase().startsWith(letter)) {
      item.focus({ preventScroll: true });
      break;
    }
  }
  return true;
}

function clampToWindow(left: number, top: number, element: HTMLElement): { left: number; top: number } {
  const { width, height } = element.getBoundingClientRect();
  return {
    left: Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - width - EDGE_MARGIN)),
    top: Math.max(EDGE_MARGIN, Math.min(top, window.innerHeight - height - EDGE_MARGIN)),
  };
}

/** WAI-ARIA menu at the pointer (or at the selection for the keyboard), with one level of submenus. */
function ContextMenu({ request }: { readonly request: ContextMenuRequest }) {
  const editor = useEditor();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<number, HTMLButtonElement>());
  const [position, setPosition] = useState({ left: request.x, top: request.y });
  const [submenu, setSubmenu] = useState<{ readonly index: number; readonly focus: boolean } | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<{ left: number; top: number } | null>(null);
  const submenuId = useId();
  const openSubmenu = submenu ? request.entries[submenu.index] : undefined;

  const close = useCallback(
    (restoreFocus: boolean) => {
      closeContextMenu();
      const target = request.returnFocus;
      if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
    },
    [request],
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    setPosition(clampToWindow(request.x, request.y, menu));
    menuItems(menu)[0]?.focus({ preventScroll: true });
  }, [request]);

  useLayoutEffect(() => {
    const trigger = submenu ? triggerRefs.current.get(submenu.index) : undefined;
    const menu = menuRef.current;
    const element = submenuRef.current;
    if (!trigger || !menu || !element) {
      setSubmenuPosition(null);
      return;
    }
    const menuRect = menu.getBoundingClientRect();
    const { width } = element.getBoundingClientRect();
    const fitsRight = menuRect.right + width + EDGE_MARGIN <= window.innerWidth;
    const left = fitsRight ? menuRect.right - 2 : menuRect.left - width + 2;
    setSubmenuPosition(clampToWindow(left, trigger.getBoundingClientRect().top - 5, element));
  }, [submenu]);

  useEffect(() => {
    // A submenu opened from the keyboard takes focus once it is positioned (hidden elements can't be focused).
    if (submenu?.focus && submenuPosition) menuItems(submenuRef.current)[0]?.focus({ preventScroll: true });
  }, [submenu, submenuPosition]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      closeContextMenu();
      // Focus goes back where it was unless the click itself moved it somewhere.
      window.setTimeout(() => {
        const active = document.activeElement;
        if ((active === null || active === document.body) && request.returnFocus?.isConnected) {
          request.returnFocus.focus({ preventScroll: true });
        }
      }, 0);
    };
    const onResize = () => {
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [close, request]);

  const run = (entry: ContextMenuCommandEntry) => {
    close(true);
    void editor.runCommand(entry.commandId);
  };

  const focusedIndex = (): number => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.dataset.index !== undefined
      ? Number(active.dataset.index)
      : -1;
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = focusedIndex();
    const entry = request.entries[index];
    if (
      entry?.kind === 'submenu' &&
      (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')
    ) {
      setSubmenu({ index, focus: true });
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      close(true);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      // Nothing to open or close at this level.
    } else if (moveFocus(menuRef.current, event.key)) {
      setSubmenu(null);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      const trigger = submenu ? triggerRefs.current.get(submenu.index) : undefined;
      setSubmenu(null);
      trigger?.focus({ preventScroll: true });
    } else if (event.key === 'Tab') {
      close(true);
    } else if (event.key !== 'ArrowRight' && !moveFocus(submenuRef.current, event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const shortcutLabel = (commandId: string): string => {
    const chord = editor.shortcuts.chordsFor(commandId)[0];
    return chord ? formatChord(chord, editor.platform) : '';
  };

  const renderCommand = (entry: ContextMenuCommandEntry, index: number | null) => (
    <button
      type="button"
      key={entry.commandId}
      className="menu__item"
      role={entry.checked === null ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={entry.checked ?? undefined}
      tabIndex={-1}
      data-label={entry.label}
      data-index={index ?? undefined}
      onClick={() => {
        run(entry);
      }}
      onPointerEnter={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        if (index !== null) setSubmenu(null);
      }}
    >
      <span className="menu__check" aria-hidden="true">
        {entry.checked ? '●' : ''}
      </span>
      <span className="menu__label">{entry.label}</span>
      <span className="menu__shortcut">{shortcutLabel(entry.commandId)}</span>
    </button>
  );

  const preventNativeMenu = (event: { preventDefault(): void }) => {
    event.preventDefault();
  };

  return (
    <>
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        aria-label="Context menu"
        style={{ left: position.left, top: position.top }}
        onKeyDown={onMenuKeyDown}
        onContextMenu={preventNativeMenu}
      >
        {request.entries.map((entry, index) => {
          if (entry.kind === 'separator') {
            return <div key={`separator-${String(index)}`} className="menu__separator" role="separator" />;
          }
          if (entry.kind === 'command') return renderCommand(entry, index);
          const open = submenu?.index === index;
          return (
            <button
              type="button"
              key={`submenu-${entry.label}`}
              ref={(element) => {
                if (element) triggerRefs.current.set(index, element);
                else triggerRefs.current.delete(index);
              }}
              className="menu__item"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? submenuId : undefined}
              tabIndex={-1}
              data-label={entry.label}
              data-index={index}
              onClick={() => {
                setSubmenu({ index, focus: true });
              }}
              onPointerEnter={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setSubmenu((current) => (current?.index === index ? current : { index, focus: false }));
              }}
            >
              <span className="menu__check" aria-hidden="true" />
              <span className="menu__label">{entry.label}</span>
              <span className="menu__shortcut" aria-hidden="true">
                ▸
              </span>
            </button>
          );
        })}
      </div>
      {openSubmenu?.kind === 'submenu' && (
        <div
          ref={submenuRef}
          id={submenuId}
          className="context-menu"
          role="menu"
          aria-label={openSubmenu.label}
          style={
            submenuPosition
              ? { left: submenuPosition.left, top: submenuPosition.top }
              : { left: 0, top: 0, visibility: 'hidden' }
          }
          onKeyDown={onSubmenuKeyDown}
          onContextMenu={preventNativeMenu}
        >
          {openSubmenu.items.map((item) => renderCommand(item, null))}
        </div>
      )}
    </>
  );
}

/** Renders the open context menu, and opens one for the selection on Shift+F10 or the Menu key. */
export function ContextMenuLayer() {
  const editor = useEditor();
  const request = useStore(contextMenuStore, (state) => state.request);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isContextMenuKey(event) || isEditableTarget(event.target)) return;
      if (contextMenuJustOpened() || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const viewport = document.querySelector<HTMLElement>('.viewport');
      if (!viewport) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const anchor = contextMenuAnchor(editor);
      const active = document.activeElement;
      const returnFocus = active instanceof HTMLElement && active !== document.body ? active : viewport;
      showContextMenu(editor, { x: rect.left + anchor.x, y: rect.top + anchor.y }, returnFocus);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editor]);

  return request ? <ContextMenu key={request.id} request={request} /> : null;
}
