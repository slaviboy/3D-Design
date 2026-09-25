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

import { invertAffine, multiply, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { cross, dot, normalize, scale, sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import { create3DText, textFrameTransform, type Text3DOptions } from '../../kernel/ops/text3d';
import type { TextPolygon } from '../../kernel/text/font';
import { layoutText } from '../../kernel/text/layout';
import { cameraBasis } from '../camera/camera';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { Selection } from '../selection/Selection';
import {
  PRIMARY_BUTTON,
  SELECT_TOOL_ID,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import { inferAt, markerFor, modelFrame } from './toolSupport';

export const TEXT_3D_TOOL_ID = 'tool.text3d';

const EMPTY_PREVIEW: ToolPreview = { lines: [], highlight: [], marker: null };

/** Previews draw at most this many outline segments, so long texts stay responsive. */
const MAX_PREVIEW_SEGMENTS = 4000;

/**
 * The world transform for text placed at an inferred point: on the face under the cursor (turned towards the
 * camera), otherwise flat on the ground plane of the drawing axes. Text reads along the drawing axes where it can,
 * with its letters pointing up the blue axis on vertical faces.
 */
export function text3DWorldTransform(editor: Editor, inference: Inference): Mat4 {
  const frame = modelFrame(editor);
  let normal = frame.z;
  if (inference.facePlane) {
    normal = inference.facePlane.normal;
    if (dot(normal, cameraBasis(editor.session.camera).forward) > 0) normal = scale(normal, -1);
  }
  const alongUp = dot(normal, frame.z);
  let xAxis: Vec3;
  let yAxis: Vec3;
  if (Math.abs(alongUp) > 1 - 1e-6) {
    xAxis = frame.x;
    yAxis = cross(normal, frame.x);
  } else {
    yAxis = normalize(sub(frame.z, scale(normal, alongUp))) ?? frame.z;
    xAxis = cross(yAxis, normal);
  }
  return textFrameTransform({ origin: inference.point, xAxis, yAxis });
}

/**
 * Places 3D text chosen in the 3D Text dialog. The text's outline follows the cursor, lying on the face under it or
 * on the ground; a click creates it as one undoable step. Esc cancels and returns to Select.
 */
export class Text3DTool implements Tool {
  readonly id = TEXT_3D_TOOL_ID;
  readonly label = '3D Text';
  readonly cursor = 'copy';

  #options: Text3DOptions | null = null;
  #polygons: readonly TextPolygon[] = [];
  #inference: Inference | null = null;

  /** The text the next click places, if any. */
  get options(): Text3DOptions | null {
    return this.#options;
  }

  setOptions(options: Text3DOptions | null): void {
    this.#options = options;
    this.#inference = null;
    this.#polygons = options
      ? layoutText(options.text, { height: options.height, align: options.align ?? 'left' }).polygons
      : [];
  }

  deactivate(): void {
    this.setOptions(null);
  }

  busy(): boolean {
    return this.#options !== null;
  }

  aims(): boolean {
    return this.#options !== null;
  }

  cancel(): void {
    this.#inference = null;
  }

  pointerMove(input: PointerInput, editor: Editor): void {
    this.#inference = this.#options ? inferAt(editor, input) : null;
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const options = this.#options;
    if (!options) throw new Error('Choose 3D Text… in the Tools menu to type the text first');
    const inference = inferAt(editor, input);
    const { session } = editor;
    const toLocal = invertAffine(session.activeContextTransform);
    if (!toLocal) throw new Error('The open group has a singular transform');
    const transform = multiply(toLocal, text3DWorldTransform(editor, inference));
    const created = create3DText(session.doc, session.activeContext, transform, {
      ...options,
      instanceAttributes: { ...options.instanceAttributes, tagId: session.activeTagId },
    });
    session.setSelection(Selection.of([{ kind: 'instance', id: created.instance }]));
    editor.activateTool(SELECT_TOOL_ID);
  }

  keyDown(chord: string, editor: Editor): boolean {
    if (chord !== 'Escape') return false;
    editor.activateTool(SELECT_TOOL_ID);
    return true;
  }

  preview(editor: Editor): ToolPreview {
    const options = this.#options;
    const inference = this.#inference;
    if (!options || !inference) return EMPTY_PREVIEW;
    const transform = text3DWorldTransform(editor, inference);
    const depth = options.filled === false ? 0 : (options.depth ?? 0);
    const lines: PreviewLine[] = [];
    const addRing = (ring: readonly { x: number; y: number }[], z: number): void => {
      const points = ring.map((p) => transformPoint(transform, vec3(p.x, p.y, z)));
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        if (b && lines.length < MAX_PREVIEW_SEGMENTS) lines.push({ a, b, style: 'preview' });
      });
    };
    for (const polygon of this.#polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        addRing(ring, 0);
        if (depth > 0) addRing(ring, depth);
      }
    }
    return { lines, highlight: [], marker: markerFor(inference) };
  }

  statusHint(): string {
    return this.#options
      ? 'Click a face or the ground to place the text. Esc cancels.'
      : 'Choose 3D Text… in the Tools menu to type the text, then click to place it.';
  }
}
