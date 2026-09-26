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

import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { add, scale, type Vec3 } from '../../kernel/math/vec3';
import { addGuideLine } from '../../kernel/model/mutations';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import { worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import {
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  axisForArrowKey,
  inferAt,
  markerFor,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  toLocalPoint,
} from './toolSupport';
import {
  directionInPlane,
  formatAngleValue,
  MIN_ANGLE,
  PROTRACTOR_RADIUS_PX,
  protractorLines,
  protractorPlane,
  rotateDirection,
  signedAngle,
  snapAngle,
} from './transformSupport';

export const PROTRACTOR_TOOL_ID = 'tool.protractor';

/** Guide lines drawn from the protractor extend this many protractor radii on screen. */
const GUIDE_PREVIEW_RADII = 4;

interface Pivot {
  readonly center: Vec3;
  readonly plane: Plane;
}

/**
 * Measures angles and creates angled guide lines: click the vertex, click the zero line, then click or type the
 * angle. The toggle key measures without creating a guide.
 */
export class ProtractorTool implements Tool {
  readonly id = PROTRACTOR_TOOL_ID;
  readonly label = 'Protractor';
  readonly cursor = 'crosshair';

  #lockNormal: Vec3 | null = null;
  #pivot: Pivot | null = null;
  #reference: Vec3 | null = null;
  #angle = 0;
  #lastAngle: number | null = null;
  #current: Inference | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const pivot = this.#pivot;
    this.#current = inferAt(
      editor,
      input,
      pivot ? { anchor: pivot.center, fallbackPlane: pivot.plane, planar: true } : {},
    );
    const reference = this.#reference;
    if (pivot && reference) {
      const direction = directionInPlane(pivot.plane, pivot.center, this.#current.point);
      if (direction) this.#angle = snapAngle(signedAngle(reference, direction, pivot.plane.normal));
    }
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const pivot = this.#pivot;
    if (!pivot) {
      const inference = inferAt(editor, input);
      this.#current = inference;
      this.#pivot = { center: inference.point, plane: protractorPlane(editor, inference, this.#lockNormal) };
      return;
    }
    const inference = inferAt(editor, input, {
      anchor: pivot.center,
      fallbackPlane: pivot.plane,
      planar: true,
    });
    const direction = directionInPlane(pivot.plane, pivot.center, inference.point);
    if (!direction) return;
    const reference = this.#reference;
    if (!reference) {
      this.#reference = direction;
      this.#angle = 0;
      return;
    }
    this.#finish(
      editor,
      snapAngle(signedAngle(reference, direction, pivot.plane.normal)),
      !toggleModifier(input, editor),
    );
  }

  keyDown(chord: string, editor: Editor): boolean {
    const axis = axisForArrowKey(chord, editor);
    if (axis && !this.#reference) {
      this.#lockNormal = this.#lockNormal === axis ? null : axis;
      const pivot = this.#pivot;
      if (pivot && this.#lockNormal) {
        this.#pivot = { center: pivot.center, plane: planeFromPointNormal(pivot.center, this.#lockNormal) };
      }
      return true;
    }
    if (chord === 'Escape' && this.#pivot) {
      this.cancel();
      return true;
    }
    return false;
  }

  busy(): boolean {
    return this.#pivot !== null;
  }

  cancel(): void {
    this.#pivot = null;
    this.#reference = null;
    this.#angle = 0;
  }

  measurement(editor: Editor): MeasurementField {
    const angle = this.#reference ? this.#angle : this.#lastAngle;
    return {
      label: 'Angle',
      value: angle === null ? '' : formatAngleValue(editor, Math.abs(angle)),
      accepts: ['angle'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind !== 'angle') return;
    if (!this.#reference) throw new Error('Click the vertex and the zero line of the angle first');
    this.#finish(editor, (this.#angle < 0 ? -1 : 1) * intent.radians, true);
  }

  preview(editor: Editor): ToolPreview {
    const pivot = this.#pivot;
    const reference = this.#reference;
    const lines: PreviewLine[] = pivot
      ? protractorLines(editor, pivot.center, pivot.plane.normal, reference)
      : [];
    if (pivot && reference) {
      const reach =
        worldUnitsPerPixel(editor.session.camera, pivot.center, editor.viewportSize) *
        PROTRACTOR_RADIUS_PX *
        GUIDE_PREVIEW_RADII;
      const direction = rotateDirection(reference, pivot.plane.normal, this.#angle);
      lines.push(
        { a: pivot.center, b: add(pivot.center, scale(reference, reach)), style: 'guide' },
        { a: pivot.center, b: add(pivot.center, scale(direction, reach)), style: 'preview' },
      );
    }
    return { lines, highlight: [], marker: markerFor(this.#current) };
  }

  statusHint(editor: Editor): string {
    if (!this.#pivot) return 'Click the vertex of the angle. Arrow keys lock the protractor to an axis.';
    if (!this.#reference) return 'Click a point on the zero line of the angle.';
    return `Click or type the angle to place a guide. ${toggleModifierName(editor)} only measures.`;
  }

  #finish(editor: Editor, angle: number, createGuide: boolean): void {
    const pivot = this.#pivot;
    const reference = this.#reference;
    this.cancel();
    if (!pivot || !reference) return;
    this.#lastAngle = angle;
    if (!createGuide || Math.abs(angle) <= MIN_ANGLE) return;
    const direction = rotateDirection(reference, pivot.plane.normal, angle);
    const doc = editor.session.doc;
    const context = editor.session.activeContext;
    doc.transact('Protractor Guide', () =>
      addGuideLine(doc, context, toLocalPoint(editor, pivot.center), toLocalDirection(editor, direction)),
    );
  }
}
