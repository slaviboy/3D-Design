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

import { aabbIsEmpty } from '../../kernel/math/aabb';
import { sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import {
  describeClipboard,
  insertedRefs,
  pasteFragment,
  pasteWouldNest,
  NESTED_PASTE_MESSAGE,
  type Clipboard,
} from '../clipboard/clipboard';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { Selection } from '../selection/Selection';
import { boxPreviewLines } from './boxPreview';
import { PRIMARY_BUTTON, SELECT_TOOL_ID, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { inferAt, markerFor, toLocalPoint } from './toolSupport';

export const PASTE_TOOL_ID = 'tool.paste';

const EMPTY_PREVIEW: ToolPreview = { lines: [], highlight: [], marker: null };

/**
 * Pastes the clipboard into the open context. The copied geometry's bounding box follows the inferred cursor point
 * (translation only, with the box's minimum corner at the cursor) and a click drops it. Esc cancels and returns to
 * the Select tool, the same way placing a component works.
 */
export class PasteTool implements Tool {
  readonly id = PASTE_TOOL_ID;
  readonly label = 'Paste';
  readonly cursor = 'copy';

  #clipboard: Clipboard | null = null;
  #inference: Inference | null = null;

  /** What the next click pastes, if anything. */
  get clipboard(): Clipboard | null {
    return this.#clipboard;
  }

  setClipboard(clipboard: Clipboard | null): void {
    this.#clipboard = clipboard;
    this.#inference = null;
  }

  deactivate(): void {
    this.setClipboard(null);
  }

  busy(): boolean {
    return this.#clipboard !== null;
  }

  aims(): boolean {
    return this.#clipboard !== null;
  }

  cancel(): void {
    this.#inference = null;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#inference = this.#clipboard === null ? null : inferAt(editor, input);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const clipboard = this.#clipboard;
    const { session } = editor;
    if (clipboard?.doc !== session.doc) {
      editor.activateTool(SELECT_TOOL_ID);
      return;
    }
    if (pasteWouldNest(session.doc, session.activeContext, clipboard)) {
      editor.notify('error', NESTED_PASTE_MESSAGE);
      editor.activateTool(SELECT_TOOL_ID);
      return;
    }
    const offset = this.#offset(editor, clipboard, inferAt(editor, input).point);
    const inserted = pasteFragment(session.doc, session.activeContext, clipboard, offset);
    session.setSelection(Selection.of(insertedRefs(inserted)));
    editor.activateTool(SELECT_TOOL_ID);
  }

  keyDown(chord: string, editor: Editor): boolean {
    if (chord !== 'Escape') return false;
    editor.activateTool(SELECT_TOOL_ID);
    return true;
  }

  preview(editor: Editor): ToolPreview {
    const clipboard = this.#clipboard;
    const inference = this.#inference;
    if (!clipboard || !inference) return EMPTY_PREVIEW;
    const marker = markerFor(inference);
    if (aabbIsEmpty(clipboard.bounds)) return { lines: [], highlight: [], marker };
    const offset = this.#offset(editor, clipboard, inference.point);
    const lines = boxPreviewLines(clipboard.bounds, offset, editor.session.activeContextTransform);
    return { lines, highlight: [], marker };
  }

  statusHint(): string {
    const clipboard = this.#clipboard;
    return clipboard
      ? `Click to paste ${describeClipboard(clipboard.counts)}. Esc cancels.`
      : 'Copy something first, then click to paste it.';
  }

  /** Translation (in active-context coordinates) that puts the clipboard's minimum corner at the world point. */
  #offset(editor: Editor, clipboard: Clipboard, worldPoint: Vec3): Vec3 {
    const local = toLocalPoint(editor, worldPoint);
    const { bounds } = clipboard;
    return aabbIsEmpty(bounds) ? local : sub(local, vec3(bounds.minX, bounds.minY, bounds.minZ));
  }
}
