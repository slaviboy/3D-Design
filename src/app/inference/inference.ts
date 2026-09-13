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
import { isTagVisible } from '../../kernel/model/visibility';
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
  'endpoint' | 'midpoint' | 'center' | 'origin' | 'on-edge' | 'on-face' | 'on-axis' | 'locked' | 'free';

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
}

export const DEFAULT_INFERENCE_TOLERANCE_PX = 10;
/** Points within this angle (as a sine) of an axis through the anchor count as aligned with it. */
const AXIS_ALIGNMENT_SINE = 1e-4;

const AXES: readonly { readonly axis: Axis; readonly direction: Vec3; readonly label: string }[] = [
  { axis: 'x', direction: AXIS_X, label: 'On Red Axis' },
  { axis: 'y', direction: AXIS_Y, label: 'On Green Axis' },
  { axis: 'z', direction: AXIS_Z, label: 'On Blue Axis' },
];

/** Lower wins. Points on geometry beat points along lines. */
const PRIORITY: Readonly<Record<InferenceKind, number>> = {
  endpoint: 0,
  origin: 0,
  midpoint: 1,
  center: 1,
  'on-edge': 3,
  'on-face': 4,
  'on-axis': 2,
  locked: 0,
  free: 5,
};

interface Candidate {
  readonly inference: Inference;
  readonly pixels: number;
}

export function axisOf(direction: Vec3): Axis | undefined {
  const unit = normalize(direction);
  if (!unit) return undefined;
  return AXES.find(({ direction: axis }) => length(cross(unit, axis)) <= AXIS_ALIGNMENT_SINE)?.axis;
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

  offer({ point: ZERO, kind: 'origin', label: 'Origin', inGroup: false });
  traverseAlongRay(doc, context, contextTransform, camera, size, ray, tolerance, (visit) => {
    const inGroup = visit.topLevel !== null;
    const worldStart = transformPoint(visit.toWorld, visit.start);
    const worldEnd = transformPoint(visit.toWorld, visit.end);
    for (const edgeId of visit.store.queryEdges(visit.box)) {
      const edge = visit.store.getEdge(edgeId);
      if (edge.attributes.hidden || !isTagVisible(doc, edge.attributes.tagId)) continue;
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
      const first = curve.edges[0] === undefined ? undefined : visit.store.edge(curve.edges[0]);
      if (first && (first.attributes.hidden || !isTagVisible(doc, first.attributes.tagId))) continue;
      offer({
        point: transformPoint(visit.toWorld, curve.params.center),
        kind: 'center',
        label: 'Center',
        inGroup,
      });
    }
  });

  for (const guide of doc.store(context).guides()) {
    if (guide.attributes.hidden || !isTagVisible(doc, guide.attributes.tagId)) continue;
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
    const axis = axisOf(sub(inference.point, anchor));
    return axis && distance(inference.point, anchor) > 0 ? { ...inference, axis } : inference;
  };

  if (anchor && request.lockDirection) {
    const direction = normalize(request.lockDirection);
    if (direction) {
      const axis = axisOf(direction);
      const strong = geometric && PRIORITY[geometric.inference.kind] <= 1 ? geometric.inference : null;
      const point = strong
        ? add(anchor, scale(direction, dot(sub(strong.point, anchor), direction)))
        : closestPointOnLineToRay(anchor, direction, ray);
      const axisLabel = AXES.find((entry) => entry.axis === axis)?.label;
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

  if (anchor) {
    let axisCandidate: Candidate | null = null;
    for (const { axis, direction, label } of AXES) {
      const point = closestPointOnLineToRay(anchor, direction, ray);
      const pixels = pixelsTo(point);
      if (pixels > tolerance || distance(point, anchor) === 0) continue;
      if (!axisCandidate || pixels < axisCandidate.pixels) {
        axisCandidate = { inference: { point, kind: 'on-axis', label, inGroup: false, axis }, pixels };
      }
    }
    if (axisCandidate && (!geometric || axisCandidate.pixels <= geometric.pixels))
      return axisCandidate.inference;
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

  return withAxis({ point: freePoint(request, ray), kind: 'free', label: '', inGroup: false });
}

/** Where a ray meets the fallback plane: the given one, a plane through the anchor, or the ground. */
function freePoint(request: InferenceRequest, ray: Ray): Vec3 {
  const { camera, size, screen, anchor } = request;
  let plane = request.fallbackPlane;
  if (!plane) {
    if (anchor) {
      const forward = cameraBasis(camera).forward;
      const facing = AXES.reduce((bestAxis, entry) =>
        Math.abs(dot(entry.direction, forward)) > Math.abs(dot(bestAxis.direction, forward))
          ? entry
          : bestAxis,
      );
      plane = planeFromPointNormal(anchor, facing.direction);
    } else {
      plane = planeFromPointNormal(ZERO, AXIS_Z);
    }
  }
  const denominator = dot(plane.normal, ray.direction);
  if (Math.abs(denominator) > 1e-9) {
    const t = (plane.offset - dot(plane.normal, ray.origin)) / denominator;
    if (t > 0 && Number.isFinite(t)) return add(ray.origin, scale(ray.direction, t));
  }
  return pointOnTargetPlane(camera, screen, size);
}
