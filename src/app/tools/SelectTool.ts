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

import type { EdgeId, FaceId, InstanceId, SectionPlaneId } from '../../kernel/ids';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { Editor } from '../Editor';
import { rectFromCorners } from '../selection/boxSelect';
import { connectedGeometry, edgeWithAdjacentFaces, faceWithBoundaryEdges } from '../selection/queries';
import { applySelection, Selection, type EntityRef, type SelectionMode } from '../selection/Selection';
import type { Platform } from '../shortcuts/shortcuts';
import { PRIMARY_BUTTON, SELECT_TOOL_ID, type PointerInput, type Tool, type ToolOverlay } from './Tool';

/** Pointer travel (CSS pixels) before a press becomes a box selection instead of a click. */
export const DRAG_THRESHOLD_PX = 4;

interface Press {
  readonly x: number;
  readonly y: number;
  readonly detail: number;
  readonly mode: SelectionMode;
}

/**
 * Modifier behavior from the reference workflows: the add key (Ctrl, or Option on macOS) adds, Shift toggles,
 * and Shift together with the add key subtracts.
 */
export function selectionModeFor(
  modifiers: Pick<PointerInput, 'shiftKey' | 'ctrlKey' | 'altKey'>,
  platform: Platform,
): SelectionMode {
  const addKey = platform === 'mac' ? modifiers.altKey : modifiers.ctrlKey;
  if (modifiers.shiftKey && addKey) return 'subtract';
  if (modifiers.shiftKey) return 'toggle';
  if (addKey) return 'add';
  return 'replace';
}

/** Single click: the entity. Double: a face with its edges, or an edge with its faces. Triple: all connected. */
export function refsForClick(store: EntityStore, ref: EntityRef, clickCount: number): EntityRef[] {
  if (ref.kind === 'instance' || ref.kind === 'section') return [ref];
  if (clickCount >= 3) return connectedGeometry(store, ref);
  if (clickCount === 2) {
    return ref.kind === 'face'
      ? faceWithBoundaryEdges(store, ref.id as FaceId)
      : edgeWithAdjacentFaces(store, ref.id as EdgeId);
  }
  return [ref];
}

export class SelectTool implements Tool {
  readonly id = SELECT_TOOL_ID;
  readonly label = 'Select';
  readonly cursor = 'default';

  #press: Press | null = null;
  #current = { x: 0, y: 0 };
  #dragging = false;

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    this.#press = {
      x: input.x,
      y: input.y,
      detail: input.detail,
      mode: selectionModeFor(input, editor.platform),
    };
    this.#current = { x: input.x, y: input.y };
    this.#dragging = false;
  }

  pointerMove(input: PointerInput): void {
    const press = this.#press;
    if (!press) return;
    this.#current = { x: input.x, y: input.y };
    if (!this.#dragging && Math.hypot(input.x - press.x, input.y - press.y) > DRAG_THRESHOLD_PX) {
      this.#dragging = true;
    }
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const press = this.#press;
    if (!press || input.button !== PRIMARY_BUTTON) return;
    this.#press = null;
    const { session } = editor;
    if (this.#dragging) {
      this.#dragging = false;
      const mode = this.#current.x >= press.x ? 'window' : 'crossing';
      const refs = editor.boxSelectRefs(rectFromCorners(press, this.#current), mode);
      session.setSelection(applySelection(session.selection, refs, press.mode));
      return;
    }
    const hit = editor.pickAt(press, { includeSectionPlanes: session.showSectionPlanes });
    if (!hit) {
      if (press.mode !== 'replace') return;
      // Clicking outside an open group closes it.
      if (session.editPath.length > 0) editor.closeGroup();
      else session.setSelection(Selection.EMPTY);
      return;
    }
    if (hit.ref.kind === 'section' && press.detail === 2 && press.mode === 'replace') {
      editor.toggleSectionPlaneActive(hit.ref.id as SectionPlaneId);
      return;
    }
    if (hit.ref.kind === 'instance' && press.detail === 2 && press.mode === 'replace') {
      editor.openGroup(hit.ref.id as InstanceId);
      return;
    }
    const refs = refsForClick(session.doc.store(session.activeContext), hit.ref, press.detail);
    session.setSelection(applySelection(session.selection, refs, press.mode));
  }

  keyDown(chord: string, editor: Editor): boolean {
    if (chord !== 'Escape') return false;
    if (this.#press) this.cancel();
    else if (!editor.session.selection.isEmpty) editor.session.setSelection(Selection.EMPTY);
    else editor.closeGroup();
    return true;
  }

  cancel(): void {
    this.#press = null;
    this.#dragging = false;
  }

  overlay(): ToolOverlay | null {
    const press = this.#press;
    if (!press || !this.#dragging) return null;
    return {
      kind: 'selection-rectangle',
      x0: press.x,
      y0: press.y,
      x1: this.#current.x,
      y1: this.#current.y,
      mode: this.#current.x >= press.x ? 'window' : 'crossing',
    };
  }

  statusHint(editor: Editor): string {
    const add = editor.platform === 'mac' ? 'Option' : 'Ctrl';
    const open =
      editor.session.editPath.length > 0
        ? ' Click outside or press Esc to close the group.'
        : ' Double-click a group to edit it.';
    return `Click or drag to select. ${add} adds, Shift toggles, Shift+${add} subtracts. Drag right for window, left for crossing.${open}`;
  }
}
