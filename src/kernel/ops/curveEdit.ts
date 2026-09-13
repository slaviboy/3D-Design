import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, VertexId } from '../ids';
import { aabbExpand } from '../math/aabb';
import { newellNormal } from '../math/plane';
import { closestPointsOnSegments } from '../math/segment';
import { distance, dot, lerp, type Vec3 } from '../math/vec3';
import type { CurveView, EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import {
  addCurve,
  addEdge,
  addVertex,
  removeCurve,
  removeEdge,
  removeVertex,
  setCurveEdges,
  setCurveParams,
  setFaceLoops,
  splitEdge,
} from '../model/mutations';
import type { CurveParams, Loop, LoopUse } from '../model/types';
import { EPS_LEN } from '../tolerance';
import { orderEdgeChain, type EdgeChain } from './chains';
import { curvePoints, MAX_CURVE_SEGMENTS, MIN_CLOSED_CURVE_SEGMENTS } from './curves';

type CircularParams = Extract<CurveParams, { kind: 'arc' | 'circle' }>;

const byId = (a: number, b: number): number => a - b;

/**
 * Divides an edge into `segments` equal parts and returns the edges that replace it, in chain order.
 *
 * - An edge of an arc or circle whose parameters still describe its edges, and whose inner vertices connect to
 *   nothing else, re-divides the whole curve: its vertices are regenerated on the circle and the curve keeps its
 *   parameters with the new segment count. Faces bounded by the curve follow.
 * - Any other edge is split at equal distances along its length. A circle, arc or polygon curve it belongs to
 *   becomes a polyline, because its parameters no longer describe its edges.
 */
export function divideEdge(
  doc: ModelDocument,
  context: DefinitionId,
  edgeId: EdgeId,
  segments: number,
): EdgeId[] {
  if (!Number.isInteger(segments) || segments < 2 || segments > MAX_CURVE_SEGMENTS) {
    throw new KernelError(
      'invalid-operation',
      `An edge can be divided into 2 to ${String(MAX_CURVE_SEGMENTS)} parts`,
    );
  }
  return doc.transact('Divide', () => {
    const store = doc.store(context);
    const edge = store.getEdge(edgeId);
    const curve = edge.curve === null ? undefined : store.getCurve(edge.curve);
    if (curve) {
      const chain = circularChain(store, curve);
      const params = curve.params;
      if (chain && (params.kind === 'arc' || params.kind === 'circle')) {
        return redivideCurve(doc, context, curve.id, params, chain, segments);
      }
    }
    return splitEvenly(doc, context, edgeId, segments);
  });
}

function splitEvenly(doc: ModelDocument, context: DefinitionId, edgeId: EdgeId, segments: number): EdgeId[] {
  const store = doc.store(context);
  const edge = store.getEdge(edgeId);
  const a = store.position(edge.v0);
  const b = store.position(edge.v1);
  if (distance(a, b) / segments <= EPS_LEN) {
    throw new KernelError('invalid-geometry', 'The parts would be shorter than the length tolerance');
  }
  const curveId = edge.curve;
  const parts: EdgeId[] = [];
  let rest = edgeId;
  for (let i = 1; i < segments; i++) {
    const { first, second } = splitEdge(doc, context, rest, lerp(a, b, i / segments));
    parts.push(first);
    rest = second;
  }
  parts.push(rest);
  if (curveId !== null && store.getCurve(curveId).params.kind !== 'polyline') {
    setCurveParams(doc, context, curveId, { kind: 'polyline' });
  }
  return parts;
}

/**
 * The ordered chain of an arc or circle curve when it can be re-divided: its edge count matches its parameters,
 * every vertex lies on the circle (arc ends at the parameter angles), and inner vertices join only curve edges.
 */
function circularChain(store: EntityStore, curve: CurveView): EdgeChain | null {
  const params = curve.params;
  if (params.kind !== 'arc' && params.kind !== 'circle') return null;
  if (curve.edges.length !== params.segments) return null;
  const chain = orderEdgeChain(store, curve.edges);
  if (chain.closed !== (params.kind === 'circle')) return null;
  const inner = chain.closed ? chain.vertices.slice(0, -1) : chain.vertices.slice(1, -1);
  if (inner.some((vertex) => store.getVertex(vertex).edges.length !== 2)) return null;
  const { points } = curvePoints(params);
  const onCircle = chain.vertices.every(
    (vertex) => Math.abs(distance(store.position(vertex), params.center) - params.radius) <= EPS_LEN,
  );
  if (!onCircle) return null;
  if (params.kind === 'arc') {
    const start = store.position(chain.vertices[0] ?? (-1 as VertexId));
    const end = store.position(chain.vertices.at(-1) ?? (-1 as VertexId));
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) return null;
    const matches =
      (distance(start, first) <= EPS_LEN && distance(end, last) <= EPS_LEN) ||
      (distance(start, last) <= EPS_LEN && distance(end, first) <= EPS_LEN);
    if (!matches) return null;
  }
  return chain;
}

function redivideCurve(
  doc: ModelDocument,
  context: DefinitionId,
  curveId: CurveId,
  oldParams: CircularParams,
  chain: EdgeChain,
  segments: number,
): EdgeId[] {
  if (oldParams.kind === 'circle' && segments < MIN_CLOSED_CURVE_SEGMENTS) {
    throw new KernelError('invalid-operation', 'A circle needs at least three segments');
  }
  const store = doc.store(context);
  const params: CircularParams = { ...oldParams, segments };
  const oldVertices = chain.closed ? chain.vertices.slice(0, -1) : [...chain.vertices];
  const oldPositions = oldVertices.map((vertex) => store.position(vertex));
  let points = curvePoints(params).points;

  // Orient the new points like the old chain: arcs by their start point, circles by their turning direction.
  if (chain.closed) {
    if (dot(newellNormal(oldPositions), params.normal) < 0) points = [...points].reverse();
  } else if (distance(points[0] ?? params.center, oldPositions[0] ?? params.center) > EPS_LEN) {
    points = [...points].reverse();
  }

  // Reuse old vertices that sit where new ones go (always the arc ends), so nothing is duplicated.
  const newVertices = points.map((point) => {
    const index = oldPositions.findIndex((old) => distance(old, point) <= EPS_LEN);
    return index >= 0
      ? (oldVertices[index] ?? addVertex(doc, context, point))
      : addVertex(doc, context, point);
  });
  const attributes = store.getEdge(chain.edges[0] ?? (-1 as EdgeId)).attributes;
  const edgeCount = chain.closed ? newVertices.length : newVertices.length - 1;
  const ring = (i: number): VertexId => newVertices[i % newVertices.length] ?? (-1 as VertexId);
  const newEdges = Array.from({ length: edgeCount }, (_, i) => {
    const existing = store.edgeBetween(ring(i), ring(i + 1));
    return existing?.id ?? addEdge(doc, context, ring(i), ring(i + 1), attributes);
  });
  assertClear(store, newEdges, new Set([...chain.edges, ...newEdges]));

  const oldEdges = new Set(chain.edges);
  const oldIndex = new Map(chain.vertices.map((vertex, i) => [vertex, i] as const));
  const faces = new Set<FaceId>(chain.edges.flatMap((id) => store.getEdge(id).faces));
  const newUse = (from: VertexId, edgeId: EdgeId): LoopUse => ({
    edge: edgeId,
    reversed: store.getEdge(edgeId).v0 !== from,
  });
  const forwardUses = newEdges.map((edgeId, i) => newUse(ring(i), edgeId));
  const backwardUses = [...newEdges].reverse().map((edgeId, k) => newUse(ring(edgeCount - k), edgeId));

  const replaceInLoop = (loop: Loop): Loop => {
    if (!loop.some((use) => oldEdges.has(use.edge))) return loop;
    const forward = (use: LoopUse): boolean => {
      const from = oldIndex.get(store.useStart(use)) ?? 0;
      const to = oldIndex.get(store.useEnd(use)) ?? 0;
      return chain.closed ? to === (from + 1) % oldVertices.length : to > from;
    };
    if (chain.closed) {
      // Inner vertices join only curve edges, so a loop using a circle edge is the whole circle.
      return loop[0] && forward(loop[0]) ? forwardUses : backwardUses;
    }
    const offset = loop.findIndex((use) => !oldEdges.has(use.edge));
    const rotated = [...loop.slice(offset), ...loop.slice(0, offset)];
    const result: LoopUse[] = [];
    let inRun = false;
    for (const use of rotated) {
      if (!oldEdges.has(use.edge)) {
        inRun = false;
        result.push(use);
      } else if (!inRun) {
        inRun = true;
        result.push(...(forward(use) ? forwardUses : backwardUses));
      }
    }
    return result;
  };
  for (const faceId of [...faces].sort(byId)) {
    const face = store.getFace(faceId);
    setFaceLoops(doc, context, faceId, {
      outer: replaceInLoop(face.outer),
      inners: face.inners.map(replaceInLoop),
    });
  }

  setCurveEdges(doc, context, curveId, newEdges);
  setCurveParams(doc, context, curveId, params);
  const kept = new Set(newEdges);
  for (const edgeId of chain.edges) if (!kept.has(edgeId)) removeEdge(doc, context, edgeId);
  for (const vertex of oldVertices) {
    if (store.vertex(vertex)?.edges.length === 0) removeVertex(doc, context, vertex);
  }
  return newEdges;
}

/** Refuses new edges that would touch geometry outside `own` anywhere but at a shared vertex. */
function assertClear(store: EntityStore, edges: readonly EdgeId[], own: ReadonlySet<EdgeId>): void {
  for (const edgeId of edges) {
    const edge = store.getEdge(edgeId);
    const a: Vec3 = store.position(edge.v0);
    const b: Vec3 = store.position(edge.v1);
    for (const otherId of store.queryEdges(aabbExpand(store.edgeBounds(edgeId), EPS_LEN))) {
      if (own.has(otherId)) continue;
      const other = store.getEdge(otherId);
      const shared = [other.v0, other.v1].some((v) => v === edge.v0 || v === edge.v1);
      if (shared) continue;
      if (
        closestPointsOnSegments(a, b, store.position(other.v0), store.position(other.v1)).distance <= EPS_LEN
      ) {
        throw new KernelError('invalid-operation', 'The divided curve would cross other geometry');
      }
    }
  }
}

/**
 * Welds a connected, simple chain of edges (open or closed) into one polyline curve and returns it. Edges may already
 * belong to curves only if every edge of those curves is in the selection; those curves are merged. A selection that
 * is exactly one existing curve returns that curve unchanged.
 */
export function weldEdges(doc: ModelDocument, context: DefinitionId, edgeIds: readonly EdgeId[]): CurveId {
  return doc.transact('Weld edges', () => {
    const store = doc.store(context);
    const unique = [...new Set(edgeIds)];
    if (unique.length < 2) {
      throw new KernelError('invalid-operation', 'Select at least two connected edges to weld');
    }
    const chain = orderEdgeChain(store, unique);
    const selected = new Set(unique);
    const curves = [...new Set(unique.flatMap((id) => store.getEdge(id).curve ?? []))].sort(byId);
    for (const curveId of curves) {
      if (!store.getCurve(curveId).edges.every((id) => selected.has(id))) {
        throw new KernelError(
          'invalid-operation',
          'Some edges belong to a curve that is only partly selected',
        );
      }
    }
    const [only] = curves;
    if (curves.length === 1 && only !== undefined && store.getCurve(only).edges.length === unique.length) {
      return only;
    }
    for (const curveId of curves) removeCurve(doc, context, curveId);
    return addCurve(doc, context, { kind: 'polyline' }, chain.edges);
  });
}

/** Removes a curve entity. Its edges stay, as separate edges. */
export function explodeCurve(doc: ModelDocument, context: DefinitionId, curveId: CurveId): void {
  doc.transact('Explode curve', () => {
    removeCurve(doc, context, curveId);
  });
}
