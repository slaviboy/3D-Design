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

import type { FaceId } from '../../kernel/ids';
import { dot, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { pushPull, pushPullLimit } from '../../kernel/ops/pushPull';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import { rayThroughScreen } from '../camera/camera';
import type { Editor } from '../Editor';
import { combineExclusions, exclusionForBoundary, type InferenceExclusion } from '../inference/exclusion';
import { closestPointOnLineToRay, type Inference } from '../inference/inference';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  PRIMARY_BUTTON,
  PUSH_PULL_TOOL_ID,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  canReplace,
  errorMessage,
  formatDistance,
  inferAt,
  markerFor,
  POINT_INFERENCE_KINDS,
  previewExclusion,
  Speculation,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  toWorldNormal,
} from './toolSupport';

interface Operation {
  readonly face: FaceId;
  /** World point where the face was picked. */
  readonly origin: Vec3;
  /** World unit normal of the face. */
  readonly normal: Vec3;
  readonly pressX: number;
  readonly pressY: number;
  readonly speculation: Speculation;
  /** The face's own outline, which the distance never snaps to. */
  readonly exclusion: InferenceExclusion;
  /** How far the face can be pushed in (world units) before it reaches the far side of the shape, if it can. */
  readonly limit: number | null;
  /** World distance along the normal. */
  distance: number;
  /** The pointer is past the far side, and the push stops there. */
  limited: boolean;
  /** The same distance in active-context units, as passed to the kernel. */
  localDistance: number;
  keepOriginal: boolean;
  dragged: boolean;
  inference: Inference | null;
  error: string | null;
}

interface Finished {
  readonly face: FaceId;
  readonly normal: Vec3;
  /** Distance along the face normal in active-context units, reused by double-click. */
  readonly localDistance: number;
  readonly worldDistance: number;
  readonly keepOriginal: boolean;
  readonly record: TransactionRecord | undefined;
  /** The operation's {@link Operation.limit}, for typed values that replace it. */
  readonly limit: number | null;
}

/**
 * Extrudes or moves a face along its normal. Click a face, move, and click again (or drag and release). Typing a
 * distance finishes the operation, and typing again right after replaces it. Double-clicking a face repeats the last
 * distance.
 */
export class PushPullTool implements Tool {
  readonly id = PUSH_PULL_TOOL_ID;
  readonly label = 'Push/Pull';
  readonly cursor = 'ns-resize';

  #hover: FaceId | null = null;
  #operation: Operation | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      this.#hover = this.#faceAt(input, editor);
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX)
      operation.dragged = true;
    operation.keepOriginal = toggleModifier(input, editor);
    operation.inference = inferAt(editor, input, {
      // The extrusion follows the pointer and would catch it; it still hides what lies behind it.
      exclude: combineExclusions(
        operation.exclusion,
        previewExclusion(editor, operation.speculation, { faceTargets: false }),
      ),
    });
    const snapped = POINT_INFERENCE_KINDS.has(operation.inference.kind)
      ? operation.inference.point
      : closestPointOnLineToRay(
          operation.origin,
          operation.normal,
          rayThroughScreen(editor.session.camera, input, editor.viewportSize),
        );
    this.#apply(editor, operation, dot(sub(snapped, operation.origin), operation.normal));
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const operation = this.#operation;
    if (operation) {
      if (input.detail >= 2 && Math.abs(operation.distance) <= EPS_LEN) {
        this.cancel();
        this.#repeat(input, editor);
        return;
      }
      this.#commit(editor, operation);
      return;
    }
    const face = this.#faceAt(input, editor);
    if (face === null) return;
    const hit = editor.pickAt(input);
    const store = editor.session.doc.store(editor.session.activeContext);
    const plane = store.getFacePlane(face);
    const normal = toWorldNormal(editor, plane.normal);
    this.#operation = {
      face,
      origin: hit?.point ?? editor.session.camera.target,
      normal,
      pressX: input.x,
      pressY: input.y,
      speculation: new Speculation(editor.session.doc),
      exclusion: exclusionForBoundary(store, { faces: [face] }),
      limit: this.#limit(editor, face, normal),
      limited: false,
      distance: 0,
      localDistance: 0,
      keepOriginal: toggleModifier(input, editor),
      dragged: false,
      inference: null,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
  }

  busy(): boolean {
    return this.#operation !== null;
  }

  cancel(): void {
    this.#operation?.speculation.rollback();
    this.#operation = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#operation) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const operation = this.#operation;
    const distance = operation ? operation.distance : (this.#last?.worldDistance ?? null);
    return {
      label: 'Distance',
      value: distance === null ? '' : formatDistance(editor, Math.abs(distance)),
      accepts: ['length'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind !== 'length') return;
    const operation = this.#operation;
    if (operation) {
      const sign =
        Math.abs(operation.distance) > EPS_LEN
          ? Math.sign(operation.distance)
          : this.#towardCamera(editor, operation.origin, operation.normal);
      this.#refusePastFarSide(editor, operation.limit, sign * intent.value);
      this.#apply(editor, operation, sign * intent.value);
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record)) throw new Error('Click a face to push or pull first');
    const worldDistance = Math.sign(last.worldDistance) * intent.value;
    this.#refusePastFarSide(editor, last.limit, worldDistance);
    doc.rollbackLastTransaction();
    const localDistance = this.#localDistance(editor, last.normal, worldDistance, last.face);
    try {
      pushPull(doc, editor.session.activeContext, last.face, localDistance, {
        createNewStartFace: last.keepOriginal,
      });
    } catch (error) {
      this.#last = null;
      throw error;
    }
    this.#last = { ...last, localDistance, worldDistance, record: doc.lastTransaction };
  }

  preview(): ToolPreview {
    const operation = this.#operation;
    if (operation) return { lines: [], highlight: [], marker: markerFor(operation.inference) };
    return {
      lines: [],
      highlight: this.#hover === null ? [] : [{ kind: 'face', id: this.#hover }],
      marker: null,
    };
  }

  statusHint(editor: Editor): string {
    const operation = this.#operation;
    if (operation?.error) return operation.error;
    if (operation?.limited) {
      return `Offset limited to ${formatDistance(editor, Math.abs(operation.distance))}: this is the far side. Click to cut through.`;
    }
    return operation
      ? `Move to set the distance, then click, or type a distance. ${toggleModifierName(editor)} keeps the starting face.`
      : 'Click a face to push or pull it. Double-click a face to repeat the last distance.';
  }

  #faceAt(input: PointerInput, editor: Editor): FaceId | null {
    const hit = editor.pickAt(input, { edgeTolerancePx: 0 });
    return hit?.ref.kind === 'face' ? (hit.ref.id as FaceId) : null;
  }

  /** A typed push deeper than the shape: say how far it can go, rather than stopping short of what was asked. */
  #refusePastFarSide(editor: Editor, limit: number | null, worldDistance: number): void {
    if (limit !== null && -worldDistance > limit + EPS_LEN) {
      throw new Error(`Push/Pull stops at the face on the other side, ${formatDistance(editor, limit)} away`);
    }
  }

  #towardCamera(editor: Editor, point: Vec3, normal: Vec3): number {
    return dot(normal, sub(editor.session.camera.eye, point)) >= 0 ? 1 : -1;
  }

  /** {@link pushPullLimit} in world units: the group or component being edited may scale distances along the normal. */
  #limit(editor: Editor, face: FaceId, worldNormal: Vec3): number | null {
    const local = pushPullLimit(editor.session.doc.store(editor.session.activeContext), face);
    return local === null ? null : local / this.#localDistance(editor, worldNormal, 1, face);
  }

  #localDistance(editor: Editor, worldNormal: Vec3, worldDistance: number, face: FaceId): number {
    const localNormal = editor.session.doc.store(editor.session.activeContext).getFacePlane(face).normal;
    return dot(toLocalDirection(editor, scale(worldNormal, worldDistance)), localNormal);
  }

  #apply(editor: Editor, operation: Operation, requested: number): void {
    // At or past the far side, the face stays there, where it cuts through.
    const { limit } = operation;
    operation.limited = limit !== null && -requested >= limit - EPS_LEN;
    const worldDistance = limit !== null && operation.limited ? -limit : requested;
    operation.distance = worldDistance;
    operation.error = null;
    const { session } = editor;
    try {
      if (Math.abs(worldDistance) <= EPS_LEN) {
        operation.speculation.rollback();
        return;
      }
      operation.speculation.run(() => {
        operation.localDistance = this.#localDistance(
          editor,
          operation.normal,
          worldDistance,
          operation.face,
        );
        pushPull(session.doc, session.activeContext, operation.face, operation.localDistance, {
          createNewStartFace: operation.keepOriginal,
        });
      });
    } catch (error) {
      operation.error = errorMessage(error);
    }
  }

  #commit(editor: Editor, operation: Operation): void {
    this.#operation = null;
    if (operation.error !== null) {
      operation.speculation.rollback();
      editor.notify('error', operation.error);
      return;
    }
    const record = operation.speculation.commit();
    if (!record) return;
    this.#last = {
      face: operation.face,
      normal: operation.normal,
      localDistance: operation.localDistance,
      worldDistance: operation.distance,
      keepOriginal: operation.keepOriginal,
      record,
      limit: operation.limit,
    };
  }

  #repeat(input: PointerInput, editor: Editor): void {
    const last = this.#last;
    const face = this.#faceAt(input, editor);
    if (!last || face === null) return;
    const { session } = editor;
    const plane = session.doc.store(session.activeContext).getFacePlane(face);
    const normal = toWorldNormal(editor, plane.normal);
    // Measured before the push changes the face.
    const limit = this.#limit(editor, face, normal);
    try {
      pushPull(session.doc, session.activeContext, face, last.localDistance, {
        createNewStartFace: last.keepOriginal,
      });
      this.#last = {
        face,
        normal,
        localDistance: last.localDistance,
        worldDistance: last.worldDistance,
        keepOriginal: last.keepOriginal,
        record: session.doc.lastTransaction,
        limit,
      };
    } catch (error) {
      editor.notify('error', errorMessage(error));
    }
  }
}
