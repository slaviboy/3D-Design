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
import { cross, distance, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import {
  curvePoints,
  DEFAULT_CIRCLE_SEGMENTS,
  insertCurve,
  MAX_CURVE_SEGMENTS,
  MIN_CLOSED_CURVE_SEGMENTS,
} from '../../kernel/ops/curves';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  CIRCLE_TOOL_ID,
  POLYGON_TOOL_ID,
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
  toLocalDirection,
  toLocalNormal,
  toLocalPoint,
  modelFrame,
} from './toolSupport';

export const DEFAULT_POLYGON_SIDES = 6;

type ShapeKind = 'circle' | 'polygon';

interface Placement {
  readonly center: Vec3;
  readonly plane: Plane;
}

interface Drawn {
  readonly placement: Placement;
  readonly radius: number;
  readonly xAxis: Vec3;
  readonly record: TransactionRecord;
}

/** Draws a circle or a regular polygon from its center and radius. */
export class CircleTool implements Tool {
  readonly id: string;
  readonly label: string;
  readonly cursor = 'crosshair';
  readonly #kind: ShapeKind;

  #segments: number;
  #placement: Placement | null = null;
  #current: Inference | null = null;
  #last: Drawn | null = null;

  constructor(kind: ShapeKind) {
    this.#kind = kind;
    this.id = kind === 'circle' ? CIRCLE_TOOL_ID : POLYGON_TOOL_ID;
    this.label = kind === 'circle' ? 'Circle' : 'Polygon';
    this.#segments = kind === 'circle' ? DEFAULT_CIRCLE_SEGMENTS : DEFAULT_POLYGON_SIDES;
  }

  get segments(): number {
    return this.#segments;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#current = this.#infer(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const inference = this.#infer(input, editor);
    this.#current = inference;
    const placement = this.#placement;
    if (!placement) {
      this.#placement = { center: inference.point, plane: drawingPlane(editor, inference) };
      return;
    }
    const radius = distance(placement.center, inference.point);
    this.#draw(editor, placement, radius, this.#xAxis(placement, inference.point));
  }

  busy(): boolean {
    return this.#placement !== null;
  }

  cancel(): void {
    this.#placement = null;
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#placement) {
      this.cancel();
      return true;
    }
    return false;
  }

  measurement(editor: Editor): MeasurementField {
    const sidesLabel = this.#kind === 'circle' ? 'Segments' : 'Sides';
    const placement = this.#placement;
    if (placement && this.#current) {
      return {
        label: 'Radius',
        value: formatDistance(editor, distance(placement.center, this.#current.point)),
        accepts: ['length', 'radius', 'segments'],
      };
    }
    if (this.#last && canReplace(editor.session.doc, this.#last.record)) {
      return {
        label: 'Radius',
        value: formatDistance(editor, this.#last.radius),
        accepts: ['length', 'radius', 'segments'],
      };
    }
    return { label: sidesLabel, value: String(this.#segments), accepts: ['segments'] };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    let radius: number | null = null;
    if (intent.kind === 'segments') {
      const minimum = MIN_CLOSED_CURVE_SEGMENTS;
      if (intent.count < minimum || intent.count > MAX_CURVE_SEGMENTS) {
        throw new Error(
          `Enter from ${String(minimum)} to ${String(MAX_CURVE_SEGMENTS)} ${this.#kind === 'circle' ? 'segments' : 'sides'}`,
        );
      }
      this.#segments = intent.count;
    } else if (intent.kind === 'length' || intent.kind === 'radius') {
      radius = Math.abs(intent.value);
    } else {
      return;
    }

    const placement = this.#placement;
    if (placement) {
      if (radius === null) return;
      const toward = this.#current
        ? this.#xAxis(placement, this.#current.point)
        : planeAxes(placement.plane.normal, modelFrame(editor)).u;
      this.#draw(editor, placement, radius, toward);
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (last && canReplace(doc, last.record)) {
      doc.rollbackLastTransaction();
      this.#last = null;
      this.#draw(editor, last.placement, radius ?? last.radius, last.xAxis);
    } else if (radius !== null) {
      throw new Error(`Click the center of the ${this.#kind} first`);
    }
  }

  preview(): ToolPreview {
    const placement = this.#placement;
    const current = this.#current;
    if (!placement || !current) return { lines: [], highlight: [], marker: markerFor(current) };
    const radius = distance(placement.center, current.point);
    if (radius <= EPS_LEN) return { lines: [], highlight: [], marker: markerFor(current) };
    const { points } = curvePoints(this.#params(placement, radius, this.#xAxis(placement, current.point)));
    return {
      lines: [
        ...points.map((a, i) => ({ a, b: points[(i + 1) % points.length] ?? a, style: 'preview' as const })),
        { a: placement.center, b: current.point, style: 'guide' as const },
      ],
      highlight: [],
      marker: markerFor(current),
    };
  }

  statusHint(): string {
    const shape = this.#kind === 'circle' ? 'circle' : 'polygon';
    const count = this.#kind === 'circle' ? 'segments (24s)' : 'sides (8s)';
    return this.#placement
      ? `Click to set the radius, or type it. Type a number followed by s to change the ${count}.`
      : `Click the center of the ${shape}. Type a number followed by s to change the ${count}.`;
  }

  #infer(input: PointerInput, editor: Editor): Inference {
    const placement = this.#placement;
    if (!placement) return inferAt(editor, input);
    const inference = inferAt(editor, input, { anchor: placement.center, fallbackPlane: placement.plane });
    return { ...inference, point: projectOntoPlane(placement.plane, inference.point) };
  }

  #xAxis(placement: Placement, point: Vec3): Vec3 {
    return normalize(sub(point, placement.center)) ?? planeAxes(placement.plane.normal).u;
  }

  #params(placement: Placement, radius: number, xAxis: Vec3) {
    const normal = placement.plane.normal;
    const inPlane = normalize(sub(xAxis, scale(normal, dot(xAxis, normal)))) ?? planeAxes(normal).u;
    const frame = { center: placement.center, normal, xAxis: inPlane, radius };
    return this.#kind === 'circle'
      ? { kind: 'circle' as const, segments: this.#segments, ...frame }
      : { kind: 'polygon' as const, sides: this.#segments, ...frame };
  }

  #draw(editor: Editor, placement: Placement, radius: number, xAxis: Vec3): void {
    if (radius <= EPS_LEN) throw new Error(`The ${this.#kind} needs a radius`);
    const world = this.#params(placement, radius, xAxis);
    const normal = toLocalNormal(editor, world.normal);
    const localX = toLocalDirection(editor, scale(world.xAxis, radius));
    const unitX = normalize(sub(localX, scale(normal, dot(localX, normal))));
    if (!unitX) throw new Error(`The ${this.#kind} can't be drawn in this group`);
    const localRadius = Math.hypot(localX.x, localX.y, localX.z);
    const frame = { center: toLocalPoint(editor, world.center), normal, xAxis: unitX, radius: localRadius };
    const { session } = editor;
    const doc = session.doc;
    insertCurve(
      doc,
      session.activeContext,
      this.#kind === 'circle'
        ? { kind: 'circle', segments: this.#segments, ...frame }
        : { kind: 'polygon', sides: this.#segments, ...frame },
      { orientationHint: cross(unitX, cross(normal, unitX)) },
    );
    const record = doc.lastTransaction;
    this.#placement = null;
    this.#last = record ? { placement, radius, xAxis: world.xAxis, record } : null;
  }
}
