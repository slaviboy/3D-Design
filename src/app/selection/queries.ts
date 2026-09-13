import type { EdgeId, FaceId, InstanceId, SectionPlaneId, TagId, VertexId } from '../../kernel/ids';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { isTagVisible } from '../../kernel/model/visibility';
import type { EntityRef } from './Selection';

const faceRef = (id: number): EntityRef => ({ kind: 'face', id });
const edgeRef = (id: number): EntityRef => ({ kind: 'edge', id });

/** Edges that can be seen and picked: hidden and soft edges are not drawn. */
export function isEdgeSelectable(store: EntityStore, id: EdgeId): boolean {
  const edge = store.edge(id);
  return edge !== undefined && !edge.attributes.hidden && !edge.attributes.soft;
}

export function refExists(store: EntityStore, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'face':
      return store.face(ref.id as FaceId) !== undefined;
    case 'edge':
      return store.edge(ref.id as EdgeId) !== undefined;
    case 'instance':
      return store.instance(ref.id as InstanceId) !== undefined;
    case 'section':
      return store.sectionPlane(ref.id as SectionPlaneId) !== undefined;
  }
}

/** Everything visible in a context, as used by Select All. With `doc`, entities on hidden tags are left out. */
export function allSelectableRefs(store: EntityStore, doc?: ModelDocument): EntityRef[] {
  const shown = (tagId: TagId | null): boolean => !doc || isTagVisible(doc, tagId);
  const refs: EntityRef[] = [];
  for (const instance of store.instances()) {
    if (!instance.attributes.hidden && shown(instance.attributes.tagId)) {
      refs.push({ kind: 'instance', id: instance.id });
    }
  }
  for (const face of store.faces()) {
    if (!face.attributes.hidden && shown(face.attributes.tagId)) refs.push(faceRef(face.id));
  }
  for (const edge of store.edges()) {
    if (isEdgeSelectable(store, edge.id) && shown(edge.attributes.tagId)) refs.push(edgeRef(edge.id));
  }
  return refs;
}

/** Whether a selected entity is on a visible tag (or untagged). Missing entities count as visible. */
export function isRefOnVisibleTag(doc: ModelDocument, store: EntityStore, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'face':
      return isTagVisible(doc, store.face(ref.id as FaceId)?.attributes.tagId ?? null);
    case 'edge':
      return isTagVisible(doc, store.edge(ref.id as EdgeId)?.attributes.tagId ?? null);
    case 'instance':
      return isTagVisible(doc, store.instance(ref.id as InstanceId)?.attributes.tagId ?? null);
    case 'section':
      return true;
  }
}

/** A face together with its boundary edges (double-click on a face). */
export function faceWithBoundaryEdges(store: EntityStore, id: FaceId): EntityRef[] {
  return [
    faceRef(id),
    ...store
      .faceEdges(id)
      .filter((edge) => isEdgeSelectable(store, edge))
      .map(edgeRef),
  ];
}

/** An edge together with the faces it bounds (double-click on an edge). */
export function edgeWithAdjacentFaces(store: EntityStore, id: EdgeId): EntityRef[] {
  return [edgeRef(id), ...store.getEdge(id).faces.map(faceRef)];
}

/** All faces and edges connected to the start entity through shared vertices (triple-click). */
export function connectedGeometry(store: EntityStore, start: EntityRef): EntityRef[] {
  if (start.kind === 'instance' || start.kind === 'section') return [start];
  const vertices: VertexId[] = [];
  if (start.kind === 'face') {
    for (const loop of store.faceLoops(start.id as FaceId)) vertices.push(...store.loopVertices(loop));
  } else {
    const edge = store.getEdge(start.id as EdgeId);
    vertices.push(edge.v0, edge.v1);
  }
  const seenVertices = new Set<VertexId>(vertices);
  const edges = new Set<EdgeId>();
  const faces = new Set<FaceId>();
  while (vertices.length > 0) {
    const vertex = vertices.pop();
    if (vertex === undefined) break;
    for (const edgeId of store.getVertex(vertex).edges) {
      if (edges.has(edgeId)) continue;
      edges.add(edgeId);
      const edge = store.getEdge(edgeId);
      for (const faceId of edge.faces) faces.add(faceId);
      for (const next of [edge.v0, edge.v1]) {
        if (!seenVertices.has(next)) {
          seenVertices.add(next);
          vertices.push(next);
        }
      }
    }
  }
  return [
    ...[...faces].filter((id) => !store.getFace(id).attributes.hidden).map(faceRef),
    ...[...edges].filter((id) => isEdgeSelectable(store, id)).map(edgeRef),
  ];
}
