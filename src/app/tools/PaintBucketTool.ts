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

import type { DefinitionId, FaceId, InstanceId, MaterialId } from '../../kernel/ids';
import { dot } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { setFaceAttributes, setInstanceAttributes } from '../../kernel/model/mutations';
import { connectedFaces, paintSidePatch, sideMaterial, type FaceSide } from '../../kernel/ops/materials';
import { rayThroughScreen } from '../camera/camera';
import type { Editor } from '../Editor';
import { isInstanceLocked, LOCKED_MESSAGE } from '../selection/locking';
import type { EntityRef } from '../selection/Selection';
import { PRIMARY_BUTTON, type PointerInput, type Tool, type ToolPreview } from './Tool';
import { toggleModifier, toggleModifierName, toWorldNormal } from './toolSupport';

export const PAINT_TOOL_ID = 'tool.paint';

/** Which faces one click paints. */
export type PaintScope =
  /** Only the clicked face. */
  | 'face'
  /** Faces connected to it through shared edges that have the same material on that side. */
  | 'connected'
  /** Every face in the open context with the same material on that side. */
  | 'context'
  /** Faces with the same material on that side anywhere in the clicked face's connected geometry. */
  | 'object';

export const DEFAULT_MATERIAL_LABEL = 'Default';

export function paintScopeFor(
  input: Pick<PointerInput, 'shiftKey' | 'ctrlKey' | 'altKey'>,
  editor: Editor,
): PaintScope {
  const toggle = toggleModifier(input, editor);
  if (toggle && input.shiftKey) return 'object';
  if (toggle) return 'connected';
  if (input.shiftKey) return 'context';
  return 'face';
}

/** Sampling: Command on macOS, Alt elsewhere. */
export function isSampleModifier(input: Pick<PointerInput, 'altKey' | 'metaKey'>, editor: Editor): boolean {
  return editor.platform === 'mac' ? input.metaKey : input.altKey;
}

export function sampleModifierName(editor: Editor): string {
  return editor.platform === 'mac' ? 'Command' : 'Alt';
}

/** The faces a paint click on `faceId` changes, sorted by id. */
export function facesToPaint(
  doc: ModelDocument,
  context: DefinitionId,
  faceId: FaceId,
  side: FaceSide,
  scope: PaintScope,
): FaceId[] {
  const store = doc.store(context);
  const face = store.face(faceId);
  if (!face) return [];
  const original = sideMaterial(face.attributes, side);
  const matches = (id: FaceId): boolean => {
    const other = store.face(id);
    return other !== undefined && sideMaterial(other.attributes, side) === original;
  };
  switch (scope) {
    case 'face':
      return [faceId];
    case 'connected':
      return connectedFaces(store, faceId, matches);
    case 'context':
      return [...store.faces()]
        .map((other) => other.id)
        .filter(matches)
        .sort((a, b) => a - b);
    case 'object':
      return connectedFaces(store, faceId).filter(matches);
  }
}

interface Target {
  readonly ref: EntityRef;
  /** For faces: the side that faces the camera. */
  readonly side: FaceSide;
}

/**
 * Paints faces, groups and components with the active material. Click a face to paint the side facing the camera,
 * or a group or component to set the material its default faces show. Shift, the toggle key and both together
 * widen what is painted; the sample key picks up a material instead.
 */
export class PaintBucketTool implements Tool {
  readonly id = PAINT_TOOL_ID;
  readonly label = 'Paint Bucket';
  readonly cursor = 'cell';

  #highlight: EntityRef[] = [];
  #sampling = false;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#sampling = isSampleModifier(input, editor);
    const target = this.#targetAt(input, editor);
    if (!target) {
      this.#highlight = [];
      return;
    }
    if (target.ref.kind === 'face' && !this.#sampling) {
      const { session } = editor;
      const faces = facesToPaint(
        session.doc,
        session.activeContext,
        target.ref.id as FaceId,
        target.side,
        paintScopeFor(input, editor),
      );
      this.#highlight = faces.map((id) => ({ kind: 'face', id }));
    } else {
      this.#highlight = [target.ref];
    }
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const target = this.#targetAt(input, editor);
    if (!target) return;
    if (isSampleModifier(input, editor)) {
      this.#sample(editor, target);
      return;
    }
    const { session } = editor;
    const doc = session.doc;
    const context = session.activeContext;
    const materialId = session.activeMaterialId;
    if (target.ref.kind === 'instance') {
      const instanceId = target.ref.id as InstanceId;
      if (isInstanceLocked(doc, context, instanceId)) {
        editor.notify('error', LOCKED_MESSAGE);
        return;
      }
      doc.transact('Paint', () => {
        setInstanceAttributes(doc, context, instanceId, { materialId });
      });
      return;
    }
    const faces = facesToPaint(
      doc,
      context,
      target.ref.id as FaceId,
      target.side,
      paintScopeFor(input, editor),
    );
    doc.transact('Paint', () => {
      for (const faceId of faces)
        setFaceAttributes(doc, context, faceId, paintSidePatch(target.side, materialId));
    });
  }

  cancel(): void {
    this.#highlight = [];
  }

  deactivate(): void {
    this.#highlight = [];
  }

  preview(): ToolPreview {
    return { lines: [], highlight: this.#highlight, marker: null };
  }

  statusHint(editor: Editor): string {
    const toggle = toggleModifierName(editor);
    const sample = sampleModifierName(editor);
    if (this.#sampling) return 'Click a face, group or component to make its material the active material.';
    const { session } = editor;
    const active =
      session.activeMaterialId === null ? undefined : session.doc.material(session.activeMaterialId);
    const name = active?.name ?? DEFAULT_MATERIAL_LABEL;
    return `Click a face, group or component to paint it with ${name}. Shift: all matching faces here. ${toggle}: matching connected faces. ${toggle}+Shift: matching faces on the same object. ${sample}: sample a material.`;
  }

  #targetAt(input: PointerInput, editor: Editor): Target | null {
    const hit = editor.pickAt(input, { edgeTolerancePx: 0 });
    if (!hit) return null;
    const { session } = editor;
    if (hit.ref.kind === 'instance') return { ref: hit.ref, side: 'front' };
    if (hit.ref.kind !== 'face') return null;
    const face = session.doc.store(session.activeContext).face(hit.ref.id as FaceId);
    if (!face?.plane) return null;
    const ray = rayThroughScreen(session.camera, input, editor.viewportSize);
    const normal = toWorldNormal(editor, face.plane.normal);
    return { ref: hit.ref, side: dot(normal, ray.direction) < 0 ? 'front' : 'back' };
  }

  #sample(editor: Editor, target: Target): void {
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    let materialId: MaterialId | null;
    if (target.ref.kind === 'instance') {
      materialId = store.getInstance(target.ref.id as InstanceId).attributes.materialId;
    } else {
      materialId = sideMaterial(store.getFace(target.ref.id as FaceId).attributes, target.side);
    }
    session.setActiveMaterial(materialId);
  }
}
