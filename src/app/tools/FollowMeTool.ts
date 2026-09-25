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

import type { EdgeId, FaceId } from '../../kernel/ids';
import { followMe } from '../../kernel/ops/followMe';
import type { Editor } from '../Editor';
import type { EntityRef } from '../selection/Selection';
import { Selection } from '../selection/Selection';
import { PRIMARY_BUTTON, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { errorMessage } from './toolSupport';

export const FOLLOW_ME_TOOL_ID = 'tool.followMe';

interface Drag {
  readonly profile: FaceId;
  readonly edges: EdgeId[];
}

/**
 * Sweeps a profile face along a path of edges. Either select the path first and click the profile face, or press on
 * the profile face and drag along the path edges, releasing at the end of the path.
 */
export class FollowMeTool implements Tool {
  readonly id = FOLLOW_ME_TOOL_ID;
  readonly label = 'Follow Me';
  readonly cursor = 'crosshair';

  #path: EdgeId[] = [];
  #hover: FaceId | null = null;
  #drag: Drag | null = null;

  activate(editor: Editor): void {
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    const edges = session.selection.ids('edge') as EdgeId[];
    const faces = session.selection.ids('face') as FaceId[];
    // A selected face alone stands for the path around its outline.
    this.#path =
      edges.length > 0
        ? edges
        : faces.flatMap((faceId) => (store.face(faceId)?.outer ?? []).map((use) => use.edge));
    this.#drag = null;
  }

  deactivate(): void {
    this.#path = [];
    this.#drag = null;
    this.#hover = null;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    const drag = this.#drag;
    if (!drag) {
      this.#hover = this.#faceAt(input, editor);
      return;
    }
    const hit = editor.pickAt(input);
    if (hit?.ref.kind !== 'edge') return;
    const edgeId = hit.ref.id as EdgeId;
    const store = editor.session.doc.store(editor.session.activeContext);
    if (drag.edges.includes(edgeId) || store.faceEdges(drag.profile).includes(edgeId)) return;
    const edge = store.getEdge(edgeId);
    const connected =
      drag.edges.length === 0 ||
      drag.edges.some((other) => {
        const view = store.getEdge(other);
        return [view.v0, view.v1].some((vertex) => vertex === edge.v0 || vertex === edge.v1);
      });
    if (connected) drag.edges.push(edgeId);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const face = this.#faceAt(input, editor);
    if (face === null) return;
    if (this.#path.length > 0) {
      this.#sweep(editor, face, this.#path);
      return;
    }
    this.#drag = { profile: face, edges: [] };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const drag = this.#drag;
    if (!drag || input.button !== PRIMARY_BUTTON) return;
    this.#drag = null;
    if (drag.edges.length > 0) this.#sweep(editor, drag.profile, drag.edges);
  }

  busy(): boolean {
    return this.#drag !== null;
  }

  aims(): boolean {
    return this.#path.length > 0 && this.#drag === null;
  }

  cancel(): void {
    this.#drag = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#drag) {
      this.#drag = null;
      return true;
    }
    return false;
  }

  preview(): ToolPreview {
    const highlight: EntityRef[] = [
      ...(this.#drag?.edges ?? this.#path).map((id): EntityRef => ({ kind: 'edge', id })),
      ...(this.#drag ? [{ kind: 'face' as const, id: this.#drag.profile }] : []),
      ...(this.#hover !== null && !this.#drag ? [{ kind: 'face' as const, id: this.#hover }] : []),
    ];
    return { lines: [], highlight, marker: null };
  }

  statusHint(): string {
    if (this.#drag) return 'Drag along the path edges, then release to sweep the profile.';
    if (this.#path.length > 0) return 'Click the profile face to sweep it along the selected path.';
    return 'Press on a profile face and drag along the path edges, or select a path first and then click a face.';
  }

  #faceAt(input: PointerInput, editor: Editor): FaceId | null {
    const hit = editor.pickAt(input, { edgeTolerancePx: 0 });
    return hit?.ref.kind === 'face' ? (hit.ref.id as FaceId) : null;
  }

  #sweep(editor: Editor, profile: FaceId, path: readonly EdgeId[]): void {
    const { session } = editor;
    try {
      const result = followMe(session.doc, session.activeContext, profile, path);
      this.#path = [];
      this.#hover = null;
      session.setSelection(Selection.of(result.faces.map((id) => ({ kind: 'face' as const, id }))));
    } catch (error) {
      editor.notify('error', errorMessage(error));
    }
  }
}
