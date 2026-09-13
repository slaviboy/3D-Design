import { invertAffine, transformDirection, transformNormal, transformPoint } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { AXIS_X, AXIS_Y, AXIS_Z, cross, dot, normalize, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument, TransactionRecord } from '../../kernel/model/ModelDocument';
import { formatLength } from '../../kernel/units/units';
import { cameraBasis, type ScreenPoint } from '../camera/camera';
import type { Editor } from '../Editor';
import { axisOf, infer, type Axis, type Inference } from '../inference/inference';
import type { InferenceMarker, PointerInput, PreviewLineStyle } from './Tool';

/** Below this |forward·Z| the camera counts as looking sideways, and free drawing uses a vertical plane. */
const SIDEWAYS_VIEW_Z = 0.35;

export interface InferOptions {
  readonly anchor?: Vec3;
  readonly lockDirection?: Vec3 | null;
  readonly fallbackPlane?: Plane;
}

export function inferAt(editor: Editor, screen: ScreenPoint, options: InferOptions = {}): Inference {
  const { session } = editor;
  return infer(session.doc, session.activeContext, session.activeContextTransform, {
    camera: session.camera,
    size: editor.viewportSize,
    screen,
    ...(options.anchor ? { anchor: options.anchor } : {}),
    ...(options.lockDirection ? { lockDirection: options.lockDirection } : {}),
    ...(options.fallbackPlane ? { fallbackPlane: options.fallbackPlane } : {}),
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

export const AXIS_DIRECTIONS: Readonly<Record<Axis, Vec3>> = { x: AXIS_X, y: AXIS_Y, z: AXIS_Z };

export function lineStyleFor(axis: Axis | undefined): PreviewLineStyle {
  return axis ? `axis-${axis}` : 'preview';
}

export function lineStyleBetween(a: Vec3, b: Vec3): PreviewLineStyle {
  return lineStyleFor(axisOf(sub(b, a)));
}

export function markerFor(inference: Inference | null): InferenceMarker | null {
  if (!inference || inference.kind === 'free') return null;
  return { point: inference.point, kind: inference.kind, label: inference.label };
}

/** Arrow keys lock drawing to an axis: up blue (Z), right red (X), left green (Y). */
export function axisForArrowKey(chord: string): Vec3 | null {
  switch (chord) {
    case 'ArrowUp':
      return AXIS_Z;
    case 'ArrowRight':
      return AXIS_X;
    case 'ArrowLeft':
      return AXIS_Y;
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
  let normal = AXIS_Z;
  if (Math.abs(forward.z) < SIDEWAYS_VIEW_Z)
    normal = Math.abs(forward.x) > Math.abs(forward.y) ? AXIS_X : AXIS_Y;
  return planeFromPointNormal(inference.point, normal);
}

/** Two in-plane unit directions for a plane normal, aligned with the world axes where possible. */
export function planeAxes(normal: Vec3): { u: Vec3; v: Vec3 } {
  const axis = axisOf(normal);
  if (axis === 'z') return { u: AXIS_X, v: AXIS_Y };
  if (axis === 'x') return { u: AXIS_Y, v: AXIS_Z };
  if (axis === 'y') return { u: AXIS_X, v: AXIS_Z };
  const u = normalize(cross(AXIS_Z, normal)) ?? AXIS_X;
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
