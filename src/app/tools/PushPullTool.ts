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

import type { FaceId } from '../../kernel/ids';
import { distance, dot, normalize, scale, sub, type Vec3, add } from '../../kernel/math/vec3';
import type { TransactionRecord } from '../../kernel/model/ModelDocument';
import { pushPull, pushPullLimit, type PushPullLimit } from '../../kernel/ops/pushPull';
import { EPS_LEN } from '../../kernel/tolerance';
import type { MeasurementIntent } from '../../kernel/vcb/parseMeasurement';
import { projectToScreen, rayThroughScreen } from '../camera/camera';
import type { Editor } from '../Editor';
import { combineExclusions, exclusionForBoundary, type InferenceExclusion } from '../inference/exclusion';
import { closestPointOnLineToRay, type Inference } from '../inference/inference';
import { DRAG_THRESHOLD_PX } from './SelectTool';
import {
  PRIMARY_BUTTON,
  PUSH_PULL_TOOL_ID,
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
  inferenceTolerancePx,
  markerFor,
  POINT_INFERENCE_KINDS,
  previewExclusion,
  Speculation,
  toggleModifier,
  toggleModifierName,
  toLocalDirection,
  toWorldNormal,
} from './toolSupport';

/** Where a push into the face stops, in world units (see `pushPullLimit`). */
interface Stop {
  readonly distance: number;
  readonly kind: PushPullLimit['kind'];
}

/** The stop when the face moves, and when the starting face is kept (Ctrl), which never flattens walls. */
interface Stops {
  readonly moving: Stop | null;
  readonly keeping: Stop | null;
}

interface Operation {
  readonly face: FaceId;
  /** World point where the face was picked. */
  readonly origin: Vec3;
  /** World unit normal of the face. */
  readonly normal: Vec3;
  readonly pressX: number;
  readonly pressY: number;
  readonly speculation: Speculation;
  /** The face's own outline, which the distance never snaps to. */
  readonly exclusion: InferenceExclusion;
  /** How far the face can be pushed in before it stops, if it does. */
  readonly stops: Stops;
  /** World distance along the normal. */
  distance: number;
  /** The pointer is past where the push stops, and it stays there. */
  limited: boolean;
  /** The same distance in active-context units, as passed to the kernel. */
  localDistance: number;
  keepOriginal: boolean;
  dragged: boolean;
  inference: Inference | null;
  /** The last point the distance snapped to, kept while the pointer stays within reach of it. */
  snap: Inference | null;
  error: string | null;
}

interface Finished {
  readonly face: FaceId;
  readonly normal: Vec3;
  /** Distance along the face normal in active-context units, reused by double-click. */
  readonly localDistance: number;
  readonly worldDistance: number;
  readonly keepOriginal: boolean;
  readonly record: TransactionRecord | undefined;
  /** The operation's {@link Operation.stops}, for typed values that replace it. */
  readonly stops: Stops;
}

/** How much further out than its snapping reach an edge snap lets go of the pointer. */
const EDGE_HOLD_REACH = 1.5;
/** How much nearer another point must be to take over from a held snap, as a share of the snapping reach. */
const SWITCH_MARGIN = 0.5;

function sameEdge(a: Inference, b: Inference): boolean {
  const [p, q] = [a.edge, b.edge];
  if (!p || !q) return false;
  return (
    (distance(p.a, q.a) <= EPS_LEN && distance(p.b, q.b) <= EPS_LEN) ||
    (distance(p.a, q.b) <= EPS_LEN && distance(p.b, q.a) <= EPS_LEN)
  );
}

function screenDistanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0), 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function stopFor(stops: Stops, keepOriginal: boolean): Stop | null {
  return keepOriginal ? stops.keeping : stops.moving;
}

/**
 * Extrudes or moves a face along its normal. Click a face, move, and click again (or drag and release). Typing a
 * distance finishes the operation, and typing again right after replaces it. Double-clicking a face repeats the last
 * distance.
 */
export class PushPullTool implements Tool {
  readonly id = PUSH_PULL_TOOL_ID;
  readonly label = 'Push/Pull';
  readonly cursor = 'ns-resize';

  #hover: FaceId | null = null;
  #operation: Operation | null = null;
  #last: Finished | null = null;

  pointerMove(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (!operation) {
      this.#hover = this.#faceAt(input, editor);
      return;
    }
    if (Math.hypot(input.x - operation.pressX, input.y - operation.pressY) > DRAG_THRESHOLD_PX)
      operation.dragged = true;
    operation.keepOriginal = toggleModifier(input, editor);
    const inference = inferAt(editor, input, {
      // A face follows the pointer along its normal: points on the axes' lines would make it jump.
      drawingAxes: false,
      // It moves along its own normal: lines through remembered points (From Point) and the like don't apply.
      linear: false,
      // The extrusion follows the pointer and would catch it; it still hides what lies behind it.
      exclude: combineExclusions(
        operation.exclusion,
        previewExclusion(editor, operation.speculation, { faceTargets: false }),
      ),
    });
    operation.inference = this.#holdSnap(editor, operation, input, inference);
    const snapped = POINT_INFERENCE_KINDS.has(operation.inference.kind)
      ? operation.inference.point
      : closestPointOnLineToRay(
          operation.origin,
          operation.normal,
          rayThroughScreen(editor.session.camera, input, editor.viewportSize),
        );
    this.#apply(editor, operation, dot(sub(snapped, operation.origin), operation.normal));
  }

  pointerDown(input: PointerInput, editor: Editor): void {
    if (input.button !== PRIMARY_BUTTON) return;
    const operation = this.#operation;
    if (operation) {
      if (input.detail >= 2 && Math.abs(operation.distance) <= EPS_LEN) {
        this.cancel();
        this.#repeat(input, editor);
        return;
      }
      this.#commit(editor, operation);
      return;
    }
    const face = this.#faceAt(input, editor);
    if (face === null) return;
    const hit = editor.pickAt(input);
    const store = editor.session.doc.store(editor.session.activeContext);
    const plane = store.getFacePlane(face);
    const normal = toWorldNormal(editor, plane.normal);
    this.#operation = {
      face,
      origin: hit?.point ?? editor.session.camera.target,
      normal,
      pressX: input.x,
      pressY: input.y,
      speculation: new Speculation(editor.session.doc),
      exclusion: exclusionForBoundary(store, { faces: [face] }),
      stops: this.#stops(editor, face, normal),
      limited: false,
      distance: 0,
      localDistance: 0,
      keepOriginal: toggleModifier(input, editor),
      dragged: false,
      inference: null,
      snap: null,
      error: null,
    };
  }

  pointerUp(input: PointerInput, editor: Editor): void {
    const operation = this.#operation;
    if (operation?.dragged && input.button === PRIMARY_BUTTON) this.#commit(editor, operation);
  }

  busy(): boolean {
    return this.#operation !== null;
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
    const operation = this.#operation;
    const distance = operation ? operation.distance : (this.#last?.worldDistance ?? null);
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
      const sign =
        Math.abs(operation.distance) > EPS_LEN
          ? Math.sign(operation.distance)
          : this.#towardCamera(editor, operation.origin, operation.normal);
      this.#refusePastStop(editor, stopFor(operation.stops, operation.keepOriginal), sign * intent.value);
      this.#apply(editor, operation, sign * intent.value);
      if (operation.error !== null) throw new Error(operation.error);
      this.#commit(editor, operation);
      return;
    }
    const last = this.#last;
    const doc = editor.session.doc;
    if (!last || !canReplace(doc, last.record)) throw new Error('Click a face to push or pull first');
    const worldDistance = Math.sign(last.worldDistance) * intent.value;
    this.#refusePastStop(editor, stopFor(last.stops, last.keepOriginal), worldDistance);
    doc.rollbackLastTransaction();
    const localDistance = this.#localDistance(editor, last.normal, worldDistance, last.face);
    try {
      pushPull(doc, editor.session.activeContext, last.face, localDistance, {
        createNewStartFace: last.keepOriginal,
      });
    } catch (error) {
      this.#last = null;
      throw error;
    }
    this.#last = { ...last, localDistance, worldDistance, record: doc.lastTransaction };
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
    if (operation?.limited) {
      const distance = formatDistance(editor, Math.abs(operation.distance));
      return stopFor(operation.stops, operation.keepOriginal)?.kind === 'flush'
        ? `Offset limited to ${distance}: the face is flush there. Click to flatten it.`
        : `Offset limited to ${distance}: this is the far side. Click to cut through.`;
    }
    return operation
      ? `Move to set the distance, then click, or type a distance. ${toggleModifierName(editor)} keeps the starting face.`
      : 'Click a face to push or pull it. Double-click a face to repeat the last distance.';
  }

  /**
   * Keeps the last point snap while the pointer stays by it, when this move offers none. The preview the snap produced
   * may have taken its target away: a push landing on the bottom takes the bottom's edges with it. And a finger moving
   * along an edge keeps crossing the rim of its snapping reach. Dropping the snap would each time swap the snapped
   * height for wherever the pointer ray passes the face's line, far off when the pointer is over other geometry, and
   * the face would flicker between the two.
   */
  #holdSnap(editor: Editor, operation: Operation, input: PointerInput, inference: Inference): Inference {
    const held = operation.snap ? this.#stillBy(editor, operation.snap, input) : null;
    // Another point takes over only when the pointer is clearly nearer to it: two edges a few pixels apart on screen
    // (the top and bottom of a wall seen from high up) would otherwise trade places at every tremble of a finger.
    if (
      POINT_INFERENCE_KINDS.has(inference.kind) &&
      (!held || sameEdge(held, inference) || this.#clearlyNearer(editor, input, inference, held))
    ) {
      operation.snap = inference;
      return inference;
    }
    operation.snap = held;
    return held ?? inference;
  }

  #clearlyNearer(editor: Editor, input: PointerInput, candidate: Inference, held: Inference): boolean {
    const { camera } = editor.session;
    const size = editor.viewportSize;
    const at = projectToScreen(camera, candidate.point, size);
    const heldAt = projectToScreen(camera, held.point, size);
    if (!at || !heldAt) return true;
    const pixels = (p: { x: number; y: number }) => Math.hypot(p.x - input.x, p.y - input.y);
    return pixels(at) + SWITCH_MARGIN * inferenceTolerancePx(editor) < pixels(heldAt);
  }

  /**
   * The held snap for this pointer position, or null once the pointer has left it. A snap on an edge follows the
   * pointer along the edge while the pointer stays within half again the snapping reach of it, so it lets go a little
   * further out than it caught.
   */
  #stillBy(editor: Editor, held: Inference, input: PointerInput): Inference | null {
    const { camera } = editor.session;
    const size = editor.viewportSize;
    const reach = inferenceTolerancePx(editor);
    const edge = held.edge;
    if (!edge) {
      const screen = projectToScreen(camera, held.point, size);
      return screen && Math.hypot(screen.x - input.x, screen.y - input.y) <= reach ? held : null;
    }
    const a = projectToScreen(camera, edge.a, size);
    const b = projectToScreen(camera, edge.b, size);
    if (!a || !b || screenDistanceToSegment(input, a, b) > reach * EDGE_HOLD_REACH) return null;
    const direction = normalize(sub(edge.b, edge.a));
    if (!direction) return held;
    const onLine = closestPointOnLineToRay(edge.a, direction, rayThroughScreen(camera, input, size));
    const along = Math.min(Math.max(dot(sub(onLine, edge.a), direction), 0), distance(edge.a, edge.b));
    return { ...held, kind: 'on-edge', label: 'On Edge', point: add(edge.a, scale(direction, along)) };
  }

  #faceAt(input: PointerInput, editor: Editor): FaceId | null {
    const hit = editor.pickAt(input, { edgeTolerancePx: 0 });
    return hit?.ref.kind === 'face' ? (hit.ref.id as FaceId) : null;
  }

  /** A typed push past where it stops: say how far it can go, rather than stopping short of what was asked. */
  #refusePastStop(editor: Editor, stop: Stop | null, worldDistance: number): void {
    if (stop !== null && -worldDistance > stop.distance + EPS_LEN) {
      const away = formatDistance(editor, stop.distance);
      throw new Error(
        stop.kind === 'flush'
          ? `Push/Pull stops where the face is flush, ${away} away`
          : `Push/Pull stops at the face on the other side, ${away} away`,
      );
    }
  }

  #towardCamera(editor: Editor, point: Vec3, normal: Vec3): number {
    return dot(normal, sub(editor.session.camera.eye, point)) >= 0 ? 1 : -1;
  }

  /** {@link pushPullLimit} in world units: the group or component being edited may scale distances along the normal. */
  #stops(editor: Editor, face: FaceId, worldNormal: Vec3): Stops {
    const store = editor.session.doc.store(editor.session.activeContext);
    const perUnit = this.#localDistance(editor, worldNormal, 1, face);
    const inWorld = (limit: PushPullLimit | null): Stop | null =>
      limit === null ? null : { distance: limit.distance / perUnit, kind: limit.kind };
    return {
      moving: inWorld(pushPullLimit(store, face)),
      keeping: inWorld(pushPullLimit(store, face, { createNewStartFace: true })),
    };
  }

  #localDistance(editor: Editor, worldNormal: Vec3, worldDistance: number, face: FaceId): number {
    const localNormal = editor.session.doc.store(editor.session.activeContext).getFacePlane(face).normal;
    return dot(toLocalDirection(editor, scale(worldNormal, worldDistance)), localNormal);
  }

  #apply(editor: Editor, operation: Operation, requested: number): void {
    // At or past where the push stops, the face stays there, where it lands: it cuts through at the far side, and
    // flattens its walls where they end.
    const stop = stopFor(operation.stops, operation.keepOriginal);
    operation.limited = stop !== null && -requested >= stop.distance - EPS_LEN;
    const worldDistance = stop !== null && operation.limited ? -stop.distance : requested;
    operation.distance = worldDistance;
    operation.error = null;
    const { session } = editor;
    try {
      if (Math.abs(worldDistance) <= EPS_LEN) {
        operation.speculation.rollback();
        return;
      }
      operation.speculation.run(() => {
        operation.localDistance = this.#localDistance(
          editor,
          operation.normal,
          worldDistance,
          operation.face,
        );
        pushPull(session.doc, session.activeContext, operation.face, operation.localDistance, {
          createNewStartFace: operation.keepOriginal,
        });
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
      face: operation.face,
      normal: operation.normal,
      localDistance: operation.localDistance,
      worldDistance: operation.distance,
      keepOriginal: operation.keepOriginal,
      record,
      stops: operation.stops,
    };
  }

  #repeat(input: PointerInput, editor: Editor): void {
    const last = this.#last;
    const face = this.#faceAt(input, editor);
    if (!last || face === null) return;
    const { session } = editor;
    const plane = session.doc.store(session.activeContext).getFacePlane(face);
    const normal = toWorldNormal(editor, plane.normal);
    // Measured before the push changes the face.
    const stops = this.#stops(editor, face, normal);
    try {
      pushPull(session.doc, session.activeContext, face, last.localDistance, {
        createNewStartFace: last.keepOriginal,
      });
      this.#last = {
        face,
        normal,
        localDistance: last.localDistance,
        worldDistance: last.worldDistance,
        keepOriginal: last.keepOriginal,
        record: session.doc.lastTransaction,
        stops,
      };
    } catch (error) {
      editor.notify('error', errorMessage(error));
    }
  }
}
