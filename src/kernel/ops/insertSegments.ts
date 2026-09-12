import { KernelError } from '../errors';
import type { DefinitionId, EdgeId, FaceId, VertexId } from '../ids';
import { aabbExpand, aabbFromPoints } from '../math/aabb';
import {
  canonicalPlane,
  isPointOnPlane,
  planesCoincide,
  planeThroughPoints,
  projectPointOntoPlane,
  signedDistanceToPlane,
  type Plane,
} from '../math/plane';
import { closestPointsOnSegments, distancePointToLine, parameterOnLine } from '../math/segment';
import { distance, isFiniteVec3, lerp, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import { addEdge, addVertex, removeVertex, splitEdge } from '../model/mutations';
import {
  DEFAULT_EDGE_ATTRIBUTES,
  DEFAULT_FACE_ATTRIBUTES,
  type EdgeAttributes,
  type FaceAttributes,
} from '../model/types';
import { EPS_LEN } from '../tolerance';
import { NEVER_CREATE_FACES, resolvePlane, type RegionPolicy } from './planar/resolvePlane';

export interface SegmentInput {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly attributes?: EdgeAttributes;
}

export interface InsertSegmentsOptions {
  /** Create faces for closed coplanar regions that no face covers yet (drawing tools set this). */
  readonly autoFace: boolean;
  /** Attributes for automatically created faces. */
  readonly faceAttributes?: FaceAttributes;
  /** Preferred normal direction for new faces with no neighbours to agree with. */
  readonly orientationHint?: Vec3;
}

export interface InsertSegmentsResult {
  /** For each input segment, the edges now covering it in order from `a` to `b`. Empty for degenerate segments. */
  readonly segmentEdges: readonly (readonly EdgeId[])[];
  readonly createdEdges: readonly EdgeId[];
  readonly createdFaces: readonly FaceId[];
  readonly splitFaces: readonly FaceId[];
}

const byId = (a: number, b: number): number => a - b;

/**
 * Adds straight segments to a definition with "sticky geometry" behavior. Endpoints weld to nearby vertices,
 * edges split where segments cross or touch them, collinear overlaps merge, faces split where new edges divide
 * them, and (with `autoFace`) closed regions become faces. GEOMETRY.md ("Algorithm: insertSegments").
 */
export function insertSegments(
  doc: ModelDocument,
  context: DefinitionId,
  segments: readonly SegmentInput[],
  options: InsertSegmentsOptions,
): InsertSegmentsResult {
  return doc.transact('Draw edges', () => {
    const store = doc.store(context);
    const createdEdges: EdgeId[] = [];
    const endpoints: ([VertexId, VertexId] | null)[] = [];

    for (const segment of segments) {
      if (!isFiniteVec3(segment.a) || !isFiniteVec3(segment.b)) {
        throw new KernelError('invalid-geometry', 'Segment coordinates must be finite');
      }
      if (distance(segment.a, segment.b) <= EPS_LEN) {
        endpoints.push(null);
        continue;
      }
      const va = ensureVertex(doc, context, segment.a);
      const vb = ensureVertex(doc, context, segment.b);
      if (va === vb) {
        // Both endpoints welded to one vertex; drop it again if this segment was its only reason to exist.
        if (store.getVertex(va).edges.length === 0) removeVertex(doc, context, va);
        endpoints.push(null);
        continue;
      }
      insertChain(doc, context, va, vb, segment.attributes ?? DEFAULT_EDGE_ATTRIBUTES, createdEdges);
      endpoints.push([va, vb]);
    }

    const liveEdges = createdEdges.filter((id) => store.edge(id) !== undefined);
    const policy: RegionPolicy = options.autoFace
      ? { decide: () => ({ attributes: options.faceAttributes ?? DEFAULT_FACE_ATTRIBUTES }) }
      : NEVER_CREATE_FACES;
    const createdFaces: FaceId[] = [];
    const splitFaces: FaceId[] = [];
    for (const plane of collectCandidatePlanes(store, liveEdges, options.autoFace)) {
      const seeds = liveEdges.filter((id) => {
        const edge = store.edge(id);
        return (
          edge !== undefined &&
          isPointOnPlane(plane, store.position(edge.v0)) &&
          isPointOnPlane(plane, store.position(edge.v1))
        );
      });
      const result = resolvePlane(doc, context, plane, seeds, {
        policy,
        orientationHint: options.orientationHint,
      });
      createdFaces.push(...result.createdFaces);
      splitFaces.push(...result.splitFaces);
    }

    return {
      segmentEdges: endpoints.map((pair) => (pair ? chainBetween(store, pair[0], pair[1]) : [])),
      createdEdges: liveEdges,
      createdFaces,
      splitFaces,
    };
  });
}

/**
 * The vertex for a new endpoint, in priority order: an existing vertex within tolerance; a split of an edge
 * whose interior passes within tolerance; a new vertex, projected onto any face plane within tolerance.
 */
function ensureVertex(doc: ModelDocument, context: DefinitionId, point: Vec3): VertexId {
  const store = doc.store(context);
  const existing = store.findNearestVertex(point, EPS_LEN);
  if (existing !== undefined) return existing;

  const probe = aabbExpand(aabbFromPoints([point]), EPS_LEN);
  for (const edgeId of store.queryEdges(probe).sort(byId)) {
    const edge = store.getEdge(edgeId);
    const a = store.position(edge.v0);
    const b = store.position(edge.v1);
    const edgeLength = distance(a, b);
    const t = Math.min(1, Math.max(0, parameterOnLine(a, b, point)));
    const closest = lerp(a, b, t);
    if (distance(closest, point) <= EPS_LEN && t * edgeLength > EPS_LEN && (1 - t) * edgeLength > EPS_LEN) {
      return splitEdge(doc, context, edgeId, closest).vertex;
    }
  }

  let position = point;
  for (const faceId of store.queryFaces(probe).sort(byId)) {
    const plane = store.getFace(faceId).plane;
    if (plane && Math.abs(signedDistanceToPlane(plane, point)) <= EPS_LEN) {
      position = projectPointOntoPlane(plane, point);
      break;
    }
  }
  return addVertex(doc, context, position);
}

interface SplitPoint {
  readonly s: number;
  readonly vertex: VertexId;
}

/** Adds the segment `va → vb`, splitting existing edges it crosses and reusing collinear edges it overlaps. */
function insertChain(
  doc: ModelDocument,
  context: DefinitionId,
  va: VertexId,
  vb: VertexId,
  attributes: EdgeAttributes,
  createdEdges: EdgeId[],
): void {
  const store = doc.store(context);
  const a = store.position(va);
  const b = store.position(vb);
  const segmentLength = distance(a, b);
  const interior = (s: number): boolean => s * segmentLength > EPS_LEN && (1 - s) * segmentLength > EPS_LEN;
  const splits: SplitPoint[] = [];

  for (const edgeId of store.queryEdges(aabbExpand(aabbFromPoints([a, b]), EPS_LEN)).sort(byId)) {
    const edge = store.edge(edgeId);
    if (!edge) continue;
    const joinsEndpoints = (edge.v0 === va || edge.v0 === vb) && (edge.v1 === va || edge.v1 === vb);
    if (joinsEndpoints) continue;
    const p = store.position(edge.v0);
    const q = store.position(edge.v1);

    if (distancePointToLine(p, a, b) <= EPS_LEN && distancePointToLine(q, a, b) <= EPS_LEN) {
      // Collinear: the edge's endpoints inside the segment become chain vertices, and overlaps then reuse the edge.
      for (const vertex of [edge.v0, edge.v1]) {
        if (vertex === va || vertex === vb) continue;
        const s = parameterOnLine(a, b, store.position(vertex));
        if (interior(s)) splits.push({ s, vertex });
      }
      continue;
    }

    const closest = closestPointsOnSegments(a, b, p, q);
    if (closest.distance > EPS_LEN || !interior(closest.s)) continue;
    const edgeLength = distance(p, q);
    const alongEdge = closest.t * edgeLength;
    if (alongEdge <= EPS_LEN) {
      splits.push({ s: parameterOnLine(a, b, p), vertex: edge.v0 });
    } else if (edgeLength - alongEdge <= EPS_LEN) {
      splits.push({ s: parameterOnLine(a, b, q), vertex: edge.v1 });
    } else {
      const { vertex } = splitEdge(doc, context, edgeId, closest.pointOnSecond);
      splits.push({ s: closest.s, vertex });
    }
  }

  splits.sort((x, y) => x.s - y.s || x.vertex - y.vertex);
  const chain: VertexId[] = [va];
  const seen = new Set<VertexId>([va, vb]);
  for (const split of splits) {
    if (seen.has(split.vertex)) continue;
    seen.add(split.vertex);
    chain.push(split.vertex);
  }
  chain.push(vb);

  for (let i = 0; i + 1 < chain.length; i++) {
    const u = chain[i];
    const w = chain[i + 1];
    if (u === undefined || w === undefined || store.edgeBetween(u, w)) continue;
    createdEdges.push(addEdge(doc, context, u, w, attributes));
  }
}

/** The collinear edges leading from `va` to `vb`, in order. */
function chainBetween(store: EntityStore, va: VertexId, vb: VertexId): EdgeId[] {
  const a = store.position(va);
  const b = store.position(vb);
  const edges: EdgeId[] = [];
  let current = va;
  let currentParameter = 0;
  while (current !== vb) {
    let best: { edge: EdgeId; vertex: VertexId; s: number } | undefined;
    for (const edgeId of store.getVertex(current).edges) {
      const other = store.otherVertex(edgeId, current);
      const position = store.position(other);
      if (distancePointToLine(position, a, b) > EPS_LEN) continue;
      const s = parameterOnLine(a, b, position);
      if (s <= currentParameter || s > 1 + EPS_LEN) continue;
      if (!best || s < best.s) best = { edge: edgeId, vertex: other, s };
    }
    if (!best || edges.length > store.edgeCount) {
      throw new KernelError(
        'invalid-operation',
        'Inserted segment is not covered by a continuous edge chain',
      );
    }
    edges.push(best.edge);
    current = best.vertex;
    currentParameter = best.s;
  }
  return edges;
}

/**
 * Planes where the new edges might split existing faces (the planes of faces the edges touch), and, with
 * `autoFace`, planes where they might close new regions (spanned by each new edge and each adjacent edge).
 */
function collectCandidatePlanes(store: EntityStore, edges: readonly EdgeId[], autoFace: boolean): Plane[] {
  const planes: Plane[] = [];
  const addPlane = (plane: Plane): void => {
    const canonical = canonicalPlane(plane);
    if (!planes.some((existing) => planesCoincide(existing, canonical))) planes.push(canonical);
  };

  for (const edgeId of edges) {
    const edge = store.getEdge(edgeId);
    const a = store.position(edge.v0);
    const b = store.position(edge.v1);
    for (const faceId of store.queryFaces(aabbExpand(store.edgeBounds(edgeId), EPS_LEN)).sort(byId)) {
      const plane = store.getFace(faceId).plane;
      if (plane && isPointOnPlane(plane, a) && isPointOnPlane(plane, b)) addPlane(plane);
    }
  }

  if (autoFace) {
    for (const edgeId of edges) {
      const edge = store.getEdge(edgeId);
      const a = store.position(edge.v0);
      const b = store.position(edge.v1);
      for (const vertex of [edge.v0, edge.v1]) {
        for (const neighbour of [...store.getVertex(vertex).edges].sort(byId)) {
          if (neighbour === edgeId) continue;
          const c = store.position(store.otherVertex(neighbour, vertex));
          const plane = planeThroughPoints(a, b, c);
          if (plane) addPlane(plane);
        }
      }
    }
  }
  return planes;
}
