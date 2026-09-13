import { KernelError } from '../errors';
import type { DefinitionId, EdgeId, FaceId, InstanceId, VertexId } from '../ids';
import { IDENTITY, linearDeterminant, multiply, transformPoint, type Mat4 } from '../math/mat4';
import type { ModelDocument } from '../model/ModelDocument';
import {
  addCurve,
  addDefinition,
  addEdge,
  addFace,
  addInstance,
  addVertex,
  removeCurve,
  removeDefinition,
  removeEdge,
  removeFace,
  removeInstance,
  removeVertex,
  reverseLoop,
  removeAnnotation,
  removeGuide,
  removeSectionPlane,
} from '../model/mutations';
import type { DefinitionAttributes, Loop } from '../model/types';
import { splitCurveChains, transformCurveParams } from './curves';
import { removeEdgeAndOrphans } from './erase';
import { captureFragment, insertFragment } from './fragment';

export interface EntitySelection {
  readonly faces?: readonly FaceId[];
  readonly edges?: readonly EdgeId[];
  readonly instances?: readonly InstanceId[];
}

export interface CreatedInstance {
  readonly definition: DefinitionId;
  readonly instance: InstanceId;
}

const byId = (a: number, b: number): number => a - b;

/**
 * Wraps the selection in a new group. Selected faces take their boundary edges into the group. Source edges left
 * without faces are removed, and edges still bounding unselected faces stay behind (a copy goes into the group).
 */
export function makeGroup(
  doc: ModelDocument,
  context: DefinitionId,
  selection: EntitySelection,
): CreatedInstance {
  return createDefinitionFromSelection(
    doc,
    context,
    selection,
    { name: 'Group', isGroup: true },
    'Make Group',
  );
}

/** Like {@link makeGroup}, but the new definition is a reusable component. */
export function makeComponent(
  doc: ModelDocument,
  context: DefinitionId,
  selection: EntitySelection,
  name?: string,
): CreatedInstance {
  return createDefinitionFromSelection(
    doc,
    context,
    selection,
    { name: name ?? uniqueDefinitionName(doc, 'Component'), isGroup: false },
    'Make Component',
  );
}

/** `base#1`, `base#2`, … — the first name that no definition uses yet. */
export function uniqueDefinitionName(doc: ModelDocument, base: string): string {
  const names = new Set([...doc.definitions()].map((definition) => definition.attributes.name));
  const stem = base.replace(/#\d+$/, '');
  for (let n = 1; ; n++) {
    const candidate = `${stem}#${String(n)}`;
    if (!names.has(candidate)) return candidate;
  }
}

function createDefinitionFromSelection(
  doc: ModelDocument,
  context: DefinitionId,
  selection: EntitySelection,
  attributes: DefinitionAttributes,
  label: string,
): CreatedInstance {
  return doc.transact(label, () => {
    const store = doc.store(context);
    const faces = [...new Set(selection.faces ?? [])].filter((id) => store.face(id)).sort(byId);
    const edges = new Set((selection.edges ?? []).filter((id) => store.edge(id)));
    for (const faceId of faces) for (const edgeId of store.faceEdges(faceId)) edges.add(edgeId);
    const instances = [...new Set(selection.instances ?? [])].filter((id) => store.instance(id)).sort(byId);
    if (faces.length === 0 && edges.size === 0 && instances.length === 0) {
      throw new KernelError('invalid-operation', 'Select geometry or objects first');
    }
    const sortedEdges = [...edges].sort(byId);

    const definition = addDefinition(doc, attributes);
    copyEntities(doc, context, definition, { faces, edges: sortedEdges, instances }, IDENTITY);

    for (const instanceId of instances) removeInstance(doc, context, instanceId);
    for (const faceId of faces) removeFace(doc, context, faceId);
    for (const edgeId of sortedEdges) {
      const edge = store.edge(edgeId);
      if (edge?.faces.length === 0) removeEdgeAndOrphans(doc, context, edgeId);
    }
    const instance = addInstance(doc, context, definition);
    return { definition, instance };
  });
}

interface CopySelection {
  readonly faces: readonly FaceId[];
  readonly edges: readonly EdgeId[];
  readonly instances: readonly InstanceId[];
}

/**
 * Copies entities from one definition into another, which must not already contain overlapping geometry
 * (for example, a new definition). Entities get new ids. `transform` maps source coordinates to target
 * coordinates, and faces are reversed under mirroring so their fronts keep facing outward.
 */
function copyEntities(
  doc: ModelDocument,
  from: DefinitionId,
  to: DefinitionId,
  selection: CopySelection,
  transform: Mat4,
): void {
  const source = doc.store(from);
  const vertexMap = new Map<VertexId, VertexId>();
  const edgeMap = new Map<EdgeId, EdgeId>();
  const mirrored = linearDeterminant(transform) < 0;

  const mapVertex = (vertex: VertexId): VertexId => {
    let mapped = vertexMap.get(vertex);
    if (mapped === undefined) {
      mapped = addVertex(doc, to, transformPoint(transform, source.position(vertex)));
      vertexMap.set(vertex, mapped);
    }
    return mapped;
  };
  const mapLoop = (loop: Loop): Loop => {
    const mapped = loop.map((use) => {
      const edge = edgeMap.get(use.edge);
      if (edge === undefined) throw new KernelError('invalid-operation', 'Face edge was not copied');
      return { edge, reversed: use.reversed };
    });
    return mirrored ? reverseLoop(mapped) : mapped;
  };

  for (const edgeId of selection.edges) {
    const edge = source.getEdge(edgeId);
    edgeMap.set(edgeId, addEdge(doc, to, mapVertex(edge.v0), mapVertex(edge.v1), edge.attributes));
  }
  for (const faceId of selection.faces) {
    const face = source.getFace(faceId);
    addFace(doc, to, { outer: mapLoop(face.outer), inners: face.inners.map(mapLoop) }, face.attributes);
  }
  const curveIds = new Set(selection.edges.flatMap((id) => source.getEdge(id).curve ?? []));
  for (const curveId of [...curveIds].sort(byId)) {
    const curve = source.getCurve(curveId);
    const copied = curve.edges.filter((id) => edgeMap.has(id));
    const params =
      copied.length === curve.edges.length
        ? transformCurveParams(curve.params, transform)
        : { kind: 'polyline' as const };
    for (const chain of splitCurveChains(source, copied)) {
      addCurve(
        doc,
        to,
        params,
        chain.map((id) => edgeMap.get(id) ?? id),
      );
    }
  }
  for (const instanceId of selection.instances) {
    const instance = source.getInstance(instanceId);
    addInstance(doc, to, instance.definitionId, multiply(transform, instance.transform), instance.attributes);
  }
}

/**
 * Replaces an instance with its contents, transformed into the containing definition and merged with the geometry
 * already there. An exploded group's definition is deleted once nothing else uses it.
 */
export function explodeInstance(doc: ModelDocument, context: DefinitionId, instanceId: InstanceId): void {
  doc.transact('Explode', () => {
    const store = doc.store(context);
    const instance = store.getInstance(instanceId);
    const definitionId = instance.definitionId;
    const definition = doc.getDefinition(definitionId);
    const source = definition.store;
    removeInstance(doc, context, instanceId);
    const fragment = captureFragment(source, {
      faces: [...source.faces()].map((face) => face.id),
      edges: [...source.edges()].map((edge) => edge.id),
      instances: [...source.instances()].map((child) => child.id),
    });
    insertFragment(doc, context, fragment, instance.transform, 'merge');
    if (definition.attributes.isGroup && doc.instancesOf(definitionId).length === 0) {
      clearDefinition(doc, definitionId);
      removeDefinition(doc, definitionId);
    }
  });
}

/**
 * Gives an instance its own copy of its definition, so later edits affect only that instance. Returns the
 * definition the instance ends up with (unchanged when it was already the only instance).
 */
export function makeUnique(doc: ModelDocument, context: DefinitionId, instanceId: InstanceId): DefinitionId {
  return doc.transact('Make Unique', () => {
    const instance = doc.store(context).getInstance(instanceId);
    const sourceId = instance.definitionId;
    if (doc.instancesOf(sourceId).length <= 1) return sourceId;
    const sourceDefinition = doc.getDefinition(sourceId);
    const source = sourceDefinition.store;
    const copy = addDefinition(doc, {
      name: uniqueDefinitionName(doc, sourceDefinition.attributes.name),
      isGroup: sourceDefinition.attributes.isGroup,
    });
    copyEntities(
      doc,
      sourceId,
      copy,
      {
        faces: [...source.faces()].map((f) => f.id).sort(byId),
        edges: [...source.edges()].map((e) => e.id).sort(byId),
        instances: [...source.instances()].map((i) => i.id).sort(byId),
      },
      IDENTITY,
    );
    const { transform, attributes } = instance;
    removeInstance(doc, context, instanceId);
    addInstance(doc, context, copy, transform, attributes, instanceId);
    return copy;
  });
}

/**
 * Deletes instances. A group definition left without instances is deleted too, along with everything inside it.
 * Component definitions stay available for reuse.
 */
export function deleteInstances(
  doc: ModelDocument,
  context: DefinitionId,
  instanceIds: readonly InstanceId[],
): void {
  doc.transact('Delete', () => {
    const store = doc.store(context);
    for (const instanceId of instanceIds) {
      const instance = store.instance(instanceId);
      if (!instance) continue;
      const definitionId = instance.definitionId;
      removeInstance(doc, context, instanceId);
      if (doc.getDefinition(definitionId).attributes.isGroup && doc.instancesOf(definitionId).length === 0) {
        clearDefinition(doc, definitionId);
        removeDefinition(doc, definitionId);
      }
    }
  });
}

/**
 * Deletes definitions that have no instances anywhere (the root excepted), with their contents. Emptying one can
 * leave definitions nested inside it unused, so this repeats until nothing more can be removed. Returns the deleted
 * ids in deletion order.
 */
export function purgeUnusedDefinitions(doc: ModelDocument): DefinitionId[] {
  return doc.transact('Purge Unused Components', () => {
    const removed: DefinitionId[] = [];
    for (;;) {
      const unused = [...doc.definitions()]
        .map((definition) => definition.id)
        .filter((id) => id !== doc.rootDefinitionId && doc.instancesOf(id).length === 0)
        .sort(byId);
      if (unused.length === 0) return removed;
      for (const id of unused) {
        clearDefinition(doc, id);
        removeDefinition(doc, id);
        removed.push(id);
      }
    }
  });
}

/** Removes everything inside a definition; nested groups that end up unused are deleted as well. */
function clearDefinition(doc: ModelDocument, definitionId: DefinitionId): void {
  const store = doc.store(definitionId);
  deleteInstances(
    doc,
    definitionId,
    [...store.instances()].map((instance) => instance.id),
  );
  for (const annotation of [...store.annotations()]) removeAnnotation(doc, definitionId, annotation.id);
  for (const plane of [...store.sectionPlanes()]) removeSectionPlane(doc, definitionId, plane.id);
  for (const guide of [...store.guides()]) removeGuide(doc, definitionId, guide.id);
  for (const face of [...store.faces()]) removeFace(doc, definitionId, face.id);
  for (const curve of [...store.curves()]) removeCurve(doc, definitionId, curve.id);
  for (const edge of [...store.edges()]) removeEdge(doc, definitionId, edge.id);
  for (const vertex of [...store.vertices()]) removeVertex(doc, definitionId, vertex.id);
}
