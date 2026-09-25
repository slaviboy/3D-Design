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

import type { Aabb } from '../../kernel/math/aabb';
import { transformPoint } from '../../kernel/math/mat4';
import { add, distance, dot, sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { transformEntities, type TransformResult, type TransformSelection } from '../../kernel/ops/transform';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import { projectToScreen, rayThroughScreen, worldUnitsPerPixel } from '../camera/camera';
import type { Editor } from '../Editor';
import { closestPointOnLineToRay } from '../inference/inference';
import { Selection } from '../selection/Selection';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  PRIMARY_BUTTON,
  type MeasurementField,
  type PointerInput,
  type PreviewLine,
  type Tool,
  type ToolPreview,
} from './Tool';
import {
  canReplace,
  errorMessage,
  isVisibleFromCamera,
  Speculation,
  toggleModifier,
  toggleModifierName,
} from './toolSupport';
import { refsOfResult, scalingAbout, selectionBounds, transformSelectionOf } from './transformSupport';

export const SCALE_TOOL_ID = 'tool.scale';

const GRIP_PICK_PX = 10;
const TOUCH_GRIP_PICK_PX = 20;
const GRIP_SIZE_PX = 4;
/** Scale factors closer to zero than this would collapse the geometry. */
const MIN_SCALE_FACTOR = 1e-6;
const FACTOR_DECIMALS = 3;
const GRIP_STEPS = [0, 0.5, 1] as const;

type Axis3 = readonly [number, number, number];

interface Grip {
  /** Position within the bounds per axis: 0, 0.5 or 1. */
  readonly t: Axis3;
  readonly world: Vec3;
}

interface Operation {
  readonly selection: TransformSelection;
  readonly box: Aabb;
  readonly grip: Grip;
  readonly speculation: Speculation;
  readonly pressX: number;
  readonly pressY: number;
  aboutCenter: boolean;
  uniform: boolean;
  factors: Axis3;
  dragged: boolean;
  result: TransformResult | null;
  error: string | null;
}

interface Finished {
  readonly selection: TransformSelection;
  readonly box: Aabb;
  readonly grip: Grip;
  readonly aboutCenter: boolean;
  readonly uniform: boolean;
  readonly factors: Axis3;
  readonly record: TransactionRecord;
}

const boxMin = (box: Aabb): Axis3 => [box.minX, box.minY, box.minZ];
const boxSize = (box: Aabb): Axis3 => [box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ];

function pointInBox(box: Aabb, t: Axis3): Vec3 {
  const min = boxMin(box);
  const size = boxSize(box);
  return vec3(min[0] + t[0] * size[0], min[1] + t[1] * size[1], min[2] + t[2] * size[2]);
}

const activeAxes = (grip: Grip): [boolean, boolean, boolean] => [
  grip.t[0] !== 0.5,
  grip.t[1] !== 0.5,
  grip.t[2] !== 0.5,
];

function anchorT(grip: Grip, aboutCenter: boolean): Axis3 {
  if (aboutCenter) return [0.5, 0.5, 0.5];
  return [1 - grip.t[0], 1 - grip.t[1], 1 - grip.t[2]];
}

function describeGrip(grip: Grip): string {
  const count = activeAxes(grip).filter(Boolean).length;
  if (count === 3) return 'Uniform scale';
  if (count === 2) return 'Scale in two directions';
  return 'Scale in one direction';
}

/**
 * Scales the selection with grips on its bounding box. Corner grips scale uniformly, edge and face grips along
 * their directions; Shift toggles uniform scaling and the toggle key scales about the center. The measurements box
 * takes factors (`2`, `50%`, `1,2,3`) or a new length.
 */
export class ScaleTool implements Tool {
  readonly id = SCALE_TOOL_ID;
  readonly label = 'Scale';
  readonly cursor = 'nwse-resize';

  #hover: Grip | null = null;
  #operation: Operation | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      this.#hover = this.#gripAt(editor, input);
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX) {
      operation.dragged = true;
    }
    operation.aboutCenter = toggleModifier(input, editor);
    const cornerGrip = activeAxes(operation.grip).every(Boolean);
    operation.uniform = input.shiftKey ? !cornerGrip : cornerGrip;
    const factor = this.#factorAtPointer(editor, operation, input);
    if (factor !== null) this.#apply(editor, operation, this.#factorsFor(operation, [factor]));
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
      if (hit) session.setSelection(Selection.of([hit.ref]));
      return;
    }
    const grip = this.#gripAt(editor, input);
    const selection = transformSelectionOf(session.selection);
    const box = selectionBounds(editor, selection);
    if (!grip || !box) return;
    const cornerGrip = activeAxes(grip).every(Boolean);
    this.#operation = {
      selection,
      box,
      grip,
      speculation: new Speculation(session.doc),
      pressX: input.x,
      pressY: input.y,
      aboutCenter: toggleModifier(input, editor),
      uniform: input.shiftKey ? !cornerGrip : cornerGrip,
      factors: [1, 1, 1],
      dragged: false,
      result: null,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
  }

  keyDown(chord: string): boolean {
    if (chord === 'Escape' && this.#operation) {
      this.cancel();
      return true;
    }
    return false;
  }

  busy(): boolean {
    return this.#operation !== null;
  }

  cancel(): void {
    this.#operation?.speculation.rollback();
    this.#operation = null;
  }

  measurement(): MeasurementField {
    const factors = this.#operation?.factors ?? this.#last?.factors ?? null;
    return {
      label: 'Scale',
      value: factors ? this.#formatFactors(factors) : '',
      accepts: ['scale', 'length'],
    };
  }

  onMeasurement(intent: MeasurementIntent, editor: Editor): void {
    if (intent.kind !== 'scale' && intent.kind !== 'length') return;
    const operation = this.#operation;
    if (operation) {
      this.#apply(editor, operation, this.#factorsFromIntent(editor, operation, intent));
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }
    const last = this.#last;
    const { session } = editor;
    const doc = session.doc;
    if (!last || !canReplace(doc, last.record))
      throw new Error('Select entities and drag a scale grip first');
    const factors = this.#factorsFromIntent(editor, last, intent);
    doc.rollbackLastTransaction();
    this.#last = null;
    const anchor = pointInBox(last.box, anchorT(last.grip, last.aboutCenter));
    const result = transformEntities(
      doc,
      session.activeContext,
      last.selection,
      scalingAbout(anchor, vec3(...factors)),
    );
    const record = doc.lastTransaction;
    if (record) this.#last = { ...last, factors, record };
    session.setSelection(Selection.of(refsOfResult(result)));
  }

  preview(editor: Editor): ToolPreview {
    const operation = this.#operation;
    const box = operation
      ? operation.box
      : selectionBounds(editor, transformSelectionOf(editor.session.selection));
    if (!box) return { lines: [], highlight: [], marker: null };
    const toWorld = editor.session.activeContextTransform;
    const lines: PreviewLine[] = [];
    const corner = (t: Axis3): Vec3 => {
      let local = pointInBox(box, t);
      if (operation) {
        const anchor = pointInBox(box, anchorT(operation.grip, operation.aboutCenter));
        local = transformPoint(scalingAbout(anchor, vec3(...operation.factors)), local);
      }
      return transformPoint(toWorld, local);
    };
    for (const [a, b] of BOX_EDGES) lines.push({ a: corner(a), b: corner(b), style: 'guide' });
    if (!operation) {
      for (const grip of this.#grips(editor, box)) {
        const size =
          worldUnitsPerPixel(editor.session.camera, grip.world, editor.viewportSize) * GRIP_SIZE_PX;
        for (const direction of [vec3(size, 0, 0), vec3(0, size, 0), vec3(0, 0, size)]) {
          lines.push({ a: sub(grip.world, direction), b: add(grip.world, direction), style: 'preview' });
        }
      }
    }
    const hover = operation?.grip ?? this.#hover;
    return {
      lines,
      highlight: [],
      marker: hover
        ? {
            point: operation ? corner(operation.grip.t) : hover.world,
            kind: 'endpoint',
            label: operation?.aboutCenter ? `${describeGrip(hover)} about center` : describeGrip(hover),
          }
        : null,
    };
  }

  statusHint(editor: Editor): string {
    const operation = this.#operation;
    if (operation?.error) return operation.error;
    if (editor.session.selection.isEmpty) return 'Click an entity to scale it.';
    return operation
      ? `Move to scale, then click, or type a factor or length. Shift toggles uniform, ${toggleModifierName(editor)} scales about the center.`
      : 'Drag a grip to scale. Corners scale uniformly; edge and face grips scale along their directions.';
  }

  #grips(editor: Editor, box: Aabb): Grip[] {
    const size = boxSize(box);
    const toWorld = editor.session.activeContextTransform;
    const stepsFor = (axis: number): readonly number[] => ((size[axis] ?? 0) <= EPS_LEN ? [0.5] : GRIP_STEPS);
    const grips: Grip[] = [];
    for (const x of stepsFor(0)) {
      for (const y of stepsFor(1)) {
        for (const z of stepsFor(2)) {
          if (x === 0.5 && y === 0.5 && z === 0.5) continue;
          const t: Axis3 = [x, y, z];
          grips.push({ t, world: transformPoint(toWorld, pointInBox(box, t)) });
        }
      }
    }
    return grips;
  }

  /**
   * The grip under the pointer. Grips the selection hides lose to visible ones, then the nearest on screen wins, then
   * the nearest to the camera, so a corner in front beats the corner right behind it.
   */
  #gripAt(editor: Editor, input: PointerInput): Grip | null {
    const box = selectionBounds(editor, transformSelectionOf(editor.session.selection));
    if (!box) return null;
    let best: {
      readonly grip: Grip;
      readonly visible: boolean;
      readonly pixels: number;
      readonly depth: number;
    } | null = null;
    for (const grip of this.#grips(editor, box)) {
      const screen = projectToScreen(editor.session.camera, grip.world, editor.viewportSize);
      if (!screen) continue;
      const pixels = Math.hypot(screen.x - input.x, screen.y - input.y);
      if (pixels > (editor.pointerKind === 'touch' ? TOUCH_GRIP_PICK_PX : GRIP_PICK_PX)) continue;
      const candidate = {
        grip,
        visible: isVisibleFromCamera(editor, grip.world),
        pixels,
        depth: screen.depth,
      };
      const better =
        !best ||
        (candidate.visible !== best.visible
          ? candidate.visible
          : candidate.pixels !== best.pixels
            ? candidate.pixels < best.pixels
            : candidate.depth < best.depth);
      if (better) best = candidate;
    }
    return best?.grip ?? null;
  }

  /** Factor along the line from the anchor through the grip, where the pointer ray passes closest. */
  #factorAtPointer(editor: Editor, operation: Operation, input: PointerInput): number | null {
    const toWorld = editor.session.activeContextTransform;
    const anchor = transformPoint(
      toWorld,
      pointInBox(operation.box, anchorT(operation.grip, operation.aboutCenter)),
    );
    const axis = sub(operation.grip.world, anchor);
    const lengthSquared = dot(axis, axis);
    if (lengthSquared <= EPS_LEN * EPS_LEN) return null;
    const ray = rayThroughScreen(editor.session.camera, input, editor.viewportSize);
    const point = closestPointOnLineToRay(anchor, axis, ray);
    return dot(sub(point, anchor), axis) / lengthSquared;
  }

  #factorsFor(context: { grip: Grip; uniform: boolean }, values: readonly number[]): Axis3 {
    const active = activeAxes(context.grip);
    if (values.length === 1) {
      const value = values[0] ?? 1;
      return context.uniform
        ? [value, value, value]
        : [active[0] ? value : 1, active[1] ? value : 1, active[2] ? value : 1];
    }
    const axes = context.uniform ? [true, true, true] : active;
    const count = axes.filter(Boolean).length;
    if (values.length !== count) {
      throw new Error(`Type ${String(count)} factors for this grip, separated by commas`);
    }
    const factors: [number, number, number] = [1, 1, 1];
    let next = 0;
    for (let axis = 0; axis < 3; axis++) {
      if (axes[axis]) factors[axis] = values[next++] ?? 1;
    }
    return factors;
  }

  #factorsFromIntent(
    editor: Editor,
    context: { grip: Grip; uniform: boolean; box: Aabb; aboutCenter: boolean },
    intent: Extract<MeasurementIntent, { kind: 'scale' | 'length' }>,
  ): Axis3 {
    if (intent.kind === 'scale') return this.#factorsFor(context, intent.factors);
    const toWorld = editor.session.activeContextTransform;
    const anchor = transformPoint(
      toWorld,
      pointInBox(context.box, anchorT(context.grip, context.aboutCenter)),
    );
    const current = distance(anchor, context.grip.world) * (context.aboutCenter ? 2 : 1);
    if (current <= EPS_LEN) throw new Error('This grip has no length to scale');
    return this.#factorsFor(context, [intent.value / current]);
  }

  #formatFactors(factors: Axis3): string {
    const format = (value: number): string => String(Number(value.toFixed(FACTOR_DECIMALS)));
    const [x, y, z] = factors;
    return x === y && y === z ? format(x) : factors.map(format).join(', ');
  }

  #apply(editor: Editor, operation: Operation, factors: Axis3): void {
    operation.factors = factors;
    operation.error = null;
    operation.result = null;
    const { session } = editor;
    try {
      if (factors.some((factor) => Math.abs(factor) < MIN_SCALE_FACTOR)) {
        operation.speculation.rollback();
        operation.error = "The scale factor can't be zero";
        return;
      }
      if (factors.every((factor) => factor === 1)) {
        operation.speculation.rollback();
        return;
      }
      const anchor = pointInBox(operation.box, anchorT(operation.grip, operation.aboutCenter));
      operation.result = operation.speculation.run(() =>
        transformEntities(
          session.doc,
          session.activeContext,
          operation.selection,
          scalingAbout(anchor, vec3(...factors)),
        ),
      );
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
    if (!record || !operation.result) return;
    this.#last = {
      selection: operation.selection,
      box: operation.box,
      grip: operation.grip,
      aboutCenter: operation.aboutCenter,
      uniform: operation.uniform,
      factors: operation.factors,
      record,
    };
    editor.session.setSelection(Selection.of(refsOfResult(operation.result)));
  }
}

const BOX_EDGES: readonly (readonly [Axis3, Axis3])[] = [
  [
    [0, 0, 0],
    [1, 0, 0],
  ],
  [
    [1, 0, 0],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [0, 0, 0],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
  ],
  [
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [0, 1, 1],
    [0, 0, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [1, 0, 1],
  ],
  [
    [1, 1, 0],
    [1, 1, 1],
  ],
  [
    [0, 1, 0],
    [0, 1, 1],
  ],
];
