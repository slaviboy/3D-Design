import { KernelError } from '../errors';
import type { CurveId, DefinitionId, EdgeId, FaceId, InstanceId, VertexId } from '../ids';
import { aabbFromPoints, type Aabb } from '../math/aabb';
import type { Mat4 } from '../math/mat4';
import { planeFromPolygon, type Plane } from '../math/plane';
import type { Vec3 } from '../math/vec3';
import { AabbTree } from '../spatial/AabbTree';
import { VertexHashGrid } from '../spatial/VertexHashGrid';
import type {
  CurveData,
  CurveParams,
  EdgeAttributes,
  EdgeData,
  FaceAttributes,
  FaceData,
  FaceLoops,
  InstanceAttributes,
  InstanceData,
  Loop,
  LoopUse,
  VertexData,
} from './types';

export interface VertexView {
  readonly id: VertexId;
  readonly position: Vec3;
  /** Edges that use this vertex. Maintained by the store. */
  readonly edges: readonly EdgeId[];
}

export interface EdgeView {
  readonly id: EdgeId;
  readonly v0: VertexId;
  readonly v1: VertexId;
  readonly attributes: EdgeAttributes;
  /** Faces whose loops use this edge. Maintained by the store. */
  readonly faces: readonly FaceId[];
  /** The curve this edge belongs to. Maintained by the store. */
  readonly curve: CurveId | null;
}

export interface FaceView {
  readonly id: FaceId;
  readonly outer: Loop;
  readonly inners: readonly Loop[];
  readonly attributes: FaceAttributes;
  /** Plane of the outer loop; `null` while the outer loop is degenerate. */
  readonly plane: Plane | null;
}

export interface CurveView {
  readonly id: CurveId;
  readonly params: CurveParams;
  readonly edges: readonly EdgeId[];
}

export interface InstanceView {
  readonly id: InstanceId;
  readonly definitionId: DefinitionId;
  readonly transform: Mat4;
  readonly attributes: InstanceAttributes;
}

interface VertexRecord extends VertexView {
  position: Vec3;
  readonly edges: EdgeId[];
}

interface EdgeRecord extends EdgeView {
  attributes: EdgeAttributes;
  readonly faces: FaceId[];
  curve: CurveId | null;
}

interface FaceRecord extends FaceView {
  outer: Loop;
  inners: readonly Loop[];
  attributes: FaceAttributes;
  plane: Plane | null;
}

interface CurveRecord extends CurveView {
  params: CurveParams;
  edges: readonly EdgeId[];
}

interface InstanceRecord extends InstanceView {
  transform: Mat4;
  attributes: InstanceAttributes;
}

function removeValue<T>(list: T[], value: T): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === value) list.splice(i, 1);
  }
}

/**
 * The entities of one component definition (a "context"): vertices, edges, faces, curves and child instances.
 *
 * Reading is public. Mutation happens only through the `apply*` methods, which only {@link ModelDocument}
 * calls while applying a {@link Change}, so every modification is recorded for undo. The store keeps its
 * derived state (adjacency lists, face planes, spatial indexes) up to date as changes are applied.
 */
export class EntityStore {
  readonly definitionId: DefinitionId;

  readonly #vertices = new Map<VertexId, VertexRecord>();
  readonly #edges = new Map<EdgeId, EdgeRecord>();
  readonly #faces = new Map<FaceId, FaceRecord>();
  readonly #curves = new Map<CurveId, CurveRecord>();
  readonly #instances = new Map<InstanceId, InstanceRecord>();

  readonly #vertexGrid = new VertexHashGrid();
  readonly #edgeTree = new AabbTree();
  readonly #faceTree = new AabbTree();

  constructor(definitionId: DefinitionId) {
    this.definitionId = definitionId;
  }

  // ---------------------------------------------------------------------------------------------- reading

  get vertexCount(): number {
    return this.#vertices.size;
  }

  get edgeCount(): number {
    return this.#edges.size;
  }

  get faceCount(): number {
    return this.#faces.size;
  }

  get curveCount(): number {
    return this.#curves.size;
  }

  get instanceCount(): number {
    return this.#instances.size;
  }

  get isEmpty(): boolean {
    return (
      this.#vertices.size === 0 &&
      this.#edges.size === 0 &&
      this.#faces.size === 0 &&
      this.#curves.size === 0 &&
      this.#instances.size === 0
    );
  }

  vertex(id: VertexId): VertexView | undefined {
    return this.#vertices.get(id);
  }

  edge(id: EdgeId): EdgeView | undefined {
    return this.#edges.get(id);
  }

  face(id: FaceId): FaceView | undefined {
    return this.#faces.get(id);
  }

  curve(id: CurveId): CurveView | undefined {
    return this.#curves.get(id);
  }

  instance(id: InstanceId): InstanceView | undefined {
    return this.#instances.get(id);
  }

  getVertex(id: VertexId): VertexView {
    return this.#getVertexRecord(id);
  }

  getEdge(id: EdgeId): EdgeView {
    return this.#getEdgeRecord(id);
  }

  getFace(id: FaceId): FaceView {
    return this.#getFaceRecord(id);
  }

  getCurve(id: CurveId): CurveView {
    const record = this.#curves.get(id);
    if (!record) throw this.#missing('Curve', id);
    return record;
  }

  getInstance(id: InstanceId): InstanceView {
    const record = this.#instances.get(id);
    if (!record) throw this.#missing('Instance', id);
    return record;
  }

  vertices(): IterableIterator<VertexView> {
    return this.#vertices.values();
  }

  edges(): IterableIterator<EdgeView> {
    return this.#edges.values();
  }

  faces(): IterableIterator<FaceView> {
    return this.#faces.values();
  }

  curves(): IterableIterator<CurveView> {
    return this.#curves.values();
  }

  instances(): IterableIterator<InstanceView> {
    return this.#instances.values();
  }

  position(id: VertexId): Vec3 {
    return this.#getVertexRecord(id).position;
  }

  /** The face's plane. Throws when the face is degenerate. */
  getFacePlane(id: FaceId): Plane {
    const plane = this.#getFaceRecord(id).plane;
    if (!plane)
      throw new KernelError('invalid-geometry', `Face ${String(id)} is degenerate and has no plane`);
    return plane;
  }

  /** The edge joining `a` and `b`, in either direction. */
  edgeBetween(a: VertexId, b: VertexId): EdgeView | undefined {
    const vertex = this.#vertices.get(a);
    if (!vertex) return undefined;
    for (const edgeId of vertex.edges) {
      const edge = this.#edges.get(edgeId);
      if (edge && ((edge.v0 === a && edge.v1 === b) || (edge.v0 === b && edge.v1 === a))) return edge;
    }
    return undefined;
  }

  otherVertex(edgeId: EdgeId, vertex: VertexId): VertexId {
    const edge = this.#getEdgeRecord(edgeId);
    if (edge.v0 === vertex) return edge.v1;
    if (edge.v1 === vertex) return edge.v0;
    throw new KernelError('invalid-operation', `Vertex ${String(vertex)} is not on edge ${String(edgeId)}`);
  }

  /** The vertex where a loop use starts. */
  useStart(use: LoopUse): VertexId {
    const edge = this.#getEdgeRecord(use.edge);
    return use.reversed ? edge.v1 : edge.v0;
  }

  /** The vertex where a loop use ends. */
  useEnd(use: LoopUse): VertexId {
    const edge = this.#getEdgeRecord(use.edge);
    return use.reversed ? edge.v0 : edge.v1;
  }

  loopVertices(loop: Loop): VertexId[] {
    return loop.map((use) => this.useStart(use));
  }

  loopPoints(loop: Loop): Vec3[] {
    return loop.map((use) => this.position(this.useStart(use)));
  }

  /** All loops of a face, outer loop first. */
  faceLoops(id: FaceId): Loop[] {
    const face = this.#getFaceRecord(id);
    return [face.outer, ...face.inners];
  }

  faceEdges(id: FaceId): EdgeId[] {
    return this.faceLoops(id).flatMap((loop) => loop.map((use) => use.edge));
  }

  edgeBounds(id: EdgeId): Aabb {
    const edge = this.#getEdgeRecord(id);
    return aabbFromPoints([this.position(edge.v0), this.position(edge.v1)]);
  }

  faceBounds(id: FaceId): Aabb {
    return aabbFromPoints(this.loopPoints(this.#getFaceRecord(id).outer));
  }

  /** The vertex nearest to `point` within `radius` (at most a few welding-grid cells). */
  findNearestVertex(point: Vec3, radius: number): VertexId | undefined {
    const id = this.#vertexGrid.findNearest(point, radius);
    return id === undefined ? undefined : (id as VertexId);
  }

  /** All vertices within `radius` of `point` (at most a few welding-grid cells). */
  verticesWithin(point: Vec3, radius: number): VertexId[] {
    const ids: VertexId[] = [];
    this.#vertexGrid.forEachWithin(point, radius, (id) => ids.push(id as VertexId));
    return ids;
  }

  /** Edges whose bounding boxes intersect `box`. */
  queryEdges(box: Aabb): EdgeId[] {
    return this.#edgeTree.queryItems(box) as EdgeId[];
  }

  /** Faces whose bounding boxes intersect `box`. */
  queryFaces(box: Aabb): FaceId[] {
    return this.#faceTree.queryItems(box) as FaceId[];
  }

  // ------------------------------------------------------------------------- raw mutation (ModelDocument only)

  applyAddVertex(data: VertexData): void {
    if (this.#vertices.has(data.id)) throw this.#duplicate('Vertex', data.id);
    this.#vertices.set(data.id, { id: data.id, position: data.position, edges: [] });
    this.#vertexGrid.insert(data.id, data.position);
  }

  applyRemoveVertex(id: VertexId): void {
    const vertex = this.#getVertexRecord(id);
    if (vertex.edges.length > 0) {
      throw new KernelError('invalid-operation', `Vertex ${String(id)} is still used by edges`);
    }
    this.#vertices.delete(id);
    this.#vertexGrid.remove(id);
  }

  applyMoveVertex(id: VertexId, to: Vec3): void {
    const vertex = this.#getVertexRecord(id);
    vertex.position = to;
    this.#vertexGrid.move(id, to);
    const touchedFaces = new Set<FaceId>();
    for (const edgeId of vertex.edges) {
      this.#edgeTree.update(edgeId, this.edgeBounds(edgeId));
      for (const faceId of this.#getEdgeRecord(edgeId).faces) touchedFaces.add(faceId);
    }
    for (const faceId of touchedFaces) this.#refreshFaceGeometry(this.#getFaceRecord(faceId));
  }

  applyAddEdge(data: EdgeData): void {
    if (this.#edges.has(data.id)) throw this.#duplicate('Edge', data.id);
    const v0 = this.#getVertexRecord(data.v0);
    const v1 = this.#getVertexRecord(data.v1);
    this.#edges.set(data.id, {
      id: data.id,
      v0: data.v0,
      v1: data.v1,
      attributes: data.attributes,
      faces: [],
      curve: null,
    });
    v0.edges.push(data.id);
    if (v1 !== v0) v1.edges.push(data.id);
    this.#edgeTree.insert(data.id, this.edgeBounds(data.id));
  }

  applyRemoveEdge(id: EdgeId): void {
    const edge = this.#getEdgeRecord(id);
    if (edge.faces.length > 0) {
      throw new KernelError('invalid-operation', `Edge ${String(id)} still bounds faces`);
    }
    if (edge.curve !== null) {
      throw new KernelError('invalid-operation', `Edge ${String(id)} still belongs to a curve`);
    }
    removeValue(this.#getVertexRecord(edge.v0).edges, id);
    removeValue(this.#getVertexRecord(edge.v1).edges, id);
    this.#edges.delete(id);
    this.#edgeTree.remove(id);
  }

  applySetEdgeAttributes(id: EdgeId, attributes: EdgeAttributes): void {
    this.#getEdgeRecord(id).attributes = attributes;
  }

  applyAddFace(data: FaceData): void {
    if (this.#faces.has(data.id)) throw this.#duplicate('Face', data.id);
    this.#assertLoopEdgesExist(data);
    const record: FaceRecord = {
      id: data.id,
      outer: data.outer,
      inners: data.inners,
      attributes: data.attributes,
      plane: null,
    };
    this.#faces.set(data.id, record);
    this.#linkFaceEdges(record);
    record.plane = planeFromPolygon(this.loopPoints(record.outer));
    this.#faceTree.insert(data.id, this.faceBounds(data.id));
  }

  applyRemoveFace(id: FaceId): void {
    const face = this.#getFaceRecord(id);
    this.#unlinkFaceEdges(face);
    this.#faces.delete(id);
    this.#faceTree.remove(id);
  }

  applySetFaceLoops(id: FaceId, loops: FaceLoops): void {
    const face = this.#getFaceRecord(id);
    this.#assertLoopEdgesExist(loops);
    this.#unlinkFaceEdges(face);
    face.outer = loops.outer;
    face.inners = loops.inners;
    this.#linkFaceEdges(face);
    this.#refreshFaceGeometry(face);
  }

  applySetFaceAttributes(id: FaceId, attributes: FaceAttributes): void {
    this.#getFaceRecord(id).attributes = attributes;
  }

  applyAddCurve(data: CurveData): void {
    if (this.#curves.has(data.id)) throw this.#duplicate('Curve', data.id);
    this.#curves.set(data.id, { id: data.id, params: data.params, edges: [] });
    this.applySetCurveEdges(data.id, data.edges);
  }

  applyRemoveCurve(id: CurveId): void {
    this.applySetCurveEdges(id, []);
    this.#curves.delete(id);
  }

  applySetCurveParams(id: CurveId, params: CurveParams): void {
    const curve = this.#curves.get(id);
    if (!curve) throw this.#missing('Curve', id);
    curve.params = params;
  }

  applySetCurveEdges(id: CurveId, edges: readonly EdgeId[]): void {
    const curve = this.#curves.get(id);
    if (!curve) throw this.#missing('Curve', id);
    for (const edgeId of edges) {
      const edge = this.#getEdgeRecord(edgeId);
      if (edge.curve !== null && edge.curve !== id) {
        throw new KernelError(
          'invalid-operation',
          `Edge ${String(edgeId)} already belongs to curve ${String(edge.curve)}`,
        );
      }
    }
    for (const edgeId of curve.edges) {
      const edge = this.#edges.get(edgeId);
      if (edge?.curve === id) edge.curve = null;
    }
    curve.edges = edges;
    for (const edgeId of edges) this.#getEdgeRecord(edgeId).curve = id;
  }

  applyAddInstance(data: InstanceData): void {
    if (this.#instances.has(data.id)) throw this.#duplicate('Instance', data.id);
    this.#instances.set(data.id, { ...data });
  }

  applyRemoveInstance(id: InstanceId): void {
    if (!this.#instances.delete(id)) throw this.#missing('Instance', id);
  }

  applySetInstanceTransform(id: InstanceId, transform: Mat4): void {
    const record = this.#instances.get(id);
    if (!record) throw this.#missing('Instance', id);
    record.transform = transform;
  }

  applySetInstanceAttributes(id: InstanceId, attributes: InstanceAttributes): void {
    const record = this.#instances.get(id);
    if (!record) throw this.#missing('Instance', id);
    record.attributes = attributes;
  }

  // ---------------------------------------------------------------------------------------------- internals

  #getVertexRecord(id: VertexId): VertexRecord {
    const record = this.#vertices.get(id);
    if (!record) throw this.#missing('Vertex', id);
    return record;
  }

  #getEdgeRecord(id: EdgeId): EdgeRecord {
    const record = this.#edges.get(id);
    if (!record) throw this.#missing('Edge', id);
    return record;
  }

  #getFaceRecord(id: FaceId): FaceRecord {
    const record = this.#faces.get(id);
    if (!record) throw this.#missing('Face', id);
    return record;
  }

  #assertLoopEdgesExist(loops: FaceLoops): void {
    for (const loop of [loops.outer, ...loops.inners]) {
      for (const use of loop) this.#getEdgeRecord(use.edge);
    }
  }

  #linkFaceEdges(face: FaceRecord): void {
    for (const loop of [face.outer, ...face.inners]) {
      for (const use of loop) {
        const edge = this.#getEdgeRecord(use.edge);
        if (!edge.faces.includes(face.id)) edge.faces.push(face.id);
      }
    }
  }

  #unlinkFaceEdges(face: FaceRecord): void {
    for (const loop of [face.outer, ...face.inners]) {
      for (const use of loop) {
        const edge = this.#edges.get(use.edge);
        if (edge) removeValue(edge.faces, face.id);
      }
    }
  }

  #refreshFaceGeometry(face: FaceRecord): void {
    face.plane = planeFromPolygon(this.loopPoints(face.outer));
    this.#faceTree.update(face.id, this.faceBounds(face.id));
  }

  #missing(kind: string, id: number): KernelError {
    return new KernelError(
      'missing-entity',
      `${kind} ${String(id)} does not exist in definition ${String(this.definitionId)}`,
    );
  }

  #duplicate(kind: string, id: number): KernelError {
    return new KernelError(
      'duplicate-entity',
      `${kind} ${String(id)} already exists in definition ${String(this.definitionId)}`,
    );
  }
}
