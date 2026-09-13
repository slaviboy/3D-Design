import type { FaceId, VertexId } from '../ids';
import { add, normalize, ZERO, type Vec3 } from '../math/vec3';
import type { EntityStore } from '../model/EntityStore';

/**
 * Vertex normals for smooth shading. Faces joined by edges that are both soft and smooth form a smooth surface; at
 * each vertex, every face of that surface gets the normalized sum of the normals of the surface's faces that touch
 * the vertex. Faces that are not part of a smooth surface are absent from the result and keep flat normals.
 */
export function smoothVertexNormals(store: EntityStore): Map<FaceId, Map<VertexId, Vec3>> {
  const parent = new Map<FaceId, FaceId>();
  const find = (face: FaceId): FaceId => {
    let root = face;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) ?? root;
    let current = face;
    while (current !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  for (const edge of store.edges()) {
    if (!edge.attributes.soft || !edge.attributes.smooth || edge.faces.length < 2) continue;
    const [first, ...others] = edge.faces;
    if (first === undefined) continue;
    if (!parent.has(first)) parent.set(first, first);
    for (const other of others) {
      if (!parent.has(other)) parent.set(other, other);
      const a = find(first);
      const b = find(other);
      if (a !== b) parent.set(b, a);
    }
  }
  const sums = new Map<string, Vec3>();
  const keyOf = (group: FaceId, vertex: VertexId): string => `${String(group)}:${String(vertex)}`;
  for (const faceId of parent.keys()) {
    const face = store.face(faceId);
    if (!face?.plane) continue;
    const group = find(faceId);
    for (const vertex of store.faceLoops(faceId).flatMap((loop) => store.loopVertices(loop))) {
      const key = keyOf(group, vertex);
      sums.set(key, add(sums.get(key) ?? ZERO, face.plane.normal));
    }
  }
  const result = new Map<FaceId, Map<VertexId, Vec3>>();
  for (const faceId of parent.keys()) {
    const face = store.face(faceId);
    if (!face?.plane) continue;
    const group = find(faceId);
    const normals = new Map<VertexId, Vec3>();
    for (const vertex of store.faceLoops(faceId).flatMap((loop) => store.loopVertices(loop))) {
      normals.set(vertex, normalize(sums.get(keyOf(group, vertex)) ?? ZERO) ?? face.plane.normal);
    }
    result.set(faceId, normals);
  }
  return result;
}
