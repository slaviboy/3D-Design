import { KernelError } from '../errors';
import type { DefinitionId, EdgeId, FaceId, InstanceId, VertexId } from '../ids';
import { classifyPointInPolygon } from '../math/geom2d';
import {
  IDENTITY,
  linearDeterminant,
  multiply,
  transformNormal,
  transformPoint,
  type Mat4,
} from '../math/mat4';
import { canonicalPlane, planeBasis, planeFromPolygon, projectTo2D } from '../math/plane';
import { normalize } from '../math/vec3';
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
} from '../model/mutations';
import type { DefinitionAttributes, Loop } from '../model/types';
import { splitCurveChains, transformCurveParams } from './curves';
import { removeEdgeAndOrphans } from './erase';
import { insertSegments } from './insertSegments';
import { resolvePlane } from './planar/resolvePlane';

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
    const transform = instance.transform;
    removeInstance(doc, context, instanceId);

    const sourceEdges = [...source.edges()].sort((a, b) => a.id - b.id);
    const inserted = insertSegments(
      doc,
      context,
      sourceEdges.map((edge) => ({
        a: transformPoint(transform, source.position(edge.v0)),
        b: transformPoint(transform, source.position(edge.v1)),
        attributes: edge.attributes,
      })),
      { autoFace: false },
    );
    const chainByEdge = new Map<EdgeId, readonly EdgeId[]>();
    sourceEdges.forEach((edge, index) => chainByEdge.set(edge.id, inserted.segmentEdges[index] ?? []));

    for (const face of [...source.faces()].sort((a, b) => a.id - b.id)) {
      if (!face.plane) continue;
      const outerPoints = source.loopPoints(face.outer).map((p) => transformPoint(transform, p));
      const plane = planeFromPolygon(outerPoints);
      const transformedNormal = transformNormal(transform, face.plane.normal);
      const desiredNormal = transformedNormal ? normalize(transformedNormal) : null;
      if (!plane || !desiredNormal) continue;
      const basis = planeBasis(plane.normal);
      const outer2D = outerPoints.map((p) => projectTo2D(basis, p));
      const inners2D = face.inners.map((loop) =>
        source.loopPoints(loop).map((p) => projectTo2D(basis, transformPoint(transform, p))),
      );
      const seeds = source.faceEdges(face.id).flatMap((edgeId) => chainByEdge.get(edgeId) ?? []);
      resolvePlane(doc, context, canonicalPlane(plane), seeds, {
        policy: {
          decide: (_region, sample) =>
            classifyPointInPolygon(projectTo2D(basis, sample), outer2D, inners2D) === 'inside'
              ? { attributes: face.attributes, normal: desiredNormal }
              : null,
        },
      });
    }

    for (const curve of [...source.curves()].sort((a, b) => a.id - b.id)) {
      const edges = curve.edges.flatMap((edgeId) => chainByEdge.get(edgeId) ?? []);
      const unique = new Set(edges).size === edges.length;
      const free = edges.every((edgeId) => store.edge(edgeId)?.curve === null);
      if (edges.length === 0 || !unique || !free) continue;
      const chains = splitCurveChains(store, edges);
      const params =
        chains.length === 1 ? transformCurveParams(curve.params, transform) : { kind: 'polyline' as const };
      for (const chain of chains) addCurve(doc, context, params, chain);
    }

    for (const child of [...source.instances()].sort((a, b) => a.id - b.id)) {
      addInstance(doc, context, child.definitionId, multiply(transform, child.transform), child.attributes);
    }

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

/** Removes everything inside a definition; nested groups that end up unused are deleted as well. */
function clearDefinition(doc: ModelDocument, definitionId: DefinitionId): void {
  const store = doc.store(definitionId);
  deleteInstances(
    doc,
    definitionId,
    [...store.instances()].map((instance) => instance.id),
  );
  for (const face of [...store.faces()]) removeFace(doc, definitionId, face.id);
  for (const curve of [...store.curves()]) removeCurve(doc, definitionId, curve.id);
  for (const edge of [...store.edges()]) removeEdge(doc, definitionId, edge.id);
  for (const vertex of [...store.vertices()]) removeVertex(doc, definitionId, vertex.id);
}
