import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatChord } from '../../app/shortcuts/shortcuts';
import { useEditor, useEditorState } from '../EditorContext';

interface MenuDefinition {
  readonly label: string;
  /** Command ids; null draws a separator. */
  readonly items: readonly (string | null)[];
}

export const MENUS: readonly MenuDefinition[] = [
  {
    label: 'File',
    items: [
      'file.new',
      'file.startScreen',
      'file.open',
      null,
      'file.save',
      'file.saveAs',
      'file.backups',
      null,
      'file.import',
      'file.exportModel',
      'file.exportImage',
      null,
      'file.openSample',
    ],
  },
  {
    label: 'Edit',
    items: [
      'edit.undo',
      'edit.redo',
      null,
      'edit.selectAll',
      'edit.selectNone',
      null,
      'edit.delete',
      null,
      'edit.makeGroup',
      'edit.makeComponent',
      'edit.explode',
      null,
      'edit.flipX',
      'edit.flipY',
      'edit.flipZ',
      null,
      'edit.divide',
      'edit.weld',
      'edit.explodeCurve',
      null,
      'edit.openGroup',
      'edit.closeGroup',
      null,
      'edit.makeUnique',
      'edit.lock',
      'edit.unlock',
      'edit.intersectWithModel',
      'edit.intersectWithSelection',
    ],
  },
  {
    label: 'Camera',
    items: [
      'camera.view.top',
      'camera.view.bottom',
      'camera.view.front',
      'camera.view.back',
      'camera.view.left',
      'camera.view.right',
      'camera.view.iso',
      null,
      'camera.perspective',
      'camera.parallel',
      null,
      'camera.zoomExtents',
    ],
  },
  {
    label: 'Draw',
    items: [
      'tool.line',
      'tool.freehand',
      null,
      'tool.rectangle',
      'tool.rotatedRectangle',
      'tool.circle',
      'tool.polygon',
      null,
      'tool.arc',
      'tool.twoPointArc',
      'tool.threePointArc',
      'tool.pie',
    ],
  },
  {
    label: 'Tools',
    items: [
      'tool.select',
      'tool.eraser',
      null,
      'tool.move',
      'tool.pushPull',
      'tool.rotate',
      'tool.scale',
      'tool.offset',
      null,
      'tool.tapeMeasure',
      'tool.protractor',
      'tool.axes',
      'axes.reset',
      null,
      'tool.dimension',
      'tool.text',
      null,
      'tool.paint',
      'materials.paintSelection',
      'materials.purgeUnused',
      null,
      'tool.sectionPlane',
      'section.toggleActive',
      'section.reverse',
      'section.createGroupFromSlice',
      null,
      'tool.orbit',
      'tool.pan',
      'tool.zoom',
      null,
      'tool.followMe',
      // Solid Tools
      null,
      'tools.outerShell',
      'tools.union',
      'tools.subtract',
      'tools.trim',
      'tools.intersect',
      'tools.split',
    ],
  },
  {
    label: 'View',
    items: [
      'view.sectionPlanes',
      'view.sectionCuts',
      'view.shadows',
      null,
      'scene.add',
      'scene.update',
      'scene.remove',
      'scene.previous',
      'scene.next',
      null,
      'view.animation.play',
      'view.animation.stop',
    ],
  },
  {
    label: 'Window',
    items: [
      'window.entityInfo',
      'window.outliner',
      'window.components',
      'window.tags',
      'window.soften',
      'window.materials',
      'window.scenes',
      'window.shadows',
      null,
      'app.preferences',
      null,
      'window.instructor',
      'window.resetPanels',
    ],
  },
  { label: 'Help', items: ['help.commandPalette', 'help.keyboardShortcuts'] },
];

/** WAI-ARIA menubar: arrow keys move between menus and items, Enter or Space runs, Escape closes. */
export function MenuBar() {
  const editor = useEditor();
  // Re-render when anything that affects labels, checked or enabled state changes.
  useEditorState(
    (state) =>
      `${String(state.revision)}|${String(state.selectionVersion)}|${state.activeToolId}|${state.projection}`,
  );
  const undoLabel = useEditorState((state) => state.undoLabel);
  const redoLabel = useEditorState((state) => state.redoLabel);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;
    itemRefs.current.find((item) => item !== null && !item.disabled)?.focus();
    const close = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, [openIndex]);

  const openMenu = (index: number) => {
    itemRefs.current = [];
    setOpenIndex((index + MENUS.length) % MENUS.length);
  };

  const closeMenu = (focusTrigger: boolean) => {
    const index = openIndex;
    setOpenIndex(null);
    if (focusTrigger && index !== null) triggerRefs.current[index]?.focus();
  };

  const run = (commandId: string) => {
    closeMenu(true);
    void editor.runCommand(commandId);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null && !item.disabled,
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => items[(index + items.length) % items.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        focusAt(current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'ArrowRight':
        if (openIndex !== null) openMenu(openIndex + 1);
        break;
      case 'ArrowLeft':
        if (openIndex !== null) openMenu(openIndex - 1);
        break;
      case 'Escape':
      case 'Tab':
        closeMenu(event.key === 'Escape');
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="menubar" role="menubar" aria-label="Main menu" ref={barRef}>
      {MENUS.map((menu, menuIndex) => (
        <div className="menubar__menu" role="none" key={menu.label}>
          <button
            type="button"
            className="menubar__trigger"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openIndex === menuIndex}
            ref={(element) => {
              triggerRefs.current[menuIndex] = element;
            }}
            onClick={() => {
              if (openIndex === menuIndex) closeMenu(false);
              else openMenu(menuIndex);
            }}
            onPointerEnter={() => {
              if (openIndex !== null && openIndex !== menuIndex) openMenu(menuIndex);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openMenu(menuIndex);
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = menuIndex + (event.key === 'ArrowRight' ? 1 : -1);
                triggerRefs.current[(next + MENUS.length) % MENUS.length]?.focus();
              }
            }}
          >
            {menu.label}
          </button>
          {openIndex === menuIndex && (
            <div className="menu" role="menu" aria-label={menu.label} onKeyDown={onMenuKeyDown}>
              {menu.items.map((commandId, itemIndex) => {
                if (commandId === null)
                  return (
                    <div
                      className="menu__separator"
                      role="separator"
                      key={`separator-${String(itemIndex)}`}
                    />
                  );
                const command = editor.commands.get(commandId);
                if (!command) return null;
                const enabled = editor.commands.isEnabled(commandId, editor);
                const checkable = command.isChecked !== undefined;
                const checked = editor.commands.isChecked(commandId, editor);
                const chord = editor.shortcuts.chordsFor(commandId)[0];
                const label =
                  commandId === 'edit.undo' && undoLabel
                    ? `Undo ${undoLabel}`
                    : commandId === 'edit.redo' && redoLabel
                      ? `Redo ${redoLabel}`
                      : command.label;
                return (
                  <button
                    type="button"
                    key={commandId}
                    className="menu__item"
                    role={checkable ? 'menuitemradio' : 'menuitem'}
                    aria-checked={checkable ? checked : undefined}
                    disabled={!enabled}
                    ref={(element) => {
                      itemRefs.current[itemIndex] = element;
                    }}
                    onClick={() => {
                      run(commandId);
                    }}
                  >
                    <span className="menu__check" aria-hidden="true">
                      {checked ? '●' : ''}
                    </span>
                    <span className="menu__label">{label}</span>
                    <span className="menu__shortcut">{chord ? formatChord(chord, editor.platform) : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
