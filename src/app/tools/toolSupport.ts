import { invertAffine, transformDirection, transformNormal, transformPoint } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { cross, distance, dot, normalize, scale, sub, type Vec3, add } from '../../kernel/math/vec3';
import { EPS_LEN } from '../../kernel/tolerance';
import type { ModelDocument, TransactionRecord } from '../../kernel/model/ModelDocument';
import { formatLength } from '../../kernel/units/units';
import { cameraBasis, type ScreenPoint } from '../camera/camera';
import type { Editor } from '../Editor';
import {
  axisOf,
  infer,
  type Axis,
  type Inference,
  axisFrameOf,
  WORLD_AXIS_FRAME,
  type AxisFrame,
} from '../inference/inference';
import type { InferenceMarker, PointerInput, PreviewLineStyle } from './Tool';

/** Below this |forward·Z| the camera counts as looking sideways, and free drawing uses a vertical plane. */
const SIDEWAYS_VIEW_Z = 0.35;

export interface InferOptions {
  readonly anchor?: Vec3;
  readonly lockDirection?: Vec3 | null;
  readonly fallbackPlane?: Plane;
}

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

export function inferAt(editor: Editor, screen: ScreenPoint, options: InferOptions = {}): Inference {
  const { session } = editor;
  const memory = memoryFor(editor);
  const inference = infer(session.doc, session.activeContext, session.activeContextTransform, {
    camera: session.camera,
    size: editor.viewportSize,
    screen,
    references: memory,
    ...(options.anchor ? { anchor: options.anchor } : {}),
    ...(options.lockDirection ? { lockDirection: options.lockDirection } : {}),
    ...(options.fallbackPlane ? { fallbackPlane: options.fallbackPlane } : {}),
  });
  remember(memory, inference);
  return inference;
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
 * Lets typed values replace the operation a tool just finished, as long as nothing else has happened since:
 * the tool undoes its own last step without a redo entry and runs again with the new value.
 */
export function canReplace(
  doc: ModelDocument,
  record: TransactionRecord | undefined,
): record is TransactionRecord {
  return record !== undefined && doc.lastTransaction === record && !doc.isInTransaction;
}
