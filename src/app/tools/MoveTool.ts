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

import type { EdgeId, FaceId, InstanceId } from '../../kernel/ids';
import { translation } from '../../kernel/math/mat4';
import { add, length, normalize, scale, sub, ZERO, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import {
  copyRepeatedly,
  transformEntities,
  type TransformResult,
  type TransformSelection,
} from '../../kernel/ops/transform';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import { combineExclusions, exclusionForMove, type InferenceExclusion } from '../inference/exclusion';
import type { Inference } from '../inference/inference';
import { refuseLocked } from '../selection/locking';
import { Selection, type EntityRef } from '../selection/Selection';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  MOVE_TOOL_ID,
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  axisForArrowKey,
  canReplace,
  errorMessage,
  formatDistance,
  inferAt,
  markerFor,
  Speculation,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  lineStyleFor,
  modelPoint,
  previewExclusion,
} from './toolSupport';

interface Operation {
  readonly selection: TransformSelection;
  readonly start: Vec3;
  readonly pressX: number;
  readonly pressY: number;
  readonly speculation: Speculation;
  /** The moving geometry, which the destination never snaps to. */
  readonly exclusion: InferenceExclusion;
  offset: Vec3;
  copy: boolean;
  /** Entities produced by the current attempt. */
  result: TransformResult | null;
  dragged: boolean;
  inference: Inference | null;
  error: string | null;
}

interface Finished {
  readonly selection: TransformSelection;
  readonly offset: Vec3;
  readonly copy: boolean;
  readonly record: TransactionRecord;
}

function transformSelectionOf(selection: Selection): TransformSelection {
  return {
    faces: selection.ids('face') as FaceId[],
    edges: selection.ids('edge') as EdgeId[],
    instances: selection.ids('instance') as InstanceId[],
  };
}

function refsOf(result: TransformResult): EntityRef[] {
  return [
    ...result.instances.map((id): EntityRef => ({ kind: 'instance', id })),
    ...result.faces.map((id): EntityRef => ({ kind: 'face', id })),
    ...result.edges.map((id): EntityRef => ({ kind: 'edge', id })),
  ];
}

/**
 * Moves or copies the selection (or the entity under the pointer). Click a start point and an end point, or drag.
 * The toggle key copies. After a copy, typing `3x` makes more copies at the same spacing and `4/` divides the
 * distance into copies. Moving part of connected geometry stretches the faces attached to it.
 */
export class MoveTool implements Tool {
  readonly id = MOVE_TOOL_ID;
  readonly label = 'Move';
  readonly cursor = 'move';

  #operation: Operation | null = null;
  #hover: EntityRef | null = null;
  #current: Inference | null = null;
  #lock: Vec3 | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      this.#current = inferAt(editor, input);
      this.#hover = editor.session.selection.isEmpty ? (editor.pickAt(input)?.ref ?? null) : null;
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX)
      operation.dragged = true;
    operation.copy = toggleModifier(input, editor);
    const preview = previewExclusion(editor, operation.speculation);
    const inference = inferAt(editor, input, {
      anchor: operation.start,
      lockDirection: this.#lock,
      // The moved preview follows the pointer and would catch it. A copy leaves the original in place, where the
      // pointer may snap back to it.
      exclude: operation.copy ? preview : combineExclusions(operation.exclusion, preview),
    });
    operation.inference = inference;
    this.#apply(editor, operation, sub(inference.point, operation.start));
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const operation = this.#operation;
    if (operation) {
      this.#commit(editor, operation);
      return;
    }
    const { session } = editor;
    if (session.selection.isEmpty) {
      const hit = editor.pickAt(input);
      if (!hit) return;
      session.setSelection(Selection.of([hit.ref]));
    }
    if (refuseLocked(editor, session.selection.refs())) return;
    const start = inferAt(editor, input);
    const selection = transformSelectionOf(session.selection);
    this.#operation = {
      selection,
      start: start.point,
      pressX: input.x,
      pressY: input.y,
      speculation: new Speculation(session.doc),
      exclusion: exclusionForMove(session.doc.store(session.activeContext), selection),
      offset: ZERO,
      copy: toggleModifier(input, editor),
      result: null,
      dragged: false,
      inference: start,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
  }

  keyDown(chord: string, editor: Editor): boolean {
    const axis = axisForArrowKey(chord, editor);
    if (axis && this.#operation) {
      this.#lock = this.#lock === axis ? null : axis;
      return true;
    }
    if (chord === 'Escape' && this.#operation) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.#operation?.speculation.rollback();
    this.#operation = null;
    this.#lock = null;
  }

  measurement(editor: Editor): MeasurementField {
    const offset = this.#operation?.offset ?? this.#last?.offset ?? null;
    return {
      label: 'Distance',
      value: offset ? formatDistance(editor, length(offset)) : '',
      accepts: ['length', 'absolutePoint', 'relativePoint', 'copies'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    const operation = this.#operation;
    if (operation) {
      if (intent.kind === 'copies') throw new Error('Finish the copy first, then type the number of copies');
      const offset = this.#offsetFor(intent, operation.start, operation.offset, editor);
      this.#apply(editor, operation, offset);
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }

    const last = this.#last;
    const { session } = editor;
    const doc = session.doc;
    if (!last || !canReplace(doc, last.record)) throw new Error('Pick a start point to move from first');
    if (intent.kind === 'copies' && !last.copy)
      throw new Error('Arrays need a copy: hold the toggle key while moving');
    doc.rollbackLastTransaction();
    this.#last = null;
    const local = toLocalDirection(editor, last.offset);
    let result: TransformResult;
    let offset = last.offset;
    if (intent.kind === 'copies') {
      const step = intent.mode === 'external' ? local : scale(local, 1 / intent.count);
      result = copyRepeatedly(doc, session.activeContext, last.selection, intent.count, (k) =>
        translation(scale(step, k)),
      );
    } else {
      offset = this.#offsetFor(intent, null, last.offset, editor);
      result = transformEntities(
        doc,
        session.activeContext,
        last.selection,
        translation(toLocalDirection(editor, offset)),
        {
          copy: last.copy,
        },
      );
    }
    const record = doc.lastTransaction;
    if (record) this.#last = { selection: last.selection, offset, copy: last.copy, record };
    session.setSelection(Selection.of(refsOf(result)));
  }

  preview(): ToolPreview {
    const operation = this.#operation;
    if (!operation) {
      return { lines: [], highlight: this.#hover ? [this.#hover] : [], marker: markerFor(this.#current) };
    }
    const end = add(operation.start, operation.offset);
    return {
      lines:
        length(operation.offset) > EPS_LEN
          ? [{ a: operation.start, b: end, style: lineStyleFor(operation.inference?.axis) }]
          : [],
      highlight: [],
      marker: markerFor(operation.inference),
    };
  }

  statusHint(editor: Editor): string {
    const operation = this.#operation;
    if (operation?.error) return operation.error;
    const key = toggleModifierName(editor);
    return operation
      ? `Click the destination or type a distance. ${key} copies; arrow keys lock an axis.`
      : `Click a start point to move the selection, or the entity under the pointer. ${key} copies; after a copy type 3x or 3/ for arrays.`;
  }

  #offsetFor(intent: MeasurementIntent, start: Vec3 | null, current: Vec3, editor: Editor): Vec3 {
    switch (intent.kind) {
      case 'length': {
        const direction = this.#lock ?? normalize(current);
        if (!direction) throw new Error('Move the pointer to show the direction to move in');
        return scale(direction, intent.value);
      }
      case 'relativePoint':
        return intent.offset;
      case 'absolutePoint':
        if (!start) throw new Error('Coordinates can only be typed while moving');
        return sub(modelPoint(editor, intent.point), start);
      default:
        throw new Error('Type a distance, coordinates, or a number of copies');
    }
  }

  #apply(editor: Editor, operation: Operation, offset: Vec3): void {
    operation.offset = offset;
    operation.error = null;
    operation.result = null;
    const { session } = editor;
    try {
      if (length(offset) <= EPS_LEN) {
        operation.speculation.rollback();
        return;
      }
      operation.result = operation.speculation.run(() =>
        transformEntities(
          session.doc,
          session.activeContext,
          operation.selection,
          translation(toLocalDirection(editor, offset)),
          {
            copy: operation.copy,
          },
        ),
      );
    } catch (error) {
      operation.error = errorMessage(error);
    }
  }

  #commit(editor: Editor, operation: Operation): void {
    this.#operation = null;
    this.#lock = null;
    if (operation.error !== null) {
      operation.speculation.rollback();
      editor.notify('error', operation.error);
      return;
    }
    const record = operation.speculation.commit();
    if (!record || !operation.result) return;
    this.#last = { selection: operation.selection, offset: operation.offset, copy: operation.copy, record };
    editor.session.setSelection(Selection.of(refsOf(operation.result)));
  }
}
