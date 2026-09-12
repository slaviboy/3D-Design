import type { EdgeId, VertexId } from '../../ids';
import { orient, signedArea, type Point2 } from '../../math/geom2d';
import type { LoopUse } from '../../model/types';

export interface PlanarEdge {
  readonly id: EdgeId;
  readonly v0: VertexId;
  readonly v1: VertexId;
}

export interface PlanarCycle {
  readonly uses: readonly LoopUse[];
  readonly vertices: readonly VertexId[];
  readonly points: readonly Point2[];
  /** Signed area: positive for a bounded region's boundary (counter-clockwise), negative for the outside of a component. */
  readonly area: number;
  /** Connected component (of the pruned graph) that the cycle belongs to. */
  readonly component: number;
}

export interface PlanarCycles {
  readonly cycles: readonly PlanarCycle[];
  /** Edges removed because they don't separate two different cycles (spurs and bridges). */
  readonly prunedEdges: readonly EdgeId[];
}

/**
 * Traces the face cycles of a planar straight-line graph whose edges don't cross (kernel invariant 6).
 *
 * Outgoing half-edges are sorted by angle around each vertex with exact orientation tests. Each half-edge's
 * successor is the next outgoing half-edge clockwise from its twin, so every bounded region is traced
 * counter-clockwise. Edges whose two half-edges land on the same cycle bound no region; they are pruned,
 * and tracing repeats until no such edge remains.
 */
export function tracePlanarCycles(
  edges: readonly PlanarEdge[],
  pointOf: (vertex: VertexId) => Point2,
): PlanarCycles {
  let active = [...edges];
  const prunedEdges: EdgeId[] = [];
  for (;;) {
    const traced = traceOnce(active, pointOf);
    const bridges = new Set<number>();
    for (let i = 0; i < active.length; i++) {
      if (traced.cycleOfHalfEdge[2 * i] === traced.cycleOfHalfEdge[2 * i + 1]) bridges.add(i);
    }
    if (bridges.size === 0) return { cycles: traced.cycles, prunedEdges };
    active = active.filter((edge, index) => {
      if (!bridges.has(index)) return true;
      prunedEdges.push(edge.id);
      return false;
    });
  }
}

interface TraceResult {
  readonly cycles: PlanarCycle[];
  readonly cycleOfHalfEdge: Int32Array;
}

function traceOnce(edges: readonly PlanarEdge[], pointOf: (vertex: VertexId) => Point2): TraceResult {
  const halfEdgeCount = edges.length * 2;
  const edgeOf = (h: number): PlanarEdge => {
    const edge = edges[h >> 1];
    if (!edge) throw new Error(`Invalid half-edge ${String(h)}`);
    return edge;
  };
  const from = (h: number): VertexId => ((h & 1) === 0 ? edgeOf(h).v0 : edgeOf(h).v1);
  const to = (h: number): VertexId => ((h & 1) === 0 ? edgeOf(h).v1 : edgeOf(h).v0);

  const outgoing = new Map<VertexId, number[]>();
  for (let h = 0; h < halfEdgeCount; h++) {
    const list = outgoing.get(from(h));
    if (list) list.push(h);
    else outgoing.set(from(h), [h]);
  }

  const positionInFan = new Int32Array(halfEdgeCount);
  for (const [vertex, fan] of outgoing) {
    const origin = pointOf(vertex);
    fan.sort((ha, hb) => compareDirections(origin, pointOf(to(ha)), pointOf(to(hb))));
    fan.forEach((h, index) => {
      positionInFan[h] = index;
    });
  }

  const next = (h: number): number => {
    const fan = outgoing.get(to(h));
    if (!fan) throw new Error('Planar graph fan missing');
    const twin = h ^ 1;
    const index = positionInFan[twin] ?? 0;
    const successor = fan[(index - 1 + fan.length) % fan.length];
    if (successor === undefined) throw new Error('Planar graph fan is empty');
    return successor;
  };

  const components = connectedComponents(edges);
  const cycleOfHalfEdge = new Int32Array(halfEdgeCount).fill(-1);
  const cycles: PlanarCycle[] = [];
  for (let start = 0; start < halfEdgeCount; start++) {
    if (cycleOfHalfEdge[start] !== -1) continue;
    const cycleIndex = cycles.length;
    const uses: LoopUse[] = [];
    const vertices: VertexId[] = [];
    const points: Point2[] = [];
    let current = start;
    while (cycleOfHalfEdge[current] === -1) {
      cycleOfHalfEdge[current] = cycleIndex;
      uses.push({ edge: edgeOf(current).id, reversed: (current & 1) === 1 });
      const vertex = from(current);
      vertices.push(vertex);
      points.push(pointOf(vertex));
      current = next(current);
    }
    cycles.push({
      uses,
      vertices,
      points,
      area: signedArea(points),
      component: components.get(vertices[0] ?? (-1 as VertexId)) ?? -1,
    });
  }
  return { cycles, cycleOfHalfEdge };
}

/** Orders directions from `origin` counter-clockwise, starting at the positive x axis. Exact. */
function compareDirections(origin: Point2, a: Point2, b: Point2): number {
  const halfA = halfPlane(origin, a);
  const halfB = halfPlane(origin, b);
  if (halfA !== halfB) return halfA - halfB;
  const side = orient(origin, a, b);
  return side > 0 ? -1 : side < 0 ? 1 : 0;
}

/** 0 for directions with angle in [0, π), 1 for [π, 2π). Subtraction signs are exact in IEEE arithmetic. */
function halfPlane(origin: Point2, p: Point2): number {
  const dy = p.y - origin.y;
  const dx = p.x - origin.x;
  return dy > 0 || (dy === 0 && dx > 0) ? 0 : 1;
}

function connectedComponents(edges: readonly PlanarEdge[]): Map<VertexId, number> {
  const parent = new Map<VertexId, VertexId>();
  const find = (v: VertexId): VertexId => {
    let root = v;
    for (let p = parent.get(root); p !== undefined && p !== root; p = parent.get(root)) root = p;
    let current = v;
    while (current !== root) {
      const p = parent.get(current) ?? root;
      parent.set(current, root);
      current = p;
    }
    return root;
  };
  for (const edge of edges) {
    if (!parent.has(edge.v0)) parent.set(edge.v0, edge.v0);
    if (!parent.has(edge.v1)) parent.set(edge.v1, edge.v1);
    const a = find(edge.v0);
    const b = find(edge.v1);
    if (a !== b) parent.set(a > b ? a : b, a > b ? b : a);
  }
  const labels = new Map<VertexId, number>();
  const components = new Map<VertexId, number>();
  for (const vertex of parent.keys()) {
    const root = find(vertex);
    let label = labels.get(root);
    if (label === undefined) {
      label = labels.size;
      labels.set(root, label);
    }
    components.set(vertex, label);
  }
  return components;
}
