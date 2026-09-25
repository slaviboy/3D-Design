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

import type { DefinitionId } from '../../kernel/ids';
import type { Aabb } from '../../kernel/math/aabb';
import { invertAffine, transformDirection, transformNormal, transformPoint } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { cross, distance, dot, normalize, scale, sub, type Vec3, add } from '../../kernel/math/vec3';
import { EPS_LEN } from '../../kernel/tolerance';
import type { ModelDocument, TransactionRecord } from '../../kernel/model/ModelDocument';
import { formatLength } from '../../kernel/units/units';
import { cameraBasis, rayThroughScreen, type ScreenPoint } from '../camera/camera';
import type { Editor } from '../Editor';
import {
  axisOf,
  infer,
  type Axis,
  type Inference,
  type InferenceKind,
  axisFrameOf,
  WORLD_AXIS_FRAME,
  type AxisFrame,
} from '../inference/inference';
import { exclusionForChanges, type InferenceExclusion } from '../inference/exclusion';
import { sectionClipping, type SectionClipping } from '../picking/sectionClip';
import { isOccluded, visibilityRules } from '../picking/visibility';
import type { InferenceMarker, PointerInput, PreviewLineStyle } from './Tool';

/** Inferences that name a point of the model; the others stand for wherever the pointer is. */
export const POINT_INFERENCE_KINDS: ReadonlySet<InferenceKind> = new Set<InferenceKind>([
  'endpoint',
  'midpoint',
  'center',
  'on-edge',
  'origin',
]);

/** Below this |forward·Z| the camera counts as looking sideways, and free drawing uses a vertical plane. */
const SIDEWAYS_VIEW_Z = 0.35;

export interface InferOptions {
  readonly anchor?: Vec3;
  readonly lockDirection?: Vec3 | null;
  readonly fallbackPlane?: Plane;
  /** Geometry the operation is changing, which the pointer doesn't snap to. */
  readonly exclude?: InferenceExclusion;
}

/** Inference tolerance for touch, in pixels (10 for a mouse): a finger covers what it points at. */
export const TOUCH_INFERENCE_TOLERANCE_PX = 18;

/** How many recently hovered points and edges linear inferences refer to. */
const REMEMBERED_POINTS = 2;
const REMEMBERED_EDGES = 1;

interface InferenceMemory {
  doc: ModelDocument;
  points: Vec3[];
  edges: { readonly a: Vec3; readonly b: Vec3 }[];
}

const memories = new WeakMap<Editor, InferenceMemory>();

function memoryFor(editor: Editor): InferenceMemory {
  const doc = editor.session.doc;
  let memory = memories.get(editor);
  if (memory?.doc !== doc) {
    memory = { doc, points: [], edges: [] };
    memories.set(editor, memory);
  }
  return memory;
}

/** Remembers the points and edges the pointer snapped to, for later parallel, extension and from-point inferences. */
function remember(memory: InferenceMemory, inference: Inference): void {
  const { kind, point, edge } = inference;
  if (kind === 'endpoint' || kind === 'midpoint' || kind === 'center') {
    if (!memory.points.some((known) => distance(known, point) <= EPS_LEN)) {
      memory.points = [point, ...memory.points].slice(0, REMEMBERED_POINTS);
    }
  }
  if (edge && (kind === 'endpoint' || kind === 'midpoint' || kind === 'on-edge')) {
    const known = memory.edges.some(
      (other) => distance(other.a, edge.a) <= EPS_LEN && distance(other.b, edge.b) <= EPS_LEN,
    );
    if (!known) memory.edges = [edge, ...memory.edges].slice(0, REMEMBERED_EDGES);
  }
}

const boundsCaches = new WeakMap<
  ModelDocument,
  { readonly revision: number; readonly cache: Map<DefinitionId, Aabb> }
>();

/**
 * Definition bounds for ray queries, kept while the document is unchanged: they cost a pass over every vertex, and
 * each pointer move makes several queries.
 */
export function boundsCacheFor(editor: Editor): Map<DefinitionId, Aabb> {
  const { session } = editor;
  const entry = boundsCaches.get(session.doc);
  if (entry?.revision === session.revision) return entry.cache;
  const cache = new Map<DefinitionId, Aabb>();
  boundsCaches.set(session.doc, { revision: session.revision, cache });
  return cache;
}

/** The section cuts picking and inference respect in the active context. */
export function sessionClipping(editor: Editor): SectionClipping {
  const { session } = editor;
  return sectionClipping(session.doc, session.editPath, session.showSectionCuts);
}

export function inferAt(editor: Editor, screen: ScreenPoint, options: InferOptions = {}): Inference {
  const { session } = editor;
  const memory = memoryFor(editor);
  const inference = infer(session.doc, session.activeContext, session.activeContextTransform, {
    camera: session.camera,
    size: editor.viewportSize,
    screen,
    references: memory,
    clip: sessionClipping(editor),
    boundsCache: boundsCacheFor(editor),
    ...(editor.pointerKind === 'touch' ? { tolerancePx: TOUCH_INFERENCE_TOLERANCE_PX } : {}),
    ...(options.anchor ? { anchor: options.anchor } : {}),
    ...(options.lockDirection ? { lockDirection: options.lockDirection } : {}),
    ...(options.fallbackPlane ? { fallbackPlane: options.fallbackPlane } : {}),
    ...(options.exclude ? { exclude: options.exclude } : {}),
  });
  remember(memory, inference);
  return inference;
}

/** Whether the camera sees a world point, or a face of the active context hides it (X-ray and wireframe hide nothing). */
export function isVisibleFromCamera(editor: Editor, point: Vec3): boolean {
  const { session } = editor;
  if (!visibilityRules(session.doc.style).occlusion) return true;
  return !isOccluded(point, {
    doc: session.doc,
    context: session.activeContext,
    contextTransform: session.activeContextTransform,
    camera: session.camera,
    size: editor.viewportSize,
    clip: sessionClipping(editor),
    boundsCache: boundsCacheFor(editor),
  });
}

function worldToLocal(editor: Editor) {
  const inverse = invertAffine(editor.session.activeContextTransform);
  if (!inverse) throw new Error('The open group has a singular transform');
  return inverse;
}

export function toLocalPoint(editor: Editor, point: Vec3): Vec3 {
  return transformPoint(worldToLocal(editor), point);
}

export function toLocalDirection(editor: Editor, direction: Vec3): Vec3 {
  return transformDirection(worldToLocal(editor), direction);
}

/** A unit normal in active-context coordinates. */
export function toLocalNormal(editor: Editor, normal: Vec3): Vec3 {
  const local = transformNormal(worldToLocal(editor), normal);
  return (local && normalize(local)) ?? normal;
}

/** A unit normal in world coordinates, from active-context coordinates. */
export function toWorldNormal(editor: Editor, normal: Vec3): Vec3 {
  const world = transformNormal(editor.session.activeContextTransform, normal);
  return (world && normalize(world)) ?? normal;
}

/** The document's drawing axes. */
export function modelFrame(editor: Editor): AxisFrame {
  return axisFrameOf(editor.session.doc);
}

/** World position of coordinates typed relative to the drawing axes, as in `[1m, 2m, 0]`. */
export function modelPoint(editor: Editor, coordinates: Vec3): Vec3 {
  const { origin, x, y, z } = modelFrame(editor);
  return add(origin, add(scale(x, coordinates.x), add(scale(y, coordinates.y), scale(z, coordinates.z))));
}

export function lineStyleFor(axis: Axis | undefined): PreviewLineStyle {
  return axis ? `axis-${axis}` : 'preview';
}

export function markerFor(inference: Inference | null): InferenceMarker | null {
  if (!inference || inference.kind === 'free') return null;
  return { point: inference.point, kind: inference.kind, label: inference.label };
}

/** Arrow keys lock drawing to a drawing axis: up blue, right red, left green. */
export function axisForArrowKey(chord: string, editor: Editor): Vec3 | null {
  const frame = modelFrame(editor);
  switch (chord) {
    case 'ArrowUp':
      return frame.z;
    case 'ArrowRight':
      return frame.x;
    case 'ArrowLeft':
      return frame.y;
    default:
      return null;
  }
}

/** The key that toggles copy (Move), keep-start-face (Push/Pull) and soften (Eraser): Option on macOS, Ctrl elsewhere. */
export function toggleModifier(input: Pick<PointerInput, 'ctrlKey' | 'altKey'>, editor: Editor): boolean {
  return editor.platform === 'mac' ? input.altKey : input.ctrlKey;
}

export function toggleModifierName(editor: Editor): string {
  return editor.platform === 'mac' ? 'Option' : 'Ctrl';
}

/**
 * The plane a planar shape is drawn on, in world coordinates: the face under the cursor, otherwise the ground
 * plane through the point, or a vertical axis plane when the camera looks sideways.
 */
export function drawingPlane(editor: Editor, inference: Inference): Plane {
  if (inference.facePlane) return inference.facePlane;
  const forward = cameraBasis(editor.session.camera).forward;
  const frame = modelFrame(editor);
  let normal = frame.z;
  if (Math.abs(dot(forward, frame.z)) < SIDEWAYS_VIEW_Z) {
    normal = Math.abs(dot(forward, frame.x)) > Math.abs(dot(forward, frame.y)) ? frame.x : frame.y;
  }
  return planeFromPointNormal(inference.point, normal);
}

/** Two in-plane unit directions for a plane normal, aligned with the drawing axes where possible. */
export function planeAxes(normal: Vec3, frame: AxisFrame = WORLD_AXIS_FRAME): { u: Vec3; v: Vec3 } {
  const axis = axisOf(normal, frame);
  if (axis === 'z') return { u: frame.x, v: frame.y };
  if (axis === 'x') return { u: frame.y, v: frame.z };
  if (axis === 'y') return { u: frame.x, v: frame.z };
  const u = normalize(cross(frame.z, normal)) ?? frame.x;
  return { u, v: cross(normal, u) };
}

export function projectOntoPlane(plane: Plane, point: Vec3): Vec3 {
  return sub(point, scale(plane.normal, dot(plane.normal, point) - plane.offset));
}

/** Where the pointer's ray meets a world plane, or null when it runs parallel to it or points away. */
export function pointOnPlaneUnder(editor: Editor, screen: ScreenPoint, plane: Plane): Vec3 | null {
  const ray = rayThroughScreen(editor.session.camera, screen, editor.viewportSize);
  const denominator = dot(plane.normal, ray.direction);
  if (Math.abs(denominator) < 1e-12) return null;
  const t = (plane.offset - dot(plane.normal, ray.origin)) / denominator;
  return t > 0 && Number.isFinite(t) ? add(ray.origin, scale(ray.direction, t)) : null;
}

export function formatDistance(editor: Editor, meters: number): string {
  return formatLength(meters, editor.units);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A model edit that is tried out while the pointer moves. Each `run` first undoes the previous attempt, so the
 * preview is always the real result of the operation. `commit` keeps the last attempt as an undo step.
 */
export class Speculation {
  readonly #doc: ModelDocument;
  #record: TransactionRecord | undefined;

  constructor(doc: ModelDocument) {
    this.#doc = doc;
  }

  get active(): boolean {
    return this.#record !== undefined;
  }

  /** The current attempt, while there is one. */
  get record(): TransactionRecord | undefined {
    return this.#record;
  }

  /** Replaces the previous attempt with `edit`. If `edit` throws, the model is left without any attempt. */
  run<T>(edit: () => T): T {
    this.rollback();
    const before = this.#doc.lastTransaction;
    const result = edit();
    const after = this.#doc.lastTransaction;
    this.#record = after !== before ? after : undefined;
    return result;
  }

  rollback(): void {
    if (this.#record && this.#doc.lastTransaction === this.#record) this.#doc.rollbackLastTransaction();
    this.#record = undefined;
  }

  /** Keeps the current attempt. Returns its history record, if it changed anything. */
  commit(): TransactionRecord | undefined {
    const record = this.#record;
    this.#record = undefined;
    return record;
  }
}

/**
 * What a tool's own preview put into the model: it sits under the pointer, so inference must not snap to it (see
 * `exclusionForChanges`). It still hides what lies behind it, as it does on screen. Tools that don't take their result
 * from the face under the pointer pass `faceTargets: false`, so the preview's faces keep showing the On Face marker.
 */
export function previewExclusion(
  editor: Editor,
  speculation: Speculation,
  options: { readonly faceTargets?: boolean } = {},
): InferenceExclusion {
  const { session } = editor;
  const exclusion = exclusionForChanges(
    session.doc.store(session.activeContext),
    session.activeContext,
    speculation.record,
  );
  return options.faceTargets === false ? { ...exclusion, faceTargets: null } : exclusion;
}

/**
 * Lets typed values replace the operation a tool just finished, as long as nothing else has happened since:
 * the tool undoes its own last step without a redo entry and runs again with the new value.
 */
export function canReplace(
  doc: ModelDocument,
  record: TransactionRecord | undefined,
): record is TransactionRecord {
  return record !== undefined && doc.lastTransaction === record && !doc.isInTransaction;
}
