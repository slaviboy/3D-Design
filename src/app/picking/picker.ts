import type { DefinitionId } from '../../kernel/ids';
import { classifyPointInPolygon } from '../../kernel/math/geom2d';
import { transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { planeBasis, projectTo2D } from '../../kernel/math/plane';
import { closestPointsOnSegments } from '../../kernel/math/segment';
import { add, distance, dot, length, scale, sub, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { Loop } from '../../kernel/model/types';
import {
  rayThroughScreen,
  worldUnitsPerPixel,
  type CameraState,
  type Ray,
  type ScreenPoint,
  type ViewportSize,
} from '../camera/camera';
import type { EntityRef } from '../selection/Selection';
import { traverseAlongRay, type RayVisit } from './rayTraversal';

export const DEFAULT_EDGE_PICK_TOLERANCE_PX = 5;
/** Faces seen this close to edge-on (|cos| of the angle to the ray) are not hit. */
const GRAZING_COSINE = 1e-9;

export interface PickRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  readonly edgeTolerancePx?: number;
  /** Also pick soft edges, which are normally skipped (the eraser needs them to unsoften). */
  readonly includeSoftEdges?: boolean;
}

export interface PickHit {
  /** A face or edge of the picked context, or the top-level instance that contains the hit. */
  readonly ref: EntityRef;
  /** World-space distance along the pick ray. */
  readonly distance: number;
  /** World-space point that was hit. */
  readonly point: Vec3;
}

interface Candidate extends PickHit {
  /** Edge hits get a head start equal to their pick tolerance, so an edge wins over the face it bounds. */
  readonly bias: number;
}

/**
 * The entity under a screen point. Geometry in `context` is picked directly; anything inside an instance is
 * reported as that instance, which is how selection works outside an open group or component.
 * `contextTransform` maps the context's coordinates to world coordinates.
 */
export function pick(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  request: PickRequest,
): PickHit | null {
  const tolerancePx = request.edgeTolerancePx ?? DEFAULT_EDGE_PICK_TOLERANCE_PX;
  const worldRay = rayThroughScreen(request.camera, request.screen, request.size);
  const candidates: Candidate[] = [];
  traverseAlongRay(
    doc,
    context,
    contextTransform,
    request.camera,
    request.size,
    worldRay,
    tolerancePx,
    (visit) => {
      pickFaces(visit, candidates);
      pickEdges(visit, request, tolerancePx, worldRay, candidates);
    },
  );
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.distance - candidate.bias < best.distance - best.bias) best = candidate;
  }
  return best ? { ref: best.ref, distance: best.distance, point: best.point } : null;
}

function pickFaces(visit: RayVisit, candidates: Candidate[]): void {
  const { store, origin, direction, toWorld, topLevel } = visit;
  for (const faceId of store.queryFaces(visit.box)) {
    const face = store.getFace(faceId);
    if (face.attributes.hidden || !face.plane) continue;
    const denominator = dot(face.plane.normal, direction);
    if (Math.abs(denominator) < GRAZING_COSINE * length(direction)) continue;
    const t = (face.plane.offset - dot(face.plane.normal, origin)) / denominator;
    if (t <= 0) continue;
    const local = add(origin, scale(direction, t));
    const basis = planeBasis(face.plane.normal);
    const project = (loop: Loop) => store.loopPoints(loop).map((p) => projectTo2D(basis, p));
    const position = classifyPointInPolygon(
      projectTo2D(basis, local),
      project(face.outer),
      face.inners.map(project),
    );
    if (position === 'outside') continue;
    candidates.push({
      ref: topLevel ?? { kind: 'face', id: faceId },
      distance: t,
      point: transformPoint(toWorld, local),
      bias: 0,
    });
  }
}

function pickEdges(
  visit: RayVisit,
  request: PickRequest,
  tolerancePx: number,
  worldRay: Ray,
  candidates: Candidate[],
): void {
  const { store, toWorld, topLevel } = visit;
  for (const edgeId of store.queryEdges(visit.box)) {
    const edge = store.getEdge(edgeId);
    if (edge.attributes.hidden || (edge.attributes.soft && request.includeSoftEdges !== true)) continue;
    const closest = closestPointsOnSegments(
      visit.start,
      visit.end,
      store.position(edge.v0),
      store.position(edge.v1),
    );
    const onRay = transformPoint(toWorld, closest.pointOnFirst);
    const onEdge = transformPoint(toWorld, closest.pointOnSecond);
    const toleranceWorld = tolerancePx * worldUnitsPerPixel(request.camera, onEdge, request.size);
    if (distance(onRay, onEdge) > toleranceWorld) continue;
    candidates.push({
      ref: topLevel ?? { kind: 'edge', id: edgeId },
      distance: dot(sub(onEdge, worldRay.origin), worldRay.direction),
      point: onEdge,
      bias: toleranceWorld,
    });
  }
}
