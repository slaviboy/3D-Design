import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, InstanceId, MaterialId, TagId, VertexId } from '../ids';
import { IDENTITY, invertAffine, isMat4, type Mat4 } from '../math/mat4';
import { planeFromPolygon } from '../math/plane';
import { distance, isFiniteVec3, type Vec3 } from '../math/vec3';
import { EPS_LEN } from '../tolerance';
import type { EntityStore } from './EntityStore';
import type { ModelDocument } from './ModelDocument';
import {
  DEFAULT_EDGE_ATTRIBUTES,
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type CurveParams,
  type DefinitionAttributes,
  type EdgeAttributes,
  type FaceAttributes,
  type FaceLoops,
  type InstanceAttributes,
  type Loop,
  type LoopUse,
  type MaterialAttributes,
  type TagAttributes,
} from './types';

/*
 * Primitive mutations. Each builds one Change, with fresh ids and full inverse data, and applies it through
 * ModelDocument.apply, so it must run inside a transaction. Higher-level operations in `kernel/ops` are built
 * only from these.
 */

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

// -------------------------------------------------------------------------------------------------- vertices

export function addVertex(doc: ModelDocument, context: DefinitionId, position: Vec3): VertexId {
  if (!isFiniteVec3(position)) throw new KernelError('invalid-geometry', 'Vertex coordinates must be finite');
  const id = doc.ids.allocate() as VertexId;
  doc.apply({ kind: 'vertex.add', context, data: { id, position } });
  return id;
}

export function removeVertex(doc: ModelDocument, context: DefinitionId, id: VertexId): void {
  const vertex = doc.store(context).getVertex(id);
  doc.apply({ kind: 'vertex.remove', context, data: { id, position: vertex.position } });
}

export function moveVertex(doc: ModelDocument, context: DefinitionId, id: VertexId, to: Vec3): void {
  if (!isFiniteVec3(to)) throw new KernelError('invalid-geometry', 'Vertex coordinates must be finite');
  const from = doc.store(context).getVertex(id).position;
  if (from.x === to.x && from.y === to.y && from.z === to.z) return;
  doc.apply({ kind: 'vertex.move', context, id, from, to });
}

// -------------------------------------------------------------------------------------------------- edges

export function addEdge(
  doc: ModelDocument,
  context: DefinitionId,
  v0: VertexId,
  v1: VertexId,
  attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES,
): EdgeId {
  const store = doc.store(context);
  if (v0 === v1) throw new KernelError('invalid-geometry', 'An edge needs two different vertices');
  if (distance(store.position(v0), store.position(v1)) <= EPS_LEN) {
    throw new KernelError('invalid-geometry', 'The edge is shorter than the length tolerance');
  }
  if (store.edgeBetween(v0, v1)) {
    throw new KernelError(
      'duplicate-entity',
      `An edge already joins vertices ${String(v0)} and ${String(v1)}`,
    );
  }
  const id = doc.ids.allocate() as EdgeId;
  doc.apply({ kind: 'edge.add', context, data: { id, v0, v1, attributes } });
  return id;
}

export function removeEdge(doc: ModelDocument, context: DefinitionId, id: EdgeId): void {
  const edge = doc.store(context).getEdge(id);
  doc.apply({
    kind: 'edge.remove',
    context,
    data: { id, v0: edge.v0, v1: edge.v1, attributes: edge.attributes },
  });
}

export function setEdgeAttributes(
  doc: ModelDocument,
  context: DefinitionId,
  id: EdgeId,
  patch: Partial<EdgeAttributes>,
): void {
  const from = doc.store(context).getEdge(id).attributes;
  const to: EdgeAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'edge.attributes', context, id, from, to });
}

export interface SplitEdgeResult {
  readonly vertex: VertexId;
  /** The part from the original `v0` to the new vertex. */
  readonly first: EdgeId;
  /** The part from the new vertex to the original `v1`. */
  readonly second: EdgeId;
}

/** Splits an edge at `position`, which must lie strictly inside it. Face loops and the curve chain are updated. */
export function splitEdge(
  doc: ModelDocument,
  context: DefinitionId,
  edgeId: EdgeId,
  position: Vec3,
): SplitEdgeResult {
  const store = doc.store(context);
  const edge = store.getEdge(edgeId);
  const { v0, v1, attributes } = edge;
  const faces = [...edge.faces];
  const curveId = edge.curve;

  const vertex = addVertex(doc, context, position);
  const first = addEdge(doc, context, v0, vertex, attributes);
  const second = addEdge(doc, context, vertex, v1, attributes);

  const replaceInLoop = (loop: Loop): Loop =>
    loop.flatMap((use): LoopUse[] => {
      if (use.edge !== edgeId) return [use];
      return use.reversed
        ? [
            { edge: second, reversed: true },
            { edge: first, reversed: true },
          ]
        : [
            { edge: first, reversed: false },
            { edge: second, reversed: false },
          ];
    });

  for (const faceId of faces) {
    const face = store.getFace(faceId);
    setFaceLoops(doc, context, faceId, {
      outer: replaceInLoop(face.outer),
      inners: face.inners.map(replaceInLoop),
    });
  }

  if (curveId !== null) {
    const chain = store.getCurve(curveId).edges;
    setCurveEdges(doc, context, curveId, replaceInChain(store, chain, edgeId, first, second, v0, v1));
  }

  removeEdge(doc, context, edgeId);
  return { vertex, first, second };
}

/** Replaces `edgeId` in a curve chain with its two halves, keeping the chain's direction of travel. */
function replaceInChain(
  store: EntityStore,
  chain: readonly EdgeId[],
  edgeId: EdgeId,
  first: EdgeId,
  second: EdgeId,
  v0: VertexId,
  v1: VertexId,
): EdgeId[] {
  const index = chain.indexOf(edgeId);
  if (index < 0) return [...chain];
  const touches = (neighbour: EdgeId | undefined, vertex: VertexId): boolean => {
    if (neighbour === undefined) return false;
    const e = store.getEdge(neighbour);
    return e.v0 === vertex || e.v1 === vertex;
  };
  const previous = chain[index - 1];
  const next = chain[index + 1];
  let forward = true;
  if (previous !== undefined) forward = touches(previous, v0);
  else if (next !== undefined) forward = touches(next, v1);
  return [
    ...chain.slice(0, index),
    ...(forward ? [first, second] : [second, first]),
    ...chain.slice(index + 1),
  ];
}

// -------------------------------------------------------------------------------------------------- faces

/** The same loop traversed in the opposite direction. */
export function reverseLoop(loop: Loop): Loop {
  return [...loop].reverse().map((use) => ({ edge: use.edge, reversed: !use.reversed }));
}

function assertUsableLoops(store: EntityStore, loops: FaceLoops): void {
  for (const loop of [loops.outer, ...loops.inners]) {
    if (loop.length < 3) throw new KernelError('invalid-geometry', 'A face loop needs at least three edges');
    for (const use of loop) store.getEdge(use.edge);
  }
  if (!planeFromPolygon(store.loopPoints(loops.outer))) {
    throw new KernelError('invalid-geometry', 'The face outline has no area');
  }
}

export function addFace(
  doc: ModelDocument,
  context: DefinitionId,
  loops: FaceLoops,
  attributes: FaceAttributes = DEFAULT_FACE_ATTRIBUTES,
): FaceId {
  assertUsableLoops(doc.store(context), loops);
  const id = doc.ids.allocate() as FaceId;
  doc.apply({
    kind: 'face.add',
    context,
    data: { id, outer: loops.outer, inners: loops.inners, attributes },
  });
  return id;
}

export function removeFace(doc: ModelDocument, context: DefinitionId, id: FaceId): void {
  const face = doc.store(context).getFace(id);
  doc.apply({
    kind: 'face.remove',
    context,
    data: { id, outer: face.outer, inners: face.inners, attributes: face.attributes },
  });
}

export function setFaceLoops(doc: ModelDocument, context: DefinitionId, id: FaceId, loops: FaceLoops): void {
  const store = doc.store(context);
  assertUsableLoops(store, loops);
  const face = store.getFace(id);
  doc.apply({
    kind: 'face.loops',
    context,
    id,
    from: { outer: face.outer, inners: face.inners },
    to: { outer: loops.outer, inners: loops.inners },
  });
}

export function setFaceAttributes(
  doc: ModelDocument,
  context: DefinitionId,
  id: FaceId,
  patch: Partial<FaceAttributes>,
): void {
  const from = doc.store(context).getFace(id).attributes;
  const to: FaceAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'face.attributes', context, id, from, to });
}

/** Flips a face so its front becomes its back. */
export function reverseFace(doc: ModelDocument, context: DefinitionId, id: FaceId): void {
  const face = doc.store(context).getFace(id);
  setFaceLoops(doc, context, id, { outer: reverseLoop(face.outer), inners: face.inners.map(reverseLoop) });
}

// -------------------------------------------------------------------------------------------------- curves

export function addCurve(
  doc: ModelDocument,
  context: DefinitionId,
  params: CurveParams,
  edges: readonly EdgeId[],
): CurveId {
  if (edges.length === 0) throw new KernelError('invalid-operation', 'A curve needs at least one edge');
  const id = doc.ids.allocate() as CurveId;
  doc.apply({ kind: 'curve.add', context, data: { id, params, edges } });
  return id;
}

export function removeCurve(doc: ModelDocument, context: DefinitionId, id: CurveId): void {
  const curve = doc.store(context).getCurve(id);
  doc.apply({ kind: 'curve.remove', context, data: { id, params: curve.params, edges: curve.edges } });
}

export function setCurveEdges(
  doc: ModelDocument,
  context: DefinitionId,
  id: CurveId,
  edges: readonly EdgeId[],
): void {
  const from = doc.store(context).getCurve(id).edges;
  doc.apply({ kind: 'curve.edges', context, id, from, to: edges });
}

export function setCurveParams(
  doc: ModelDocument,
  context: DefinitionId,
  id: CurveId,
  params: CurveParams,
): void {
  const from = doc.store(context).getCurve(id).params;
  doc.apply({ kind: 'curve.params', context, id, from, to: params });
}

// -------------------------------------------------------------------------------------------------- definitions & instances

export function addDefinition(doc: ModelDocument, attributes: DefinitionAttributes): DefinitionId {
  const id = doc.ids.allocate() as DefinitionId;
  doc.apply({ kind: 'definition.add', data: { id, name: attributes.name, isGroup: attributes.isGroup } });
  return id;
}

export function removeDefinition(doc: ModelDocument, id: DefinitionId): void {
  const definition = doc.getDefinition(id);
  doc.apply({ kind: 'definition.remove', data: { id, ...definition.attributes } });
}

export function setDefinitionAttributes(
  doc: ModelDocument,
  id: DefinitionId,
  patch: Partial<DefinitionAttributes>,
): void {
  const from = doc.getDefinition(id).attributes;
  const to: DefinitionAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'definition.attributes', id, from, to });
}

function assertUsableTransform(transform: Mat4): void {
  if (!isMat4(transform) || !invertAffine(transform)) {
    throw new KernelError('invalid-geometry', 'An instance transform must be finite and invertible');
  }
}

export function addInstance(
  doc: ModelDocument,
  context: DefinitionId,
  definitionId: DefinitionId,
  transform: Mat4 = IDENTITY,
  attributes: InstanceAttributes = DEFAULT_INSTANCE_ATTRIBUTES,
  id?: InstanceId,
): InstanceId {
  assertUsableTransform(transform);
  const instanceId = id ?? (doc.ids.allocate() as InstanceId);
  doc.apply({ kind: 'instance.add', context, data: { id: instanceId, definitionId, transform, attributes } });
  return instanceId;
}

export function removeInstance(doc: ModelDocument, context: DefinitionId, id: InstanceId): void {
  const instance = doc.store(context).getInstance(id);
  doc.apply({
    kind: 'instance.remove',
    context,
    data: {
      id,
      definitionId: instance.definitionId,
      transform: instance.transform,
      attributes: instance.attributes,
    },
  });
}

export function setInstanceTransform(
  doc: ModelDocument,
  context: DefinitionId,
  id: InstanceId,
  transform: Mat4,
): void {
  assertUsableTransform(transform);
  const from = doc.store(context).getInstance(id).transform;
  doc.apply({ kind: 'instance.transform', context, id, from, to: transform });
}

export function setInstanceAttributes(
  doc: ModelDocument,
  context: DefinitionId,
  id: InstanceId,
  patch: Partial<InstanceAttributes>,
): void {
  const from = doc.store(context).getInstance(id).attributes;
  const to: InstanceAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'instance.attributes', context, id, from, to });
}

// -------------------------------------------------------------------------------------------------- materials & tags

export function addMaterial(doc: ModelDocument, attributes: MaterialAttributes): MaterialId {
  const id = doc.ids.allocate() as MaterialId;
  doc.apply({ kind: 'material.add', data: { id, ...attributes } });
  return id;
}

export function removeMaterial(doc: ModelDocument, id: MaterialId): void {
  const material = doc.material(id);
  if (!material) throw new KernelError('missing-entity', `Material ${String(id)} does not exist`);
  doc.apply({ kind: 'material.remove', data: material });
}

export function setMaterialAttributes(
  doc: ModelDocument,
  id: MaterialId,
  patch: Partial<MaterialAttributes>,
): void {
  const material = doc.material(id);
  if (!material) throw new KernelError('missing-entity', `Material ${String(id)} does not exist`);
  const from: MaterialAttributes = { name: material.name, color: material.color, opacity: material.opacity };
  const to: MaterialAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'material.attributes', id, from, to });
}

export function addTag(doc: ModelDocument, attributes: TagAttributes): TagId {
  const id = doc.ids.allocate() as TagId;
  doc.apply({ kind: 'tag.add', data: { id, ...attributes } });
  return id;
}

export function removeTag(doc: ModelDocument, id: TagId): void {
  const tag = doc.tag(id);
  if (!tag) throw new KernelError('missing-entity', `Tag ${String(id)} does not exist`);
  doc.apply({ kind: 'tag.remove', data: tag });
}

export function setTagAttributes(doc: ModelDocument, id: TagId, patch: Partial<TagAttributes>): void {
  const tag = doc.tag(id);
  if (!tag) throw new KernelError('missing-entity', `Tag ${String(id)} does not exist`);
  const from: TagAttributes = { name: tag.name, visible: tag.visible };
  const to: TagAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'tag.attributes', id, from, to });
}
