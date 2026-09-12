import type { DefinitionId } from '../../kernel/ids';
import { aabbExpand, aabbFromPoints, aabbIsEmpty, type Aabb } from '../../kernel/math/aabb';
import { classifyPointInPolygon } from '../../kernel/math/geom2d';
import {
  invertAffine,
  multiply,
  transformDirection,
  transformPoint,
  type Mat4,
} from '../../kernel/math/mat4';
import { planeBasis, projectTo2D } from '../../kernel/math/plane';
import { closestPointsOnSegments } from '../../kernel/math/segment';
import {
  add,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  distance,
  dot,
  length,
  scale,
  sub,
  type Vec3,
} from '../../kernel/math/vec3';
import type { EntityStore } from '../../kernel/model/EntityStore';
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
import { aabbCorners, definitionBounds } from '../geometry/bounds';
import type { EntityRef } from '../selection/Selection';

export const DEFAULT_EDGE_PICK_TOLERANCE_PX = 5;
/** Faces seen this close to edge-on (|cos| of the angle to the ray) are not hit. */
const GRAZING_COSINE = 1e-9;

export interface PickRequest {
  readonly camera: CameraState;
  readonly size: ViewportSize;
  readonly screen: ScreenPoint;
  readonly edgeTolerancePx?: number;
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

interface Traversal {
  readonly doc: ModelDocument;
  readonly request: PickRequest;
  readonly worldRay: Ray;
  readonly tolerancePx: number;
  readonly boundsCache: Map<DefinitionId, Aabb>;
  readonly candidates: Candidate[];
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
  const traversal: Traversal = {
    doc,
    request,
    worldRay: rayThroughScreen(request.camera, request.screen, request.size),
    tolerancePx: request.edgeTolerancePx ?? DEFAULT_EDGE_PICK_TOLERANCE_PX,
    boundsCache: new Map(),
    candidates: [],
  };
  pickDefinition(traversal, context, contextTransform, null);
  let best: Candidate | null = null;
  for (const candidate of traversal.candidates) {
    if (!best || candidate.distance - candidate.bias < best.distance - best.bias) best = candidate;
  }
  return best ? { ref: best.ref, distance: best.distance, point: best.point } : null;
}

/** Parameter interval where a ray is inside a box (slab method), clipped to t ≥ 0, or null when it misses. */
function rayBoxInterval(origin: Vec3, direction: Vec3, box: Aabb): [number, number] | null {
  let near = 0;
  let far = Infinity;
  const slabs: [number, number, number, number][] = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, min, max] of slabs) {
    if (d === 0) {
      if (o < min || o > max) return null;
      continue;
    }
    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  return far >= near ? [near, far] : null;
}

/** Largest number of local units that one world unit maps to under `fromWorld`. */
function localUnitsPerWorldUnit(fromWorld: Mat4): number {
  return Math.max(
    length(transformDirection(fromWorld, AXIS_X)),
    length(transformDirection(fromWorld, AXIS_Y)),
    length(transformDirection(fromWorld, AXIS_Z)),
  );
}

function pickDefinition(
  traversal: Traversal,
  definitionId: DefinitionId,
  toWorld: Mat4,
  topLevel: EntityRef | null,
): void {
  const { doc, request, worldRay, tolerancePx } = traversal;
  const bounds = definitionBounds(doc, definitionId, traversal.boundsCache);
  const fromWorld = invertAffine(toWorld);
  if (aabbIsEmpty(bounds) || !fromWorld) return;

  // The local ray keeps the world parameter: origin + direction·t is the same point in both spaces.
  const origin = transformPoint(fromWorld, worldRay.origin);
  const direction = transformDirection(fromWorld, worldRay.direction);
  const worldPerPixel = Math.max(
    ...aabbCorners(bounds).map((corner) =>
      worldUnitsPerPixel(request.camera, transformPoint(toWorld, corner), request.size),
    ),
  );
  const margin = tolerancePx * worldPerPixel * localUnitsPerWorldUnit(fromWorld);
  const interval = rayBoxInterval(origin, direction, aabbExpand(bounds, margin));
  if (!interval) return;
  const [t0, t1] = interval;
  const rayStart = add(origin, scale(direction, t0));
  const rayEnd = add(origin, scale(direction, t1));
  const segmentBox = aabbExpand(aabbFromPoints([rayStart, rayEnd]), margin);
  const store = doc.store(definitionId);

  pickFaces(traversal, store, origin, direction, segmentBox, toWorld, topLevel);
  pickEdges(traversal, store, rayStart, rayEnd, segmentBox, toWorld, topLevel);

  for (const instance of store.instances()) {
    if (instance.attributes.hidden) continue;
    pickDefinition(
      traversal,
      instance.definitionId,
      multiply(toWorld, instance.transform),
      topLevel ?? { kind: 'instance', id: instance.id },
    );
  }
}

function pickFaces(
  traversal: Traversal,
  store: EntityStore,
  origin: Vec3,
  direction: Vec3,
  box: Aabb,
  toWorld: Mat4,
  topLevel: EntityRef | null,
): void {
  for (const faceId of store.queryFaces(box)) {
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
    traversal.candidates.push({
      ref: topLevel ?? { kind: 'face', id: faceId },
      distance: t,
      point: transformPoint(toWorld, local),
      bias: 0,
    });
  }
}

function pickEdges(
  traversal: Traversal,
  store: EntityStore,
  rayStart: Vec3,
  rayEnd: Vec3,
  box: Aabb,
  toWorld: Mat4,
  topLevel: EntityRef | null,
): void {
  const { request, tolerancePx, worldRay } = traversal;
  for (const edgeId of store.queryEdges(box)) {
    const edge = store.getEdge(edgeId);
    if (edge.attributes.hidden || edge.attributes.soft) continue;
    const closest = closestPointsOnSegments(
      rayStart,
      rayEnd,
      store.position(edge.v0),
      store.position(edge.v1),
    );
    const onRay = transformPoint(toWorld, closest.pointOnFirst);
    const onEdge = transformPoint(toWorld, closest.pointOnSecond);
    const toleranceWorld = tolerancePx * worldUnitsPerPixel(request.camera, onEdge, request.size);
    if (distance(onRay, onEdge) > toleranceWorld) continue;
    traversal.candidates.push({
      ref: topLevel ?? { kind: 'edge', id: edgeId },
      distance: dot(sub(onEdge, worldRay.origin), worldRay.direction),
      point: onEdge,
      bias: toleranceWorld,
    });
  }
}
