import { KernelError } from '../errors';
import type { AnnotationId, SceneId, SectionPlaneId } from '../ids';
import { formatLocalDateTime, parseLocalDateTime } from '../sun/solar';
import type { SceneState, SectionPlaneState, ShadowSettings } from './types';
import {
  DEFAULT_ANNOTATION_ATTRIBUTES,
  type AnnotationAttributes,
  type AnnotationGeometry,
  type AnnotationState,
} from './types';
import type {
  CurveId,
  DefinitionId,
  EdgeId,
  FaceId,
  GuideId,
  InstanceId,
  MaterialId,
  TagId,
  VertexId,
} from '../ids';
import { IDENTITY, invertAffine, isMat4, type Mat4 } from '../math/mat4';
import { planeFromPolygon } from '../math/plane';
import { distance, dot, isFiniteVec3, normalize, scale, sub, type Vec3 } from '../math/vec3';
import { EPS_LEN, EPS_PARALLEL } from '../tolerance';
import type { EntityStore } from './EntityStore';
import type { ModelDocument } from './ModelDocument';
import {
  DEFAULT_EDGE_ATTRIBUTES,
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_GUIDE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type CurveParams,
  type DefinitionAttributes,
  type EdgeAttributes,
  type FaceAttributes,
  type FaceLoops,
  type GuideAttributes,
  type InstanceAttributes,
  type Loop,
  type LoopUse,
  type MaterialAttributes,
  type ModelAxes,
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

// -------------------------------------------------------------------------------------------------- guides

function assertFiniteGuidePoint(point: Vec3): void {
  if (!isFiniteVec3(point)) throw new KernelError('invalid-geometry', 'Guide coordinates must be finite');
}

/** Adds an infinite guide line through `point`. `direction` may have any non-zero length; it is stored normalized. */
export function addGuideLine(
  doc: ModelDocument,
  context: DefinitionId,
  point: Vec3,
  direction: Vec3,
  attributes: GuideAttributes = DEFAULT_GUIDE_ATTRIBUTES,
): GuideId {
  assertFiniteGuidePoint(point);
  const unit = normalize(direction);
  if (!unit) throw new KernelError('invalid-geometry', 'A guide line needs a finite, non-zero direction');
  const id = doc.ids.allocate() as GuideId;
  doc.apply({
    kind: 'guide.add',
    context,
    data: { id, geometry: { kind: 'line', point, direction: unit }, attributes },
  });
  return id;
}

export function addGuidePoint(
  doc: ModelDocument,
  context: DefinitionId,
  point: Vec3,
  attributes: GuideAttributes = DEFAULT_GUIDE_ATTRIBUTES,
): GuideId {
  assertFiniteGuidePoint(point);
  const id = doc.ids.allocate() as GuideId;
  doc.apply({ kind: 'guide.add', context, data: { id, geometry: { kind: 'point', point }, attributes } });
  return id;
}

export function removeGuide(doc: ModelDocument, context: DefinitionId, id: GuideId): void {
  const guide = doc.store(context).getGuide(id);
  doc.apply({
    kind: 'guide.remove',
    context,
    data: { id, geometry: guide.geometry, attributes: guide.attributes },
  });
}

export function setGuideAttributes(
  doc: ModelDocument,
  context: DefinitionId,
  id: GuideId,
  patch: Partial<GuideAttributes>,
): void {
  const from = doc.store(context).getGuide(id).attributes;
  const to: GuideAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'guide.attributes', context, id, from, to });
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

/**
 * Moves the drawing axes. The green direction is made exactly perpendicular to the red one; directions that are
 * zero, non-finite or parallel are refused.
 */
export function setModelAxes(doc: ModelDocument, axes: ModelAxes): void {
  const xAxis = normalize(axes.xAxis);
  const alongX = xAxis ? sub(axes.yAxis, scale(xAxis, dot(axes.yAxis, xAxis))) : null;
  const yAxis = alongX ? normalize(alongX) : null;
  const inputY = normalize(axes.yAxis);
  if (
    !isFiniteVec3(axes.origin) ||
    !xAxis ||
    !yAxis ||
    !inputY ||
    Math.abs(dot(xAxis, inputY)) > 1 - EPS_PARALLEL
  ) {
    throw new KernelError(
      'invalid-geometry',
      'The axes need a finite origin and two non-parallel directions',
    );
  }
  const from = doc.axes;
  const to: ModelAxes = {
    origin: { x: axes.origin.x, y: axes.origin.y, z: axes.origin.z },
    xAxis,
    yAxis,
  };
  const same = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  if (same(from.origin, to.origin) && same(from.xAxis, to.xAxis) && same(from.yAxis, to.yAxis)) return;
  doc.apply({ kind: 'document.axes', from, to });
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
  const from: TagAttributes = { name: tag.name, visible: tag.visible, color: tag.color };
  const to: TagAttributes = { ...from, ...patch };
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'tag.attributes', id, from, to });
}

// -------------------------------------------------------------------------------------------------- annotations

function assertValidAnnotation(geometry: AnnotationGeometry): void {
  const finite = (...values: Vec3[]): boolean => values.every(isFiniteVec3);
  const valid =
    geometry.kind === 'linear-dimension'
      ? finite(geometry.start.point, geometry.end.point, geometry.offset)
      : geometry.kind === 'radial-dimension'
        ? finite(geometry.labelPoint)
        : geometry.kind === 'leader-text'
          ? finite(geometry.target.point, geometry.offset)
          : [geometry.x, geometry.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!valid)
    throw new KernelError('invalid-geometry', 'Annotation coordinates must be finite and on screen');
}

export function addAnnotation(
  doc: ModelDocument,
  context: DefinitionId,
  geometry: AnnotationGeometry,
  attributes: AnnotationAttributes = DEFAULT_ANNOTATION_ATTRIBUTES,
): AnnotationId {
  assertValidAnnotation(geometry);
  const id = doc.ids.allocate() as AnnotationId;
  doc.apply({ kind: 'annotation.add', context, data: { id, geometry, attributes } });
  return id;
}

export function removeAnnotation(doc: ModelDocument, context: DefinitionId, id: AnnotationId): void {
  const annotation = doc.store(context).getAnnotation(id);
  doc.apply({
    kind: 'annotation.remove',
    context,
    data: { id, geometry: annotation.geometry, attributes: annotation.attributes },
  });
}

/** Moves an annotation or changes its text, visibility or tag. */
export function updateAnnotation(
  doc: ModelDocument,
  context: DefinitionId,
  id: AnnotationId,
  patch: { readonly geometry?: AnnotationGeometry; readonly attributes?: Partial<AnnotationAttributes> },
): void {
  const annotation = doc.store(context).getAnnotation(id);
  const from: AnnotationState = { geometry: annotation.geometry, attributes: annotation.attributes };
  const to: AnnotationState = {
    geometry: patch.geometry ?? annotation.geometry,
    attributes: { ...annotation.attributes, ...patch.attributes },
  };
  if (patch.geometry) assertValidAnnotation(patch.geometry);
  if (to.geometry === from.geometry && shallowEqual(from.attributes, to.attributes)) return;
  doc.apply({ kind: 'annotation.update', context, id, from, to });
}

// -------------------------------------------------------------------------------------------------- section planes

const sameVec = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

function assertValidSectionPlane(point: Vec3, normal: Vec3): Vec3 {
  const unit = isFiniteVec3(point) ? normalize(normal) : null;
  if (!unit)
    throw new KernelError('invalid-geometry', 'A section plane needs a finite point and a non-zero normal');
  return unit;
}

/** Deactivates every other active plane in the context, so at most one stays active. */
function deactivateOthers(doc: ModelDocument, context: DefinitionId, keep: SectionPlaneId | null): void {
  for (const plane of [...doc.store(context).sectionPlanes()]) {
    if (plane.active && plane.id !== keep) updateSectionPlane(doc, context, plane.id, { active: false });
  }
}

/** Adds a section plane. `normal` may have any non-zero length; it is stored normalized. */
export function addSectionPlane(
  doc: ModelDocument,
  context: DefinitionId,
  state: Omit<SectionPlaneState, 'active'> & { readonly active?: boolean },
): SectionPlaneId {
  const normal = assertValidSectionPlane(state.point, state.normal);
  const active = state.active ?? false;
  if (active) deactivateOthers(doc, context, null);
  const id = doc.ids.allocate() as SectionPlaneId;
  doc.apply({
    kind: 'section.add',
    context,
    data: {
      id,
      name: state.name,
      point: { x: state.point.x, y: state.point.y, z: state.point.z },
      normal,
      active,
    },
  });
  return id;
}

export function removeSectionPlane(doc: ModelDocument, context: DefinitionId, id: SectionPlaneId): void {
  const plane = doc.store(context).getSectionPlane(id);
  doc.apply({ kind: 'section.remove', context, data: plane });
}

/** Renames, moves, flips or (de)activates a section plane. Activating one deactivates the others in its context. */
export function updateSectionPlane(
  doc: ModelDocument,
  context: DefinitionId,
  id: SectionPlaneId,
  patch: Partial<SectionPlaneState>,
): void {
  const plane = doc.store(context).getSectionPlane(id);
  const from: SectionPlaneState = {
    name: plane.name,
    point: plane.point,
    normal: plane.normal,
    active: plane.active,
  };
  const point = patch.point ?? from.point;
  const normal = patch.normal ? assertValidSectionPlane(point, patch.normal) : from.normal;
  if (patch.point) assertValidSectionPlane(point, normal);
  const to: SectionPlaneState = {
    name: patch.name ?? from.name,
    point,
    normal,
    active: patch.active ?? from.active,
  };
  if (
    to.name === from.name &&
    to.active === from.active &&
    sameVec(to.point, from.point) &&
    sameVec(to.normal, from.normal)
  ) {
    return;
  }
  if (to.active && !from.active) deactivateOthers(doc, context, id);
  doc.apply({ kind: 'section.update', context, id, from, to });
}

/** Makes `id` the active section plane of the context, or deactivates all of them when `id` is null. */
export function setActiveSectionPlane(
  doc: ModelDocument,
  context: DefinitionId,
  id: SectionPlaneId | null,
): void {
  if (id === null) deactivateOthers(doc, context, null);
  else updateSectionPlane(doc, context, id, { active: true });
}

// -------------------------------------------------------------------------------------------------- shadows

const UNIT_RANGE_KEYS = ['light', 'dark'] as const;

/** Checks and normalizes shadow settings; throws a KernelError for values out of range. */
export function normalizeShadowSettings(settings: ShadowSettings): ShadowSettings {
  const dateTime = parseLocalDateTime(settings.dateTime);
  const finite = [
    settings.latitude,
    settings.longitude,
    settings.northAngle,
    settings.light,
    settings.dark,
  ].every(Number.isFinite);
  if (
    !dateTime ||
    !finite ||
    Math.abs(settings.latitude) > 90 ||
    Math.abs(settings.longitude) > 180 ||
    UNIT_RANGE_KEYS.some((key) => settings[key] < 0 || settings[key] > 1)
  ) {
    throw new KernelError(
      'invalid-operation',
      'Shadow settings need a valid date and time, latitude −90…90, longitude −180…180, and light and dark 0…1',
    );
  }
  return {
    enabled: settings.enabled,
    dateTime: formatLocalDateTime(dateTime),
    latitude: settings.latitude,
    longitude: settings.longitude,
    northAngle: ((settings.northAngle % 360) + 360) % 360,
    light: settings.light,
    dark: settings.dark,
    useSunForShading: settings.useSunForShading,
    onFaces: settings.onFaces,
    onGround: settings.onGround,
  };
}

export function setShadowSettings(doc: ModelDocument, patch: Partial<ShadowSettings>): void {
  const from = doc.shadows;
  const to = normalizeShadowSettings({ ...from, ...patch });
  if (shallowEqual(from, to)) return;
  doc.apply({ kind: 'document.shadows', from, to });
}

// -------------------------------------------------------------------------------------------------- scenes

function assertValidSceneState(state: SceneState): void {
  if (state.name.trim() === '') throw new KernelError('invalid-operation', 'A scene needs a name');
  const camera = state.camera;
  if (
    camera &&
    (![camera.eye, camera.target, camera.up].every(isFiniteVec3) ||
      !Number.isFinite(camera.fovDegrees) ||
      !Number.isFinite(camera.orthoHalfHeight))
  ) {
    throw new KernelError('invalid-geometry', 'A scene camera must be finite');
  }
  if (state.shadows) normalizeShadowSettings(state.shadows);
}

export function addScene(doc: ModelDocument, state: SceneState, index = doc.scenes.length): SceneId {
  assertValidSceneState(state);
  const id = doc.ids.allocate() as SceneId;
  doc.apply({ kind: 'scene.add', data: { ...state, id }, index });
  return id;
}

export function removeScene(doc: ModelDocument, id: SceneId): void {
  const index = doc.scenes.findIndex((scene) => scene.id === id);
  const scene = doc.scenes[index];
  if (!scene) throw new KernelError('missing-entity', `Scene ${String(id)} does not exist`);
  doc.apply({ kind: 'scene.remove', data: scene, index });
}

export function updateScene(doc: ModelDocument, id: SceneId, patch: Partial<SceneState>): void {
  const scene = doc.scene(id);
  if (!scene) throw new KernelError('missing-entity', `Scene ${String(id)} does not exist`);
  const from: SceneState = {
    name: scene.name,
    description: scene.description,
    includeInAnimation: scene.includeInAnimation,
    saves: scene.saves,
    camera: scene.camera,
    hiddenTags: scene.hiddenTags,
    sections: scene.sections,
    shadows: scene.shadows,
    axes: scene.axes,
  };
  const to: SceneState = { ...from, ...patch };
  assertValidSceneState(to);
  if (shallowEqual<SceneState>(from, to)) return;
  doc.apply({ kind: 'scene.update', id, from, to });
}

/** Puts the scenes in the given order, which must list every scene exactly once. */
export function reorderScenes(doc: ModelDocument, order: readonly SceneId[]): void {
  const from = doc.scenes.map((scene) => scene.id);
  if (
    order.length !== from.length ||
    new Set(order).size !== order.length ||
    !order.every((id) => doc.scene(id))
  ) {
    throw new KernelError('invalid-operation', 'A scene order must list every scene exactly once');
  }
  if (order.every((id, index) => id === from[index])) return;
  doc.apply({ kind: 'scene.reorder', from, to: [...order] });
}
