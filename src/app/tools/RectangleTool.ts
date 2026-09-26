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

import { planeFromPointNormal, signedDistanceToPlane, type Plane } from '../../kernel/math/plane';
import { add, dot, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { insertSegments } from '../../kernel/ops/insertSegments';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  RECTANGLE_TOOL_ID,
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
  modelFrame,
} from './toolSupport';

interface Frame {
  readonly corner: Vec3;
  readonly plane: Plane;
  readonly u: Vec3;
  readonly v: Vec3;
  /** The first corner was clicked on a face, which keeps the rectangle on it. */
  readonly onFace: boolean;
}

interface Drawn {
  readonly frame: Frame;
  readonly width: number;
  readonly height: number;
  readonly record: TransactionRecord;
}

function corners(frame: Frame, width: number, height: number): Vec3[] {
  const along = scale(frame.u, width);
  const across = scale(frame.v, height);
  return [
    frame.corner,
    add(frame.corner, along),
    add(add(frame.corner, along), across),
    add(frame.corner, across),
  ];
}

function frameOn(editor: Editor, corner: Vec3, plane: Plane, onFace: boolean): Frame {
  return { corner, plane, ...planeAxes(plane.normal, modelFrame(editor)), onFace };
}

/**
 * Draws a rectangle from two corners, aligned with the axes of the plane it's drawn on. A first corner clicked on a
 * face keeps the rectangle on that face. Otherwise the plane follows the opposite corner: the face under the pointer
 * when the first corner lies on it, else the plane of the drawing axes that holds both corners (so two corners of a
 * wall make a vertical rectangle), else the plane chosen at the first click.
 */
export class RectangleTool implements Tool {
  readonly id = RECTANGLE_TOOL_ID;
  readonly label = 'Rectangle';
  readonly cursor = 'crosshair';

  #frame: Frame | null = null;
  #current: Inference | null = null;
  /** The frame the rectangle lies in for the current pointer position. */
  #currentFrame: Frame | null = null;
  #last: Drawn | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const frame = this.#currentFrame;
    if (!this.#frame || !frame) {
      this.#frame = frameOn(
        editor,
        inference.point,
        drawingPlane(editor, inference),
        inference.facePlane !== undefined,
      );
      this.#currentFrame = this.#frame;
      return;
    }
    const { width, height } = this.#size(frame, inference.point);
    // A click that would make a degenerate rectangle is ignored; the tool keeps waiting for the opposite corner.
    if (Math.abs(width) <= EPS_LEN || Math.abs(height) <= EPS_LEN) return;
    this.#draw(editor, frame, width, height);
  }

  busy(): boolean {
    return this.#frame !== null;
  }

  cancel(): void {
    this.#frame = null;
    this.#currentFrame = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#frame) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const frame = this.#currentFrame;
    let value = '';
    if (frame && this.#current) {
      const { width, height } = this.#size(frame, this.#current.point);
      value = `${formatDistance(editor, Math.abs(width))}, ${formatDistance(editor, Math.abs(height))}`;
    } else if (this.#last) {
      value = `${formatDistance(editor, Math.abs(this.#last.width))}, ${formatDistance(editor, Math.abs(this.#last.height))}`;
    }
    return { label: 'Dimensions', value, accepts: ['lengthPair', 'length'] };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind !== 'lengthPair' && intent.kind !== 'length') return;
    const first = intent.kind === 'length' ? intent.value : intent.first;
    const second = intent.kind === 'length' ? null : intent.second;
    const signed = (typed: number | null, current: number): number =>
      typed === null ? current : (current < 0 ? -1 : 1) * typed;

    const frame = this.#currentFrame;
    if (frame) {
      const current = this.#current ? this.#size(frame, this.#current.point) : { width: 0, height: 0 };
      this.#draw(editor, frame, signed(first, current.width), signed(second, current.height));
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record))
      throw new Error('Click the first corner of a rectangle first');
    doc.rollbackLastTransaction();
    this.#last = null;
    this.#draw(editor, last.frame, signed(first, last.width), signed(second, last.height));
  }

  preview(): ToolPreview {
    const frame = this.#currentFrame;
    const current = this.#current;
    if (!frame || !current) return { lines: [], highlight: [], marker: markerFor(current) };
    const { width, height } = this.#size(frame, current.point);
    const points = corners(frame, width, height);
    return {
      lines: points.map((a, i) => ({
        a,
        b: points[(i + 1) % points.length] ?? a,
        style: 'preview' as const,
      })),
      highlight: [],
      marker: markerFor(current),
    };
  }

  statusHint(): string {
    return this.#frame
      ? 'Click the opposite corner, or type the width and height, for example 2m,1m.'
      : 'Click the first corner of the rectangle.';
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const frame = this.#frame;
    if (!frame) return inferAt(editor, input);
    // No anchor, and no drawing axis through the first corner: a corner on an axis through the other one would only
    // ever produce a flat rectangle.
    const inference = inferAt(editor, input, {
      fallbackPlane: frame.plane,
      excludeAxesThrough: frame.corner,
    });
    const chosen = this.#frameFor(editor, frame, inference);
    this.#currentFrame = chosen;
    return { ...inference, point: projectOntoPlane(chosen.plane, inference.point) };
  }

  /** The plane the rectangle lies in with its opposite corner at `inference` (see the class comment). */
  #frameFor(editor: Editor, frame: Frame, inference: Inference): Frame {
    if (frame.onFace) return frame;
    const { corner } = frame;
    const face = inference.facePlane;
    if (face && Math.abs(signedDistanceToPlane(face, corner)) <= EPS_LEN)
      return frameOn(editor, corner, face, false);
    const diagonal = sub(inference.point, corner);
    const axes = modelFrame(editor);
    const holding = [axes.z, axes.x, axes.y].filter((normal) => Math.abs(dot(diagonal, normal)) <= EPS_LEN);
    const [only] = holding;
    return holding.length === 1 && only
      ? frameOn(editor, corner, planeFromPointNormal(corner, only), false)
      : frame;
  }

  #size(frame: Frame, point: Vec3): { width: number; height: number } {
    const offset = sub(point, frame.corner);
    return { width: dot(offset, frame.u), height: dot(offset, frame.v) };
  }

  #draw(editor: Editor, frame: Frame, width: number, height: number): void {
    if (Math.abs(width) <= EPS_LEN || Math.abs(height) <= EPS_LEN) {
      throw new Error('A rectangle needs a width and a height');
    }
    const { session } = editor;
    const doc = session.doc;
    const points = corners(frame, width, height).map((point) => toLocalPoint(editor, point));
    doc.transact('Rectangle', () =>
      insertSegments(
        doc,
        session.activeContext,
        points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a })),
        { autoFace: true, retrace: true },
      ),
    );
    const record = doc.lastTransaction;
    this.#frame = null;
    this.#currentFrame = null;
    this.#last = record ? { frame, width, height, record } : null;
  }
}
