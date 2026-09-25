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

import type { EdgeId, InstanceId } from '../../kernel/ids';
import { eraseEdges } from '../../kernel/ops/erase';
import { deleteInstances } from '../../kernel/ops/hierarchy';
import { setEdgeAttributes, setInstanceAttributes } from '../../kernel/model/mutations';
import type { Editor } from '../Editor';
import { refuseLocked } from '../selection/locking';
import type { EntityRef } from '../selection/Selection';
import { ERASER_TOOL_ID, PRIMARY_BUTTON, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { toggleModifier, toggleModifierName } from './toolSupport';

export type EraseMode = 'erase' | 'hide' | 'soften' | 'unsoften';

const LABELS: Readonly<Record<EraseMode, string>> = {
  erase: 'Erase',
  hide: 'Hide',
  soften: 'Soften',
  unsoften: 'Unsoften',
};

export function eraseModeFor(
  input: Pick<PointerInput, 'shiftKey' | 'ctrlKey' | 'altKey'>,
  editor: Editor,
): EraseMode {
  const toggle = toggleModifier(input, editor);
  if (toggle && input.shiftKey) return 'unsoften';
  if (toggle) return 'soften';
  if (input.shiftKey) return 'hide';
  return 'erase';
}

const keyOf = (ref: EntityRef): string => `${ref.kind}:${String(ref.id)}`;

/**
 * Click or drag over edges, groups and components. When the button is released, marked edges are erased (healing
 * coplanar faces), hidden (Shift), softened (the toggle key) or unsoftened (toggle key and Shift).
 */
export class EraserTool implements Tool {
  readonly id = ERASER_TOOL_ID;
  readonly label = 'Eraser';
  readonly cursor = 'cell';

  #pressed = false;
  #mode: EraseMode = 'erase';
  #marked = new Map<string, EntityRef>();
  #hover: EntityRef | null = null;

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    this.#pressed = true;
    this.#mode = eraseModeFor(input, editor);
    this.#marked.clear();
    this.#markAt(input, editor);
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    if (this.#pressed) {
      this.#markAt(input, editor);
    } else {
      this.#hover = this.#pick(input, editor, eraseModeFor(input, editor));
    }
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    if (!this.#pressed || input.button !== PRIMARY_BUTTON) return;
    this.#pressed = false;
    const refs = [...this.#marked.values()];
    this.#marked.clear();
    if (refs.length > 0) this.#apply(editor, refs);
  }

  busy(): boolean {
    return this.#pressed;
  }

  cancel(): void {
    this.#pressed = false;
    this.#marked.clear();
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#pressed) {
      this.cancel();
      return true;
    }
    return false;
  }

  preview(): ToolPreview {
    const highlight = [...this.#marked.values()];
    if (!this.#pressed && this.#hover) highlight.push(this.#hover);
    return { lines: [], highlight, marker: null };
  }

  statusHint(editor: Editor): string {
    const key = toggleModifierName(editor);
    return `Click or drag over edges to erase them. Shift hides, ${key} softens, ${key}+Shift unsoftens.`;
  }

  #pick(input: PointerInput, editor: Editor, mode: EraseMode): EntityRef | null {
    const hit = editor.pickAt(input, { includeSoftEdges: mode === 'unsoften' });
    if (!hit || hit.ref.kind === 'face') return null;
    if (hit.ref.kind === 'instance' && mode !== 'erase' && mode !== 'hide') return null;
    return hit.ref;
  }

  #markAt(input: PointerInput, editor: Editor): void {
    const ref = this.#pick(input, editor, this.#mode);
    if (ref) this.#marked.set(keyOf(ref), ref);
  }

  #apply(editor: Editor, refs: readonly EntityRef[]): void {
    if (refuseLocked(editor, refs)) return;
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    const edges = refs.filter((ref) => ref.kind === 'edge').map((ref) => ref.id as EdgeId);
    const instances = refs.filter((ref) => ref.kind === 'instance').map((ref) => ref.id as InstanceId);
    doc.transact(LABELS[this.#mode], () => {
      switch (this.#mode) {
        case 'erase':
          deleteInstances(doc, context, instances);
          eraseEdges(doc, context, edges);
          break;
        case 'hide':
          for (const id of instances) setInstanceAttributes(doc, context, id, { hidden: true });
          for (const id of edges) setEdgeAttributes(doc, context, id, { hidden: true });
          break;
        case 'soften':
        case 'unsoften': {
          const soft = this.#mode === 'soften';
          for (const id of edges) setEdgeAttributes(doc, context, id, { soft, smooth: soft });
          break;
        }
      }
    });
  }
}
