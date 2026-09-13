import { KernelError } from '../errors';
import type { EdgeId, VertexId } from '../ids';
import type { EntityStore } from '../model/EntityStore';

/** Edges ordered into one simple chain. */
export interface EdgeChain {
  /** Edges in walking order. */
  readonly edges: readonly EdgeId[];
  /** Vertices in walking order: one more than the edges. For a closed chain the last vertex equals the first. */
  readonly vertices: readonly VertexId[];
  readonly closed: boolean;
}

/**
 * Orders edges into one connected, simple chain, open or closed. The walk follows the first listed edge from its
 * `v0` to its `v1`, so callers can rely on that direction. Throws when there are no edges, when three or more of
 * them meet at a vertex, or when they are not all connected.
 */
export function orderEdgeChain(store: EntityStore, edgeIds: readonly EdgeId[]): EdgeChain {
  const unique = [...new Set(edgeIds)];
  const [first] = unique;
  if (first === undefined) throw new KernelError('invalid-operation', 'Select at least one edge');

  const incident = new Map<VertexId, EdgeId[]>();
  for (const id of unique) {
    const edge = store.getEdge(id);
    for (const vertex of [edge.v0, edge.v1]) {
      const list = incident.get(vertex);
      if (list) list.push(id);
      else incident.set(vertex, [id]);
    }
  }
  for (const list of incident.values()) {
    if (list.length > 2)
      throw new KernelError('invalid-operation', 'The edges branch; select a single chain');
  }
  const nextEdge = (vertex: VertexId, from: EdgeId): EdgeId | undefined =>
    incident.get(vertex)?.find((id) => id !== from);

  const start = store.getEdge(first);
  const edges: EdgeId[] = [first];
  const vertices: VertexId[] = [start.v0, start.v1];
  let closed = false;
  for (let vertex = start.v1, edge = first; ;) {
    const next = nextEdge(vertex, edge);
    if (next === undefined) break;
    if (next === first) {
      closed = true;
      break;
    }
    vertex = store.otherVertex(next, vertex);
    edges.push(next);
    vertices.push(vertex);
    edge = next;
  }
  if (!closed) {
    for (let vertex = start.v0, edge = first; ;) {
      const previous = nextEdge(vertex, edge);
      if (previous === undefined) break;
      vertex = store.otherVertex(previous, vertex);
      edges.unshift(previous);
      vertices.unshift(vertex);
      edge = previous;
    }
  }
  if (edges.length !== unique.length) {
    throw new KernelError('invalid-operation', 'The edges are not connected into one chain');
  }
  return { edges, vertices, closed };
}
