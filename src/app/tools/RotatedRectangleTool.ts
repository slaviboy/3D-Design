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

import type { Plane } from '../../kernel/math/plane';
import { add, cross, distance, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  canReplace,
  drawingPlane,
  formatDistance,
  inferAt,
  markerFor,
  planeAxes,
  projectOntoPlane,
  toLocalPoint,
  lineStyleFor,
  modelFrame,
} from './toolSupport';
import { rotateDirection } from './transformSupport';

export const ROTATED_RECTANGLE_TOOL_ID = 'tool.rotatedRectangle';

interface Drawn {
  readonly plane: Plane;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly base: number;
  readonly width: number;
  readonly record: TransactionRecord;
}

/** Draws a rectangle at any angle within a plane: click the two ends of one side, then set the width. */
export class RotatedRectangleTool implements Tool {
  readonly id = ROTATED_RECTANGLE_TOOL_ID;
  readonly label = 'Rotated Rectangle';
  readonly cursor = 'crosshair';

  #plane: Plane | null = null;
  #start: Vec3 | null = null;
  #end: Vec3 | null = null;
  /** A typed angle fixes the base direction until the base is set. */
  #direction: Vec3 | null = null;
  #current: Inference | null = null;
  #last: Drawn | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const point = this.#pointer();
    if (!point) return;
    const start = this.#start;
    const end = this.#end;
    if (!start) {
      this.#plane = drawingPlane(editor, inference);
      this.#start = projectOntoPlane(this.#plane, inference.point);
      return;
    }
    if (!end) {
      if (distance(start, point) > EPS_LEN) this.#end = point;
      return;
    }
    const width = this.#width(point);
    if (Math.abs(width) > EPS_LEN) this.#draw(editor, start, end, width);
  }

  busy(): boolean {
    return this.#start !== null;
  }

  cancel(): void {
    this.#plane = null;
    this.#start = null;
    this.#end = null;
    this.#direction = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#start) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField | null {
    const start = this.#start;
    const end = this.#end;
    const point = this.#pointer();
    if (start && !end) {
      return {
        label: 'Length',
        value: point ? formatDistance(editor, distance(start, point)) : '',
        accepts: ['length', 'angle'],
      };
    }
    if (start && end) {
      return {
        label: 'Width',
        value: point ? formatDistance(editor, Math.abs(this.#width(point))) : '',
        accepts: ['length'],
      };
    }
    const last = this.#last;
    if (last && canReplace(editor.session.doc, last.record)) {
      return {
        label: 'Dimensions',
        value: `${formatDistance(editor, last.base)}, ${formatDistance(editor, Math.abs(last.width))}`,
        accepts: ['lengthPair'],
      };
    }
    return null;
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    const start = this.#start;
    const end = this.#end;
    const plane = this.#plane;
    const point = this.#pointer();
    if (start && !end && plane) {
      if (intent.kind === 'angle') {
        this.#direction = rotateDirection(
          planeAxes(plane.normal, modelFrame(editor)).u,
          plane.normal,
          intent.radians,
        );
        return;
      }
      if (intent.kind === 'length') {
        const direction = this.#direction ?? (point ? normalize(sub(point, start)) : null);
        if (!direction) throw new Error('Move the pointer to show the direction of the side');
        this.#end = add(start, scale(direction, intent.value));
      }
      return;
    }
    if (start && end && intent.kind === 'length') {
      const sign = point && this.#width(point) < 0 ? -1 : 1;
      this.#draw(editor, start, end, sign * intent.value);
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (intent.kind !== 'lengthPair' || !last || !canReplace(doc, last.record)) {
      throw new Error('Click the start of the first side');
    }
    doc.rollbackLastTransaction();
    this.#last = null;
    this.#plane = last.plane;
    const base = intent.first ?? last.base;
    const width = intent.second === null ? last.width : Math.sign(last.width || 1) * intent.second;
    this.#draw(editor, last.start, add(last.start, scale(last.direction, base)), width);
  }

  preview(): ToolPreview {
    const start = this.#start;
    const end = this.#end;
    const point = this.#pointer();
    const marker = markerFor(this.#current);
    if (!start || !point) return { lines: [], highlight: [], marker };
    if (!end)
      return {
        lines: [{ a: start, b: point, style: lineStyleFor(this.#current?.axis) }],
        highlight: [],
        marker,
      };
    const corners = this.#corners(start, end, this.#width(point));
    return {
      lines: corners.map((a, i) => ({
        a,
        b: corners[(i + 1) % corners.length] ?? a,
        style: 'preview' as const,
      })),
      highlight: [],
      marker,
    };
  }

  statusHint(): string {
    if (!this.#start) return 'Click the start of the first side.';
    if (!this.#end) return 'Click the end of the first side, or type its length or angle.';
    return 'Click to set the width, or type it.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const start = this.#start;
    const plane = this.#plane;
    return inferAt(editor, input, {
      ...(start ? { anchor: start } : {}),
      ...(plane ? { fallbackPlane: plane } : {}),
      lockDirection: start && !this.#end ? this.#direction : null,
    });
  }

  #pointer(): Vec3 | null {
    const current = this.#current;
    const plane = this.#plane;
    if (!current) return null;
    return plane ? projectOntoPlane(plane, current.point) : current.point;
  }

  #perpendicular(start: Vec3, end: Vec3): Vec3 | null {
    const plane = this.#plane;
    return plane ? normalize(cross(plane.normal, sub(end, start))) : null;
  }

  #width(point: Vec3): number {
    const start = this.#start;
    const end = this.#end;
    if (!start || !end) return 0;
    const perpendicular = this.#perpendicular(start, end);
    return perpendicular ? dot(sub(point, start), perpendicular) : 0;
  }

  #corners(start: Vec3, end: Vec3, width: number): Vec3[] {
    const offset = scale(this.#perpendicular(start, end) ?? start, width);
    return [start, end, add(end, offset), add(start, offset)];
  }

  #draw(editor: Editor, start: Vec3, end: Vec3, width: number): void {
    const plane = this.#plane;
    const direction = normalize(sub(end, start));
    if (!plane || !direction || Math.abs(width) <= EPS_LEN)
      throw new Error('A rectangle needs a length and a width');
    const { session } = editor;
    const doc = session.doc;
    const points = this.#corners(start, end, width).map((corner) => toLocalPoint(editor, corner));
    doc.transact('Rotated Rectangle', () =>
      insertSegments(
        doc,
        session.activeContext,
        points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a })),
        { autoFace: true, retrace: true },
      ),
    );
    const record = doc.lastTransaction;
    this.cancel();
    this.#last = record ? { plane, start, direction, base: distance(start, end), width, record } : null;
  }
}
