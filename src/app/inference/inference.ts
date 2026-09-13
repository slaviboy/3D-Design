import type { DefinitionId, FaceId } from '../../kernel/ids';
import { transformDirection, transformNormal, transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { planeFromPointNormal, type Plane } from '../../kernel/math/plane';
import { closestPointsOnSegments } from '../../kernel/math/segment';
import {
  add,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  cross,
  distance,
  dot,
  length,
  lerp,
  normalize,
  scale,
  sub,
  ZERO,
  type Vec3,
} from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import {
  cameraBasis,
  pointOnTargetPlane,
  projectToScreen,
  rayThroughScreen,
  type CameraState,
  type Ray,
  type ScreenPoint,
  type ViewportSize,
} from '../camera/camera';
import { pick } from '../picking/picker';
import { traverseAlongRay } from '../picking/rayTraversal';
import type { EntityRef } from '../selection/Selection';

export type Axis = 'x' | 'y' | 'z';

export type InferenceKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'origin'
  | 'on-edge'
  | 'on-face'
  | 'on-axis'
  | 'parallel'
  | 'perpendicular'
  | 'extension'
  | 'from-point'
  | 'locked'
  | 'free';

/** Recently hovered geometry that linear inferences refer to (parallel, perpendicular, extension, from point). */
export interface InferenceReferences {
  readonly points: readonly Vec3[];
  readonly edges: readonly { readonly a: Vec3; readonly b: Vec3 }[];
}

/** The point a drawing or editing tool should use for the cursor, and why. */
export interface Inference {
  /** World coordinates. */
  readonly point: Vec3;
  readonly kind: InferenceKind;
  /** Short text for the cursor tooltip, for example "Endpoint" or "On Red Axis". Empty for free points. */
  readonly label: string;
  /** True when the point comes from geometry inside a group or component. */
  readonly inGroup: boolean;
  /** The world axis the point lies on relative to the anchor, if any. */
  readonly axis?: Axis;
  /** World-space edge the inference came from, for endpoint, midpoint and on-edge. */
  readonly edge?: { readonly a: Vec3; readonly b: Vec3 };
  /** World-space plane of the face under the cursor, for on-face inferences in the active context. */
  readonly facePlane?: Plane;
  /** The entity in the active context the point lies on, when there is one. */
  readonly entity?: EntityRef;
}

export interface InferenceRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  /** Start point of the operation in world coordinates; enables axis inferences and locks. */
  readonly anchor?: Vec3;
  /** Constrains the result to the line through the anchor in this direction (arrow-key or Shift locks). */
  readonly lockDirection?: Vec3;
  /** Plane for points where nothing is under the cursor. Defaults to a plane through the anchor, or the ground. */
  readonly fallbackPlane?: Plane;
  readonly tolerancePx?: number;
  /** Recently hovered points and edges for linear inferences. */
  readonly references?: InferenceReferences;
}

export const DEFAULT_INFERENCE_TOLERANCE_PX = 10;
/** Points within this angle (as a sine) of an axis through the anchor count as aligned with it. */
const AXIS_ALIGNMENT_SINE = 1e-4;

/** Drawing axes in world coordinates: an origin and three perpendicular unit directions. */
export interface AxisFrame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
}

export const WORLD_AXIS_FRAME: AxisFrame = Object.freeze({ origin: ZERO, x: AXIS_X, y: AXIS_Y, z: AXIS_Z });

/** The document's drawing axes as a frame. */
export function axisFrameOf(doc: ModelDocument): AxisFrame {
  const { origin, xAxis, yAxis } = doc.axes;
  return { origin, x: xAxis, y: yAxis, z: normalize(cross(xAxis, yAxis)) ?? AXIS_Z };
}

interface AxisEntry {
  readonly axis: Axis;
  readonly direction: Vec3;
  readonly label: string;
}

function axisEntries(frame: AxisFrame): readonly AxisEntry[] {
  return [
    { axis: 'x', direction: frame.x, label: 'On Red Axis' },
    { axis: 'y', direction: frame.y, label: 'On Green Axis' },
    { axis: 'z', direction: frame.z, label: 'On Blue Axis' },
  ];
}

/** Lower wins. Points on geometry beat points along lines. */
const PRIORITY: Readonly<Record<InferenceKind, number>> = {
  endpoint: 0,
  origin: 0,
  midpoint: 1,
  center: 1,
  'on-edge': 3,
  'on-face': 4,
  'on-axis': 2,
  parallel: 2,
  perpendicular: 2,
  extension: 3,
  'from-point': 3,
  locked: 0,
  free: 5,
};

/** Among linear inferences within this many pixels of each other, the lower rank wins. */
const LINEAR_TIE_PX = 0.5;
const LINEAR_RANK: Partial<Record<InferenceKind, number>> = {
  'on-axis': 0,
  parallel: 1,
  perpendicular: 1,
  extension: 2,
  'from-point': 2,
};

interface Candidate {
  readonly inference: Inference;
  readonly pixels: number;
}

export function axisOf(direction: Vec3, frame: AxisFrame = WORLD_AXIS_FRAME): Axis | undefined {
  const unit = normalize(direction);
  if (!unit) return undefined;
  return axisEntries(frame).find(({ direction: axis }) => length(cross(unit, axis)) <= AXIS_ALIGNMENT_SINE)
    ?.axis;
}

/** The point on the line through `point` along `direction` closest to the ray. */
export function closestPointOnLineToRay(point: Vec3, direction: Vec3, ray: Ray): Vec3 {
  const w = sub(point, ray.origin);
  const a = dot(direction, direction);
  const b = dot(direction, ray.direction);
  const c = dot(ray.direction, ray.direction);
  const d = dot(direction, w);
  const e = dot(ray.direction, w);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < 1e-12 * a * c) return point;
  return add(point, scale(direction, (b * e - c * d) / denominator));
}

/**
 * Finds the inferred point under the cursor: snapping to geometry, the origin and the axes, and honoring locks.
 * `contextTransform` maps the active context's coordinates to world coordinates.
 */
export function infer(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: InferenceRequest,
): Inference {
  const { camera, size, screen, anchor } = request;
  const tolerance = request.tolerancePx ?? DEFAULT_INFERENCE_TOLERANCE_PX;
  const frame = axisFrameOf(doc);
  const axes = axisEntries(frame);
  const ray = rayThroughScreen(camera, screen, size);
  const pixelsTo = (point: Vec3): number => {
    const projected = projectToScreen(camera, point, size);
    return projected ? Math.hypot(projected.x - screen.x, projected.y - screen.y) : Infinity;
  };

  let best: Candidate | null = null;
  const offer = (inference: Inference): void => {
    const pixels = pixelsTo(inference.point);
    if (pixels > tolerance) return;
    const priority = PRIORITY[inference.kind];
    if (
      !best ||
      priority < PRIORITY[best.inference.kind] ||
      (priority === PRIORITY[best.inference.kind] && pixels < best.pixels)
    ) {
      best = { inference, pixels };
    }
  };

  offer({ point: frame.origin, kind: 'origin', label: 'Origin', inGroup: false });
  traverseAlongRay(doc, context, contextTransform, camera, size, ray, tolerance, (visit) => {
    const inGroup = visit.topLevel !== null;
    const worldStart = transformPoint(visit.toWorld, visit.start);
    const worldEnd = transformPoint(visit.toWorld, visit.end);
    for (const edgeId of visit.store.queryEdges(visit.box)) {
      const edge = visit.store.getEdge(edgeId);
      if (edge.attributes.hidden) continue;
      const a = transformPoint(visit.toWorld, visit.store.position(edge.v0));
      const b = transformPoint(visit.toWorld, visit.store.position(edge.v1));
      const entity: EntityRef = visit.topLevel ?? { kind: 'edge', id: edgeId };
      const common = { inGroup, edge: { a, b }, entity };
      offer({ ...common, point: a, kind: 'endpoint', label: 'Endpoint' });
      offer({ ...common, point: b, kind: 'endpoint', label: 'Endpoint' });
      offer({ ...common, point: lerp(a, b, 0.5), kind: 'midpoint', label: 'Midpoint' });
      const closest = closestPointsOnSegments(worldStart, worldEnd, a, b);
      offer({ ...common, point: closest.pointOnSecond, kind: 'on-edge', label: 'On Edge' });
    }
    for (const curve of visit.store.curves()) {
      if (curve.params.kind === 'polyline') continue;
      offer({
        point: transformPoint(visit.toWorld, curve.params.center),
        kind: 'center',
        label: 'Center',
        inGroup,
      });
    }
  });

  for (const guide of doc.store(context).guides()) {
    if (guide.attributes.hidden) continue;
    const point = transformPoint(contextTransform, guide.geometry.point);
    if (guide.geometry.kind === 'point') {
      offer({ point, kind: 'endpoint', label: 'Guide Point', inGroup: false });
    } else {
      const direction = transformDirection(contextTransform, guide.geometry.direction);
      offer({
        point: closestPointOnLineToRay(point, direction, ray),
        kind: 'on-edge',
        label: 'On Guide',
        inGroup: false,
        edge: { a: point, b: add(point, direction) },
      });
    }
  }

  const geometric = best as Candidate | null;
  const withAxis = (inference: Inference): Inference => {
    if (!anchor) return inference;
    const axis = axisOf(sub(inference.point, anchor), frame);
    return axis && distance(inference.point, anchor) > 0 ? { ...inference, axis } : inference;
  };

  if (anchor && request.lockDirection) {
    const direction = normalize(request.lockDirection);
    if (direction) {
      const axis = axisOf(direction, frame);
      const strong = geometric && PRIORITY[geometric.inference.kind] <= 1 ? geometric.inference : null;
      const point = strong
        ? add(anchor, scale(direction, dot(sub(strong.point, anchor), direction)))
        : closestPointOnLineToRay(anchor, direction, ray);
      const axisLabel = axes.find((entry) => entry.axis === axis)?.label;
      return {
        point,
        kind: 'locked',
        label: strong ? `${strong.label} (locked)` : (axisLabel ?? 'Locked direction'),
        inGroup: strong?.inGroup ?? false,
        ...(axis ? { axis } : {}),
      };
    }
  }

  if (geometric && PRIORITY[geometric.inference.kind] <= 1) return withAxis(geometric.inference);

  const linear = bestLinearInference(request, ray, tolerance, pixelsTo, frame);
  if (linear) {
    // Lines through the anchor may win a tie with geometry; lines elsewhere only when strictly closer.
    const throughAnchor = linear.inference.kind !== 'extension' && linear.inference.kind !== 'from-point';
    if (
      !geometric ||
      linear.pixels < geometric.pixels ||
      (throughAnchor && linear.pixels <= geometric.pixels)
    ) {
      return linear.inference.kind === 'on-axis' ? linear.inference : withAxis(linear.inference);
    }
  }

  if (geometric) return withAxis(geometric.inference);

  const hit = pick(doc, context, contextTransform, { camera, size, screen, edgeTolerancePx: 0 });
  if (hit && hit.ref.kind !== 'edge') {
    let facePlane: Plane | undefined;
    if (hit.ref.kind === 'face') {
      const plane = doc.store(context).face(hit.ref.id as FaceId)?.plane;
      const normal = plane ? transformNormal(contextTransform, plane.normal) : null;
      const unit = normal ? normalize(normal) : null;
      if (unit) facePlane = planeFromPointNormal(hit.point, unit);
    }
    return withAxis({
      point: hit.point,
      kind: 'on-face',
      label: hit.ref.kind === 'face' ? 'On Face' : 'On Face in Group',
      inGroup: hit.ref.kind === 'instance',
      entity: hit.ref,
      ...(facePlane ? { facePlane } : {}),
    });
  }

  return withAxis({ point: freePoint(request, ray, frame), kind: 'free', label: '', inGroup: false });
}

/**
 * The closest linear inference: an axis, or a line parallel or perpendicular to a recent edge, through the anchor;
 * the extension of a recent edge; or an axis line through a recent point.
 */
function bestLinearInference(
  request: InferenceRequest,
  ray: Ray,
  tolerance: number,
  pixelsTo: (point: Vec3) => number,
  frame: AxisFrame,
): Candidate | null {
  const { anchor, references } = request;
  const axes = axisEntries(frame);
  let best: Candidate | null = null;
  const offer = (inference: Inference): void => {
    const pixels = pixelsTo(inference.point);
    if (pixels > tolerance) return;
    const rank = LINEAR_RANK[inference.kind] ?? 0;
    const bestRank = best ? (LINEAR_RANK[best.inference.kind] ?? 0) : 0;
    if (
      !best ||
      pixels < best.pixels - LINEAR_TIE_PX ||
      (pixels <= best.pixels + LINEAR_TIE_PX && rank < bestRank) ||
      (Math.abs(pixels - best.pixels) <= LINEAR_TIE_PX && rank === bestRank && pixels < best.pixels)
    ) {
      best = { inference, pixels };
    }
  };

  if (anchor) {
    for (const { axis, direction, label } of axes) {
      const point = closestPointOnLineToRay(anchor, direction, ray);
      if (distance(point, anchor) > 0) offer({ point, kind: 'on-axis', label, inGroup: false, axis });
    }
    for (const edge of references?.edges ?? []) {
      const along = normalize(sub(edge.b, edge.a));
      // Axis-aligned edges add nothing the axis inferences don't already give.
      if (!along || axisOf(along, frame)) continue;
      const parallel = closestPointOnLineToRay(anchor, along, ray);
      if (distance(parallel, anchor) > 0) {
        offer({ point: parallel, kind: 'parallel', label: 'Parallel to Edge', inGroup: false, edge });
      }
      const planeNormal = normalize(cross(along, sub(anchor, edge.a))) ?? frame.z;
      const across = normalize(cross(planeNormal, along));
      if (!across) continue;
      const perpendicular = closestPointOnLineToRay(anchor, across, ray);
      if (distance(perpendicular, anchor) > 0) {
        offer({
          point: perpendicular,
          kind: 'perpendicular',
          label: 'Perpendicular to Edge',
          inGroup: false,
          edge,
        });
      }
    }
  }

  for (const edge of references?.edges ?? []) {
    const along = normalize(sub(edge.b, edge.a));
    if (!along) continue;
    const point = closestPointOnLineToRay(edge.a, along, ray);
    const parameter = dot(sub(point, edge.a), along);
    if (parameter < 0 || parameter > distance(edge.a, edge.b)) {
      offer({ point, kind: 'extension', label: 'On Edge Extension', inGroup: false, edge });
    }
  }
  for (const reference of references?.points ?? []) {
    for (const { direction } of axes) {
      const point = closestPointOnLineToRay(reference, direction, ray);
      if (distance(point, reference) > 0) {
        offer({ point, kind: 'from-point', label: 'From Point', inGroup: false });
      }
    }
  }
  return best;
}

/** Where a ray meets the fallback plane: the given one, a plane through the anchor, or the ground. */
function freePoint(request: InferenceRequest, ray: Ray, frame: AxisFrame): Vec3 {
  const { camera, size, screen, anchor } = request;
  let plane = request.fallbackPlane;
  if (!plane) {
    if (anchor) {
      const forward = cameraBasis(camera).forward;
      const facing = axisEntries(frame).reduce((bestAxis, entry) =>
        Math.abs(dot(entry.direction, forward)) > Math.abs(dot(bestAxis.direction, forward))
          ? entry
          : bestAxis,
      );
      plane = planeFromPointNormal(anchor, facing.direction);
    } else {
      plane = planeFromPointNormal(frame.origin, frame.z);
    }
  }
  const denominator = dot(plane.normal, ray.direction);
  if (Math.abs(denominator) > 1e-9) {
    const t = (plane.offset - dot(plane.normal, ray.origin)) / denominator;
    if (t > 0 && Number.isFinite(t)) return add(ray.origin, scale(ray.direction, t));
  }
  return pointOnTargetPlane(camera, screen, size);
}
