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

import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from 'zustand';
import { formatChord } from '../../app/shortcuts/shortcuts';
import {
  TOOLBAR_SEPARATOR,
  type ToolbarId,
  type ToolbarLayout,
  type ToolbarSlot,
} from '../../app/toolbars/toolbarLayout';
import type { Editor } from '../../app/Editor';
import { useEditor, useEditorState } from '../EditorContext';
import { Icon } from '../icons/Icon';
import { arrangeStore, startArranging, stopArranging } from './arrangeStore';

/** Holding a button this long starts arranging the toolbars. */
const HOLD_MS = 500;
/** A pointer that travels further than this before the hold ends is not holding still. */
const HOLD_SLOP_PX = 8;

const BAR_NAMES: Readonly<Record<ToolbarId, string>> = { main: 'the toolbar', palette: 'the tool palette' };

const sameSlot = (a: ToolbarSlot | null, b: ToolbarSlot | null): boolean =>
  a !== null && b !== null && a.bar === b.bar && a.index === b.index;

function labelOf(editor: Editor, layout: ToolbarLayout, slot: ToolbarSlot): string {
  const item = layout[slot.bar][slot.index];
  if (item === undefined) return 'The button';
  return item === TOOLBAR_SEPARATOR ? 'The separator' : (editor.commands.get(item)?.label ?? item);
}

/** Where a pointer at (x, y) would drop a button: before the button under it, or at the end of the bar under it. */
function dropTargetAt(x: number, y: number, layout: ToolbarLayout): ToolbarSlot | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;
    const slot = element.closest<HTMLElement>('[data-toolbar-slot]');
    if (slot) {
      const bar = slot.dataset.toolbarBar as ToolbarId;
      const index = Number(slot.dataset.toolbarSlot);
      const rect = slot.getBoundingClientRect();
      const after = bar === 'main' ? x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2;
      return { bar, index: after ? index + 1 : index };
    }
    const bar = element.closest<HTMLElement>('[data-toolbar-bar]');
    if (bar) {
      const id = bar.dataset.toolbarBar as ToolbarId;
      return { bar: id, index: layout[id].length };
    }
  }
  return null;
}

/** Puts focus back on a button after it moved (its element may have been replaced). */
function focusButton(commandId: string): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-command-id="${CSS.escape(commandId)}"]`)?.focus();
  });
}

/**
 * A button of either bar. Pressing and holding it starts arranging the toolbars; while arranging, buttons don't
 * run their commands: they are dragged to new places, or picked up by a tap and put down by the next.
 */
function ToolbarItem({
  item,
  slot,
  instructionsId,
}: {
  readonly item: string;
  readonly slot: ToolbarSlot;
  readonly instructionsId: string;
}) {
  const editor = useEditor();
  useEditorState(
    (state) =>
      `${String(state.revision)}|${String(state.selectionVersion)}|${state.activeToolId}|${String(state.shortcutsVersion)}|${String(state.preferences.toolTips)}`,
  );
  const layout = useEditorState((state) => state.toolbarLayout);
  const arranging = useStore(arrangeStore, (state) => state.arranging);
  const dragging = useStore(arrangeStore, (state) => state.dragging);
  const picked = useStore(arrangeStore, (state) => state.picked);
  const target = useStore(arrangeStore, (state) => state.target);
  const holdRef = useRef<{ readonly timer: number; readonly x: number; readonly y: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(
    () => () => {
      if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    },
    [],
  );

  const drop = target && sameSlot(target, slot) ? 'before' : undefined;
  const common = {
    'data-toolbar-slot': slot.index,
    'data-toolbar-bar': slot.bar,
    'data-drop': drop,
    'data-moving': sameSlot(dragging, slot) || sameSlot(picked, slot) ? 'true' : undefined,
  };

  const endHold = () => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  };

  const beginDrag = (element: HTMLElement, pointerId: number) => {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Without capture, moves over other elements still reach the document handlers below.
    }
    arrangeStore.setState({ dragging: slot, target: null });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    if (arrangeStore.getState().arranging) {
      event.preventDefault();
      beginDrag(element, event.pointerId);
      return;
    }
    const { pointerId, clientX, clientY } = event;
    holdRef.current = {
      x: clientX,
      y: clientY,
      timer: window.setTimeout(() => {
        holdRef.current = null;
        // The click that ends this press must not run the command.
        suppressClickRef.current = true;
        startArranging(
          'Arranging the toolbars. Drag buttons to move them, or use the arrow keys, and M to move a button to the other bar.',
        );
        beginDrag(element, pointerId);
      }, HOLD_MS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const hold = holdRef.current;
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP_PX) endHold();
    if (!sameSlot(arrangeStore.getState().dragging, slot)) return;
    arrangeStore.setState({ target: dropTargetAt(event.clientX, event.clientY, layout) });
  };

  const onPointerUp = () => {
    endHold();
    const state = arrangeStore.getState();
    if (!state.arranging || !sameSlot(state.dragging, slot)) return;
    const destination = state.target;
    // Dropping a button just before or after itself leaves it where it is: that was a tap.
    const moved =
      destination !== null &&
      !sameSlot(destination, slot) &&
      !sameSlot(destination, { ...slot, index: slot.index + 1 });
    if (destination !== null && moved) {
      const name = labelOf(editor, layout, slot);
      editor.moveToolbarItem(slot, destination);
      arrangeStore.setState({
        dragging: null,
        target: null,
        picked: null,
        announcement: `${name} moved to ${BAR_NAMES[destination.bar]}`,
      });
      return;
    }
    // A tap picks a button up, puts the one picked up down just before it, or puts back the one it picked.
    const { picked: held } = state;
    if (held && !sameSlot(held, slot)) {
      const name = labelOf(editor, layout, held);
      editor.moveToolbarItem(held, slot);
      arrangeStore.setState({
        dragging: null,
        target: null,
        picked: null,
        announcement: `${name} moved to ${BAR_NAMES[slot.bar]}`,
      });
      return;
    }
    arrangeStore.setState({
      dragging: null,
      target: null,
      picked: held ? null : slot,
      announcement: held
        ? `${labelOf(editor, layout, slot)} put back`
        : `${labelOf(editor, layout, slot)} picked up. Tap where it should go.`,
    });
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!arrangeStore.getState().arranging && item !== TOOLBAR_SEPARATOR) void editor.runCommand(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!arrangeStore.getState().arranging) return;
    const earlier = slot.bar === 'main' ? 'ArrowLeft' : 'ArrowUp';
    const later = slot.bar === 'main' ? 'ArrowRight' : 'ArrowDown';
    const name = labelOf(editor, layout, slot);
    if (event.key === earlier || event.key === later) {
      editor.nudgeToolbarItem(slot, event.key === earlier ? -1 : 1);
      arrangeStore.setState({ announcement: `${name} moved ${event.key === earlier ? 'earlier' : 'later'}` });
    } else if (event.key === 'm' || event.key === 'M') {
      editor.moveToolbarItemToOtherBar(slot);
      arrangeStore.setState({
        announcement: `${name} moved to ${BAR_NAMES[slot.bar === 'main' ? 'palette' : 'main']}`,
      });
    } else if (event.key === 'Escape') {
      stopArranging();
    } else if (event.key === 'Enter' || event.key === ' ') {
      // Buttons don't run commands while arranging.
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (item !== TOOLBAR_SEPARATOR) focusButton(item);
  };

  if (item === TOOLBAR_SEPARATOR) {
    return (
      <span
        className="toolbar__separator"
        role="separator"
        {...common}
        onPointerDown={arranging ? onPointerDown : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    );
  }

  const command = editor.commands.get(item);
  if (!command) return null;
  const chord = editor.shortcuts.chordsFor(item)[0];
  const title = chord ? `${command.label} (${formatChord(chord, editor.platform)})` : command.label;
  const enabled = editor.commands.isEnabled(item, editor);
  const tooltips = editor.preferences.toolTips && !arranging;
  return (
    <button
      type="button"
      className="toolbar__button"
      aria-label={command.label}
      data-command-id={item}
      data-tooltip={arranging ? undefined : title}
      // With tool tips on, the layer shows this text; with them off, the browser's own tooltip does.
      title={tooltips || arranging ? undefined : title}
      aria-pressed={command.isChecked !== undefined ? editor.commands.isChecked(item, editor) : undefined}
      // While arranging, every button can be moved, including those that can't run now; the description says so.
      disabled={!arranging && !enabled}
      aria-describedby={arranging ? instructionsId : undefined}
      {...common}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endHold}
      onPointerLeave={() => {
        if (arrangeStore.getState().dragging === null) endHold();
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Icon commandId={item} />
    </button>
  );
}

function Bar({ bar }: { readonly bar: ToolbarId }) {
  const layout = useEditorState((state) => state.toolbarLayout);
  const arranging = useStore(arrangeStore, (state) => state.arranging);
  const target = useStore(arrangeStore, (state) => state.target);
  const instructionsId = useId();
  const items = layout[bar];
  const main = bar === 'main';
  return (
    <div
      className={main ? 'toolbar' : 'tool-palette'}
      role="toolbar"
      aria-label={main ? 'Main toolbar' : 'Tools'}
      aria-orientation={main ? undefined : 'vertical'}
      data-toolbar-bar={bar}
      data-arranging={arranging ? 'true' : undefined}
      data-drop-end={target?.bar === bar && target.index >= items.length ? 'true' : undefined}
    >
      {items.map((item, index) => (
        <ToolbarItem
          // Separators repeat, so their position keys them; buttons keep their element as they move.
          key={item === TOOLBAR_SEPARATOR ? `separator-${String(index)}` : item}
          item={item}
          slot={{ bar, index }}
          instructionsId={instructionsId}
        />
      ))}
      <span id={instructionsId} className="visually-hidden">
        Arranging: the arrow keys move this button, M moves it to the other bar, and Escape finishes.
      </span>
    </div>
  );
}

export function Toolbar() {
  const editor = useEditor();
  const arranging = useStore(arrangeStore, (state) => state.arranging);
  const announcement = useStore(arrangeStore, (state) => state.announcement);
  const requests = useEditorState((state) => state.arrangeToolbarRequests);

  // Window > Arrange Toolbars starts arranging from the keyboard, on the first tool.
  useEffect(() => {
    if (requests === 0) return;
    startArranging(
      'Arranging the toolbars. The arrow keys move a button, M moves it to the other bar, and Escape finishes.',
    );
    const first = editor.toolbarLayout.palette.find((item) => item !== TOOLBAR_SEPARATOR);
    if (first) focusButton(first);
  }, [requests, editor]);

  // A press anywhere outside the bars finishes arranging.
  useEffect(() => {
    if (!arranging) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest('[data-toolbar-bar], .toolbar__done')) stopArranging();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [arranging]);

  return (
    <div className="toolbar-row">
      <Bar bar="main" />
      {arranging && (
        <button type="button" className="button button--primary toolbar__done" onClick={stopArranging}>
          Done
        </button>
      )}
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

export function ToolPalette() {
  return <Bar bar="palette" />;
}
