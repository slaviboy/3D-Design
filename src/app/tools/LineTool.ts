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

import { add, distance, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  LINE_TOOL_ID,
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  axisForArrowKey,
  formatDistance,
  inferAt,
  markerFor,
  toLocalPoint,
  lineStyleFor,
  modelPoint,
} from './toolSupport';

/**
 * Draws connected edges. Each click adds a segment as its own undo step; the chain ends when a segment closes a
 * face, returns to the chain's start, or on Escape.
 */
export class LineTool implements Tool {
  readonly id = LINE_TOOL_ID;
  readonly label = 'Line';
  readonly cursor = 'crosshair';

  #start: Vec3 | null = null;
  #chainStart: Vec3 | null = null;
  #current: Inference | null = null;
  #lock: Vec3 | null = null;
  #shiftLock = false;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#updateShiftLock(input);
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    if (!this.#start) {
      this.#start = inference.point;
      this.#chainStart = inference.point;
      return;
    }
    this.#addSegment(editor, inference.point);
  }

  keyDown(chord: string, editor: Editor): boolean {
    const axis = axisForArrowKey(chord, editor);
    if (axis && this.#start) {
      this.#lock = this.#lock === axis ? null : axis;
      this.#shiftLock = false;
      return true;
    }
    if (chord === 'Escape' && this.#start) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.#start = null;
    this.#chainStart = null;
    this.#lock = null;
    this.#shiftLock = false;
  }

  measurement(editor: Editor): MeasurementField {
    const start = this.#start;
    const current = this.#current;
    return {
      label: 'Length',
      value: start && current ? formatDistance(editor, distance(start, current.point)) : '',
      accepts: ['length', 'absolutePoint', 'relativePoint'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    const start = this.#start;
    if (intent.kind === 'absolutePoint') {
      if (start) this.#addSegment(editor, modelPoint(editor, intent.point));
      else this.#start = this.#chainStart = modelPoint(editor, intent.point);
      return;
    }
    if (!start) throw new Error('Click to start the line first');
    if (intent.kind === 'relativePoint') {
      this.#addSegment(editor, add(start, intent.offset));
    } else if (intent.kind === 'length') {
      const direction = this.#lock ?? (this.#current ? normalize(sub(this.#current.point, start)) : null);
      if (!direction) throw new Error('Move the pointer to show the direction of the line');
      this.#addSegment(editor, add(start, scale(direction, intent.value)));
    }
  }

  preview(): ToolPreview {
    const start = this.#start;
    const current = this.#current;
    return {
      lines: start && current ? [{ a: start, b: current.point, style: lineStyleFor(current.axis) }] : [],
      highlight: [],
      marker: markerFor(current),
    };
  }

  statusHint(): string {
    return this.#start
      ? 'Click the end point or type a length. Arrow keys lock an axis, Shift locks the current direction, Esc ends the line.'
      : 'Click to set the start point of the line.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    return inferAt(editor, input, {
      ...(this.#start ? { anchor: this.#start } : {}),
      lockDirection: this.#lock,
    });
  }

  #updateShiftLock(input: PointerInput): void {
    const start = this.#start;
    if (!start) return;
    if (input.shiftKey && !this.#lock && this.#current) {
      const direction = normalize(sub(this.#current.point, start));
      if (direction && this.#current.kind !== 'free') {
        this.#lock = direction;
        this.#shiftLock = true;
      }
    } else if (!input.shiftKey && this.#shiftLock) {
      this.#lock = null;
      this.#shiftLock = false;
    }
  }

  #addSegment(editor: Editor, end: Vec3): void {
    const start = this.#start;
    if (!start || distance(start, end) <= EPS_LEN) return;
    const { session } = editor;
    const result = insertSegments(
      session.doc,
      session.activeContext,
      [{ a: toLocalPoint(editor, start), b: toLocalPoint(editor, end) }],
      { autoFace: true },
    );
    const closed = this.#chainStart !== null && distance(this.#chainStart, end) <= EPS_LEN;
    if (closed || result.createdFaces.length > 0) {
      this.cancel();
    } else {
      this.#start = end;
      if (!this.#shiftLock) this.#lock = null;
    }
  }
}
