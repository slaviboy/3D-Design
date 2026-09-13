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

import type { EdgeId, FaceId } from '../../kernel/ids';
import { classifyPointInPolygon } from '../../kernel/math/geom2d';
import { transformPoint } from '../../kernel/math/mat4';
import { planeBasis, planeFromPointNormal, projectTo2D, type Plane } from '../../kernel/math/plane';
import { distancePointToSegment } from '../../kernel/math/segment';
import { cross, dot, length, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { offsetEdges, offsetFace } from '../../kernel/ops/offset';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import type { Editor } from '../Editor';
import type { Inference } from '../inference/inference';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  PRIMARY_BUTTON,
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
  planeAxes,
  projectOntoPlane,
  Speculation,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  toWorldNormal,
} from './toolSupport';

export const OFFSET_TOOL_ID = 'tool.offset';

type Source =
  | { readonly kind: 'face'; readonly face: FaceId }
  | { readonly kind: 'edges'; readonly edges: readonly EdgeId[] };

/** The offset's reference geometry in world coordinates. */
interface Outline {
  readonly plane: Plane;
  /** For a face: outer loop then holes. For edges: each edge as a two-point list. */
  readonly loops: readonly (readonly Vec3[])[];
  /** Start and end of the first edge of an edge chain; its left side is the positive side. */
  readonly firstEdge: readonly [Vec3, Vec3] | null;
}

interface Operation {
  readonly source: Source;
  readonly outline: Outline;
  readonly startDistance: number;
  readonly speculation: Speculation;
  readonly pressX: number;
  readonly pressY: number;
  /** World distance: positive toward the face interior, or to the left of an edge chain. */
  distance: number;
  keepOverlaps: boolean;
  dragged: boolean;
  inference: Inference | null;
  error: string | null;
}

interface Finished {
  readonly source: Source;
  readonly outline: Outline;
  readonly distance: number;
  readonly keepOverlaps: boolean;
  readonly record: TransactionRecord;
}

const MIN_OFFSET = EPS_LEN;

/**
 * Offsets a face's edges inward or outward, or a chain of selected coplanar edges to one side. Click the face (or
 * near the selected edges), move to set the distance and click, or type it. Double-click a face to repeat the last
 * offset. The toggle key keeps overlapping parts.
 */
export class OffsetTool implements Tool {
  readonly id = OFFSET_TOOL_ID;
  readonly label = 'Offset';
  readonly cursor = 'crosshair';

  #hover: FaceId | null = null;
  #operation: Operation | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      this.#hover = this.#selectedEdges(editor).length > 0 ? null : this.#faceAt(editor, input);
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX) {
      operation.dragged = true;
    }
    operation.keepOverlaps = toggleModifier(input, editor);
    const point = this.#pointOnPlane(editor, input, operation);
    this.#apply(
      editor,
      operation,
      this.#signedDistance(operation.source, operation.outline, point) - operation.startDistance,
    );
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const operation = this.#operation;
    if (operation) {
      if (input.detail >= 2 && Math.abs(operation.distance) <= MIN_OFFSET) {
        this.cancel();
        this.#repeat(editor, input);
        return;
      }
      this.#commit(editor, operation);
      return;
    }
    const edges = this.#selectedEdges(editor);
    const face = edges.length > 0 ? null : this.#faceAt(editor, input);
    const source: Source | null =
      edges.length > 0 ? { kind: 'edges', edges } : face !== null ? { kind: 'face', face } : null;
    if (!source) return;
    const outline = this.#outline(editor, source, input);
    if (!outline) return;
    const pressPoint = projectOntoPlane(
      outline.plane,
      inferAt(editor, input, { fallbackPlane: outline.plane }).point,
    );
    this.#operation = {
      source,
      outline,
      startDistance: this.#signedDistance(source, outline, pressPoint),
      speculation: new Speculation(editor.session.doc),
      pressX: input.x,
      pressY: input.y,
      distance: 0,
      keepOverlaps: toggleModifier(input, editor),
      dragged: false,
      inference: null,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
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
    const distance = this.#operation?.distance ?? this.#last?.distance ?? null;
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
      const sign = operation.distance < -MIN_OFFSET ? -1 : 1;
      this.#apply(editor, operation, sign * intent.value);
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record))
      throw new Error('Click a face or selected edges to offset first');
    doc.rollbackLastTransaction();
    this.#last = null;
    const distance = (last.distance < 0 ? -1 : 1) * intent.value;
    this.#run(editor, last.source, last.outline, distance, last.keepOverlaps);
    const record = doc.lastTransaction;
    if (record) this.#last = { ...last, distance, record };
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
    return operation
      ? `Move to set the offset distance and click, or type it. ${toggleModifierName(editor)} keeps overlaps.`
      : 'Click a face, or select coplanar edges first, to offset them. Double-click a face to repeat the last offset.';
  }

  #selectedEdges(editor: Editor): EdgeId[] {
    const { selection } = editor.session;
    return selection.count('face') === 0 && selection.count('instance') === 0
      ? (selection.ids('edge') as EdgeId[])
      : [];
  }

  #faceAt(editor: Editor, input: PointerInput): FaceId | null {
    const hit = editor.pickAt(input, { edgeTolerancePx: 0 });
    return hit?.ref.kind === 'face' ? (hit.ref.id as FaceId) : null;
  }

  #outline(editor: Editor, source: Source, input: PointerInput): Outline | null {
    const { session } = editor;
    const store = session.doc.store(session.activeContext);
    const toWorld = session.activeContextTransform;
    const world = (point: Vec3): Vec3 => transformPoint(toWorld, point);
    if (source.kind === 'face') {
      const localPlane = store.getFacePlane(source.face);
      const loops = store.faceLoops(source.face).map((loop) => store.loopPoints(loop).map(world));
      const anchor = loops[0]?.[0];
      if (!anchor) return null;
      return {
        plane: planeFromPointNormal(anchor, toWorldNormal(editor, localPlane.normal)),
        loops,
        firstEdge: null,
      };
    }
    const loops = source.edges.map((id) => {
      const edge = store.getEdge(id);
      return [world(store.position(edge.v0)), world(store.position(edge.v1))];
    });
    const [first] = loops;
    const a = first?.[0];
    const b = first?.[1];
    if (!a || !b) return null;
    const faceNormal = inferAt(editor, input).facePlane?.normal;
    let normal: Vec3 | null = null;
    for (const [p, q] of loops.map((points) => [points[0], points[1]] as const)) {
      if (!p || !q || normal) continue;
      const candidate = cross(sub(b, a), sub(q, p));
      if (length(candidate) > EPS_LEN) normal = scale(candidate, 1 / length(candidate));
    }
    const plane = planeFromPointNormal(a, faceNormal ?? normal ?? planeAxes(sub(b, a)).v);
    return { plane, loops, firstEdge: [a, b] };
  }

  #pointOnPlane(editor: Editor, input: PointerInput, operation: Operation): Vec3 {
    const inference = inferAt(editor, input, { fallbackPlane: operation.outline.plane });
    operation.inference = inference;
    return projectOntoPlane(operation.outline.plane, inference.point);
  }

  /** Distance from the outline: positive inside a face, or on the left of an edge chain. */
  #signedDistance(source: Source, outline: Outline, point: Vec3): number {
    let nearest = Infinity;
    for (const loop of outline.loops) {
      const count = source.kind === 'face' ? loop.length : loop.length - 1;
      for (let i = 0; i < count; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        if (a && b) nearest = Math.min(nearest, distancePointToSegment(point, a, b));
      }
    }
    if (!Number.isFinite(nearest)) return 0;
    if (source.kind === 'face') {
      const basis = planeBasis(outline.plane.normal);
      const [outer = [], ...inners] = outline.loops.map((loop) => loop.map((p) => projectTo2D(basis, p)));
      const position = classifyPointInPolygon(projectTo2D(basis, point), outer, inners);
      return position === 'outside' ? -nearest : nearest;
    }
    const edge = outline.firstEdge;
    if (!edge) return nearest;
    const side = dot(cross(sub(edge[1], edge[0]), sub(point, edge[0])), outline.plane.normal);
    return side >= 0 ? nearest : -nearest;
  }

  #run(editor: Editor, source: Source, outline: Outline, worldDistance: number, keepOverlaps: boolean): void {
    const { session } = editor;
    const localDistance =
      Math.sign(worldDistance) *
      length(toLocalDirection(editor, scale(planeAxes(outline.plane.normal).u, Math.abs(worldDistance))));
    if (source.kind === 'face') {
      offsetFace(session.doc, session.activeContext, source.face, localDistance, { keepOverlaps });
    } else {
      const normal = toLocalDirection(editor, outline.plane.normal);
      offsetEdges(session.doc, session.activeContext, source.edges, localDistance, normal);
    }
  }

  #apply(editor: Editor, operation: Operation, distance: number): void {
    operation.distance = distance;
    operation.error = null;
    try {
      if (Math.abs(distance) <= MIN_OFFSET) {
        operation.speculation.rollback();
        return;
      }
      operation.speculation.run(() => {
        this.#run(editor, operation.source, operation.outline, distance, operation.keepOverlaps);
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
      source: operation.source,
      outline: operation.outline,
      distance: operation.distance,
      keepOverlaps: operation.keepOverlaps,
      record,
    };
  }

  #repeat(editor: Editor, input: PointerInput): void {
    const last = this.#last;
    const face = this.#faceAt(editor, input);
    if (!last || face === null) return;
    const source: Source = { kind: 'face', face };
    const outline = this.#outline(editor, source, input);
    if (!outline) return;
    try {
      this.#run(editor, source, outline, last.distance, last.keepOverlaps);
      const record = editor.session.doc.lastTransaction;
      if (record)
        this.#last = { source, outline, distance: last.distance, keepOverlaps: last.keepOverlaps, record };
    } catch (error) {
      editor.notify('error', errorMessage(error));
    }
  }
}
