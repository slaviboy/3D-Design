import { KernelError } from '../errors';
import type { DefinitionId, EdgeId, FaceId, InstanceId, VertexId } from '../ids';
import { aabbExpand } from '../math/aabb';
import { multiply, transformPoint, type Mat4 } from '../math/mat4';
import { isPointOnPlane } from '../math/plane';
import { closestPointsOnSegments, distancePointToSegment } from '../math/segment';
import type { EntityStore } from '../model/EntityStore';
import type { ModelDocument } from '../model/ModelDocument';
import {
  addEdge,
  addFace,
  addInstance,
  moveVertex,
  removeFace,
  setInstanceTransform,
} from '../model/mutations';
import type { LoopUse } from '../model/types';
import { EPS_LEN } from '../tolerance';
import { removeEdgeAndOrphans } from './erase';
import { captureFragment, insertFragment } from './fragment';

export interface TransformSelection {
  readonly faces?: readonly FaceId[];
  readonly edges?: readonly EdgeId[];
  readonly vertices?: readonly VertexId[];
  readonly instances?: readonly InstanceId[];
}

export interface TransformOptions {
  /** Leave the originals in place and transform copies. */
  readonly copy?: boolean;
  /** Fold four-sided faces that a stretch bends out of plane (on by default). */
  readonly autofold?: boolean;
}

export interface TransformResult {
  readonly faces: readonly FaceId[];
  readonly edges: readonly EdgeId[];
  readonly instances: readonly InstanceId[];
}

const byId = (a: number, b: number): number => a - b;

/**
 * Moves or copies entities by an affine transform.
 *
 * - Instances get a new transform, or a new instance when copying.
 * - Copies, and geometry that isn't connected to anything else, are lifted out and inserted again, so they merge with
 *   whatever they land on.
 * - Geometry connected to unselected geometry is moved in place and the connected faces stretch. Four-sided faces
 *   that bend are folded along a diagonal. The operation is refused (and rolled back) if it would bend other faces
 *   or make the moved geometry touch other geometry.
 */
export function transformEntities(
  doc: ModelDocument,
  context: DefinitionId,
  selection: TransformSelection,
  transform: Mat4,
  options: TransformOptions = {},
): TransformResult {
  return doc.transact(options.copy === true ? 'Copy' : 'Move', () => {
    const store = doc.store(context);
    const faces = [...new Set(selection.faces ?? [])].filter((id) => store.face(id)).sort(byId);
    const edges = new Set((selection.edges ?? []).filter((id) => store.edge(id)));
    for (const faceId of faces) for (const edgeId of store.faceEdges(faceId)) edges.add(edgeId);
    const vertices = new Set((selection.vertices ?? []).filter((id) => store.vertex(id)));
    for (const edgeId of edges) {
      const edge = store.getEdge(edgeId);
      vertices.add(edge.v0);
      vertices.add(edge.v1);
    }
    const instances = [...new Set(selection.instances ?? [])].filter((id) => store.instance(id)).sort(byId);

    let geometry: { faces: readonly FaceId[]; edges: readonly EdgeId[] } = { faces: [], edges: [] };
    if (vertices.size > 0) {
      if (options.copy === true || isDetached(store, new Set(faces), edges, vertices)) {
        const fragment = captureFragment(store, { faces, edges: [...edges].sort(byId), instances: [] });
        if (options.copy !== true) {
          for (const faceId of faces) removeFace(doc, context, faceId);
          for (const edgeId of [...edges].sort(byId)) {
            if (store.edge(edgeId)?.faces.length === 0) removeEdgeAndOrphans(doc, context, edgeId);
          }
        }
        geometry = insertFragment(doc, context, fragment, transform, 'merge');
      } else {
        for (const vertex of [...vertices].sort(byId)) {
          moveVertex(doc, context, vertex, transformPoint(transform, store.position(vertex)));
        }
        foldBentFaces(doc, context, vertices, options.autofold ?? true);
        assertNoContact(store, vertices);
        geometry = { faces: faces.filter((id) => store.face(id)), edges: [...edges].sort(byId) };
      }
    }

    const movedInstances = instances.map((instanceId) => {
      const instance = store.getInstance(instanceId);
      const moved = multiply(transform, instance.transform);
      if (options.copy === true)
        return addInstance(doc, context, instance.definitionId, moved, instance.attributes);
      setInstanceTransform(doc, context, instanceId, moved);
      return instanceId;
    });
    return { ...geometry, instances: movedInstances };
  });
}

/**
 * Copies entities several times, for arrays. `transformFor(k)` is the transform of the k-th copy (k = 1…count).
 * Returns the entities of all copies.
 */
export function copyRepeatedly(
  doc: ModelDocument,
  context: DefinitionId,
  selection: TransformSelection,
  count: number,
  transformFor: (copyIndex: number) => Mat4,
): TransformResult {
  if (!Number.isInteger(count) || count < 1) {
    throw new KernelError('invalid-operation', 'The number of copies must be a whole number of at least 1');
  }
  return doc.transact('Copy', () => {
    const faces: FaceId[] = [];
    const edges: EdgeId[] = [];
    const instances: InstanceId[] = [];
    for (let k = 1; k <= count; k++) {
      const result = transformEntities(doc, context, selection, transformFor(k), { copy: true });
      faces.push(...result.faces);
      edges.push(...result.edges);
      instances.push(...result.instances);
    }
    return { faces, edges, instances };
  });
}

/** True when nothing outside the selection shares a vertex or an edge with it. */
function isDetached(
  store: EntityStore,
  faces: ReadonlySet<FaceId>,
  edges: ReadonlySet<EdgeId>,
  vertices: ReadonlySet<VertexId>,
): boolean {
  for (const vertex of vertices) {
    for (const edgeId of store.getVertex(vertex).edges) {
      if (!edges.has(edgeId)) return false;
      if (store.getEdge(edgeId).faces.some((faceId) => !faces.has(faceId))) return false;
    }
  }
  return true;
}

/** Folds four-sided faces bent by moved vertices into two planar triangles; refuses any other bent face. */
function foldBentFaces(
  doc: ModelDocument,
  context: DefinitionId,
  moved: ReadonlySet<VertexId>,
  autofold: boolean,
): void {
  const store = doc.store(context);
  const touched = new Set<FaceId>();
  for (const vertex of moved) {
    for (const edgeId of store.getVertex(vertex).edges) {
      for (const faceId of store.getEdge(edgeId).faces) touched.add(faceId);
    }
  }
  for (const faceId of [...touched].sort(byId)) {
    const face = store.getFace(faceId);
    const plane = face.plane;
    const points = store.faceLoops(faceId).flatMap((loop) => store.loopPoints(loop));
    if (plane && points.every((p) => isPointOnPlane(plane, p))) continue;
    if (!autofold) throw new KernelError('invalid-geometry', 'The move would bend a face out of its plane');
    if (face.inners.length > 0 || face.outer.length !== 4) {
      throw new KernelError(
        'invalid-geometry',
        'The move would bend a face that cannot be folded automatically',
      );
    }
    const corners = store.loopVertices(face.outer);
    const unmovedDiagonal = (start: number): boolean => {
      const from = corners[start];
      const to = corners[start + 2];
      return from !== undefined && to !== undefined && !moved.has(from) && !moved.has(to);
    };
    // Fold along a diagonal whose corners did not move, so a moved corner ends up in its own triangle.
    const start = unmovedDiagonal(0) ? 0 : unmovedDiagonal(1) ? 1 : 0;
    const [first, second, third, fourth] = [...face.outer.slice(start), ...face.outer.slice(0, start)];
    const from = corners[start];
    const to = corners[start + 2];
    if (!first || !second || !third || !fourth || from === undefined || to === undefined) continue;
    const attributes = face.attributes;
    removeFace(doc, context, faceId);
    const diagonal = store.edgeBetween(from, to)?.id ?? addEdge(doc, context, from, to);
    const startsAtFrom = store.getEdge(diagonal).v0 === from;
    const closingFirst: LoopUse = { edge: diagonal, reversed: startsAtFrom };
    const closingSecond: LoopUse = { edge: diagonal, reversed: !startsAtFrom };
    addFace(doc, context, { outer: [first, second, closingFirst], inners: [] }, attributes);
    addFace(doc, context, { outer: [third, fourth, closingSecond], inners: [] }, attributes);
  }
}

/** Refuses a stretch that leaves moved vertices or edges touching other geometry (which would need merging). */
function assertNoContact(store: EntityStore, moved: ReadonlySet<VertexId>): void {
  const conflict = (): never => {
    throw new KernelError(
      'invalid-operation',
      'The moved geometry would touch other geometry. Make it a group first, or move it clear.',
    );
  };
  for (const vertex of moved) {
    const position = store.position(vertex);
    if (store.verticesWithin(position, EPS_LEN).some((other) => other !== vertex)) conflict();
    for (const edgeId of store.getVertex(vertex).edges) {
      const edge = store.getEdge(edgeId);
      const a = store.position(edge.v0);
      const b = store.position(edge.v1);
      for (const otherId of store.queryEdges(aabbExpand(store.edgeBounds(edgeId), EPS_LEN))) {
        if (otherId === edgeId) continue;
        const other = store.getEdge(otherId);
        const c = store.position(other.v0);
        const d = store.position(other.v1);
        const shared = [other.v0, other.v1].find((v) => v === edge.v0 || v === edge.v1);
        if (shared === undefined) {
          // Covers crossings and a moved vertex landing on another edge's interior.
          if (closestPointsOnSegments(a, b, c, d).distance <= EPS_LEN) conflict();
          continue;
        }
        // Edges meeting at a vertex must not overlap: neither far endpoint may lie on the other edge.
        const otherFar = other.v0 === shared ? d : c;
        const edgeFar = edge.v0 === shared ? b : a;
        if (
          distancePointToSegment(otherFar, a, b) <= EPS_LEN ||
          distancePointToSegment(edgeFar, c, d) <= EPS_LEN
        ) {
          conflict();
        }
      }
    }
  }
}
