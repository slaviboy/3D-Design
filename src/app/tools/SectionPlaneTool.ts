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

import { add, dot, negate, scale, type Vec3 } from '../../kernel/math/vec3';
import { cameraBasis, worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { PRIMARY_BUTTON, type PointerInput, type PreviewLine, type Tool, type ToolPreview } from './Tool';
import {
  axisForArrowKey,
  inferAt,
  markerFor,
  modelFrame,
  planeAxes,
  toLocalNormal,
  toLocalPoint,
} from './toolSupport';

export const SECTION_PLANE_TOOL_ID = 'tool.sectionPlane';

/** On-screen half-size of the preview rectangle. */
const PREVIEW_HALF_SIZE_PX = 40;
/** On-screen length of the arrow showing which side is cut away. */
const PREVIEW_ARROW_PX = 30;

const AXIS_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'blue',
  ArrowRight: 'red',
  ArrowLeft: 'green',
};

/** A plane in world coordinates. */
export interface SectionPlacement {
  readonly point: Vec3;
  /** Points toward the camera: the side between the camera and the plane is cut away. */
  readonly normal: Vec3;
}

/**
 * Places section planes. The plane follows the face under the cursor, or otherwise the drawing-axis plane that faces
 * the camera most directly. Arrow keys lock the orientation to an axis (press the same key again to unlock). A click
 * places the plane in the open context and makes it the active cut.
 */
export class SectionPlaneTool implements Tool {
  readonly id = SECTION_PLANE_TOOL_ID;
  readonly label = 'Section Plane';
  readonly cursor = 'crosshair';

  #lockKey: string | null = null;
  #inference: Inference | null = null;
  #placement: SectionPlacement | null = null;

  /** Where a click at `screen` would place the plane. */
  placementAt(screen: { x: number; y: number }, editor: Editor): SectionPlacement {
    const inference = inferAt(editor, screen);
    this.#inference = inference;
    const forward = cameraBasis(editor.session.camera).forward;
    const locked = this.#lockKey ? axisForArrowKey(this.#lockKey, editor) : null;
    let normal: Vec3;
    if (locked) {
      normal = locked;
    } else if (inference.facePlane) {
      normal = inference.facePlane.normal;
    } else {
      const frame = modelFrame(editor);
      normal = [frame.x, frame.y, frame.z].reduce((best, axis) =>
        Math.abs(dot(axis, forward)) > Math.abs(dot(best, forward)) ? axis : best,
      );
    }
    if (dot(normal, forward) > 0) normal = negate(normal);
    const placement = { point: inference.point, normal };
    this.#placement = placement;
    return placement;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.placementAt(input, editor);
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const placement = this.placementAt(input, editor);
    editor.placeSectionPlane(toLocalPoint(editor, placement.point), toLocalNormal(editor, placement.normal));
  }

  keyDown(chord: string, editor: Editor): boolean {
    if (axisForArrowKey(chord, editor)) {
      this.#lockKey = this.#lockKey === chord ? null : chord;
      return true;
    }
    if (chord === 'Escape' && this.#lockKey !== null) {
      this.#lockKey = null;
      return true;
    }
    return false;
  }

  cancel(): void {
    this.#lockKey = null;
  }

  deactivate(): void {
    this.#lockKey = null;
    this.#placement = null;
    this.#inference = null;
  }

  preview(editor: Editor): ToolPreview {
    const placement = this.#placement;
    const lines: PreviewLine[] = [];
    if (placement) {
      const perPixel = worldUnitsPerPixel(editor.session.camera, placement.point, editor.viewportSize);
      const half = PREVIEW_HALF_SIZE_PX * perPixel;
      const { u, v } = planeAxes(placement.normal, modelFrame(editor));
      const corner = (su: number, sv: number): Vec3 =>
        add(placement.point, add(scale(u, su * half), scale(v, sv * half)));
      const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      corners.forEach((a, index) => {
        lines.push({ a, b: corners[(index + 1) % corners.length] ?? a, style: 'preview' });
      });
      lines.push({
        a: placement.point,
        b: add(placement.point, scale(placement.normal, PREVIEW_ARROW_PX * perPixel)),
        style: 'preview',
      });
    }
    return { lines, highlight: [], marker: markerFor(this.#inference) };
  }

  statusHint(): string {
    const lock = this.#lockKey ? ` Locked to the ${AXIS_NAMES[this.#lockKey] ?? ''} axis.` : '';
    return `Click to place a section plane on a face or facing the view. Arrow keys lock its orientation (Up blue, Right red, Left green).${lock}`;
  }
}
