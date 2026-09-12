import * as THREE from 'three';
import type { DefinitionId, EdgeId, FaceId, InstanceId } from '../kernel/ids';
import { changeContext } from '../kernel/model/changes';
import type { EntityStore } from '../kernel/model/EntityStore';
import type { ModelDocument } from '../kernel/model/ModelDocument';
import { triangulateFace } from '../kernel/ops/triangulate';
import { SELECTION_FACE_OPACITY, VIEW_COLORS } from './palette';
import type { ViewChange, ViewSource } from './ViewSource';

interface DefinitionGeometry {
  readonly faces: THREE.BufferGeometry;
  readonly edges: THREE.BufferGeometry;
}

/** Writes a face's triangles (positions and flat normals) to the output arrays. Degenerate faces are skipped. */
function appendFaceTriangles(
  store: EntityStore,
  faceId: FaceId,
  positions: number[],
  normals: number[],
): void {
  const face = store.getFace(faceId);
  if (face.attributes.hidden || !face.plane) return;
  const { normal } = face.plane;
  const { vertices, indices } = triangulateFace(store, faceId);
  for (const index of indices) {
    const vertex = vertices[index];
    if (vertex === undefined) continue;
    const p = store.position(vertex);
    positions.push(p.x, p.y, p.z);
    normals.push(normal.x, normal.y, normal.z);
  }
}

function appendEdge(store: EntityStore, edgeId: EdgeId, positions: number[]): void {
  const edge = store.getEdge(edgeId);
  if (edge.attributes.hidden || edge.attributes.soft) return;
  const a = store.position(edge.v0);
  const b = store.position(edge.v1);
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function setPositions(geometry: THREE.BufferGeometry, positions: number[], normals?: number[]): void {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

const BOX_EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Builds and maintains three.js objects for a model. Each definition's geometry is built once and shared by all of
 * its instances. Document changes mark only the touched definitions for rebuilding, and selection is drawn as a
 * separate overlay, so selecting never rebuilds model geometry.
 */
export class ModelRenderer {
  readonly root = new THREE.Group();
  readonly overlay = new THREE.Group();

  readonly #source: ViewSource;
  readonly #frontMaterial = new THREE.MeshLambertMaterial({
    color: VIEW_COLORS.faceFront,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  readonly #backMaterial = new THREE.MeshLambertMaterial({
    color: VIEW_COLORS.faceBack,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  readonly #edgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.edge });
  readonly #selectionFaceMaterial = new THREE.MeshBasicMaterial({
    color: VIEW_COLORS.selection,
    transparent: true,
    opacity: SELECTION_FACE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #selectionEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.selection });

  readonly #geometries = new Map<DefinitionId, DefinitionGeometry>();
  readonly #dirtyDefinitions = new Set<DefinitionId>();
  #structureDirty = true;
  #selectionDirty = true;

  constructor(source: ViewSource) {
    this.#source = source;
    this.root.matrixAutoUpdate = false;
    this.overlay.matrixAutoUpdate = false;
  }

  /** Records what a session change invalidates. Call `update` before rendering. */
  handleChange(change: ViewChange): void {
    if (change.kind === 'document') {
      for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
      this.#geometries.clear();
      this.#structureDirty = true;
      this.#selectionDirty = true;
    } else if (change.kind === 'model' && change.modelEvent) {
      for (const modelChange of change.modelEvent.changes) {
        const context = changeContext(modelChange);
        if (context !== null) this.#dirtyDefinitions.add(context);
        if (modelChange.kind.startsWith('instance.') || modelChange.kind.startsWith('definition.')) {
          this.#structureDirty = true;
        }
      }
      this.#selectionDirty = true;
    } else if (change.kind === 'selection') {
      this.#selectionDirty = true;
    }
  }

  /** Brings the three.js objects up to date. Returns true when anything changed. */
  update(): boolean {
    const doc = this.#source.doc;
    let changed = false;
    for (const definitionId of this.#dirtyDefinitions) {
      const geometry = this.#geometries.get(definitionId);
      if (!geometry) continue;
      if (doc.definition(definitionId)) {
        this.#fillGeometry(doc.store(definitionId), geometry);
      } else {
        this.#disposeGeometry(geometry);
        this.#geometries.delete(definitionId);
        this.#structureDirty = true;
      }
      changed = true;
    }
    this.#dirtyDefinitions.clear();
    if (this.#structureDirty) {
      this.#rebuildTree(doc);
      this.#structureDirty = false;
      this.#selectionDirty = true;
      changed = true;
    }
    if (this.#selectionDirty) {
      this.#rebuildSelectionOverlay(doc);
      this.#selectionDirty = false;
      changed = true;
    }
    return changed;
  }

  /** World-space bounds of the visible model. */
  bounds(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this.root);
  }

  dispose(): void {
    for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
    this.#geometries.clear();
    this.#clearOverlay();
    for (const material of [
      this.#frontMaterial,
      this.#backMaterial,
      this.#edgeMaterial,
      this.#selectionFaceMaterial,
      this.#selectionEdgeMaterial,
    ]) {
      material.dispose();
    }
  }

  #geometryFor(doc: ModelDocument, definitionId: DefinitionId): DefinitionGeometry {
    let geometry = this.#geometries.get(definitionId);
    if (!geometry) {
      geometry = { faces: new THREE.BufferGeometry(), edges: new THREE.BufferGeometry() };
      this.#fillGeometry(doc.store(definitionId), geometry);
      this.#geometries.set(definitionId, geometry);
    }
    return geometry;
  }

  #fillGeometry(store: EntityStore, geometry: DefinitionGeometry): void {
    const facePositions: number[] = [];
    const faceNormals: number[] = [];
    for (const face of store.faces()) appendFaceTriangles(store, face.id, facePositions, faceNormals);
    const edgePositions: number[] = [];
    for (const edge of store.edges()) appendEdge(store, edge.id, edgePositions);
    setPositions(geometry.faces, facePositions, faceNormals);
    setPositions(geometry.edges, edgePositions);
  }

  #disposeGeometry(geometry: DefinitionGeometry): void {
    geometry.faces.dispose();
    geometry.edges.dispose();
  }

  #rebuildTree(doc: ModelDocument): void {
    this.root.clear();
    this.root.add(this.#buildNode(doc, doc.rootDefinitionId, new Set()));
    // Geometry of definitions that are no longer used anywhere is released.
    const used = new Set<DefinitionId>();
    this.root.traverse((object) => {
      const definitionId = (object.userData as { definitionId?: DefinitionId }).definitionId;
      if (definitionId !== undefined) used.add(definitionId);
    });
    for (const [definitionId, geometry] of this.#geometries) {
      if (!used.has(definitionId)) {
        this.#disposeGeometry(geometry);
        this.#geometries.delete(definitionId);
      }
    }
  }

  #buildNode(doc: ModelDocument, definitionId: DefinitionId, ancestors: Set<DefinitionId>): THREE.Group {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.userData = { definitionId };
    if (ancestors.has(definitionId)) return group;
    const geometry = this.#geometryFor(doc, definitionId);
    group.add(
      new THREE.Mesh(geometry.faces, this.#frontMaterial),
      new THREE.Mesh(geometry.faces, this.#backMaterial),
      new THREE.LineSegments(geometry.edges, this.#edgeMaterial),
    );
    const nested = new Set(ancestors).add(definitionId);
    for (const instance of doc.store(definitionId).instances()) {
      if (instance.attributes.hidden) continue;
      const child = this.#buildNode(doc, instance.definitionId, nested);
      child.matrix.fromArray(instance.transform);
      child.matrixWorldNeedsUpdate = true;
      group.add(child);
    }
    return group;
  }

  #clearOverlay(): void {
    this.overlay.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        (object.geometry as THREE.BufferGeometry).dispose();
      }
    });
    this.overlay.clear();
  }

  #rebuildSelectionOverlay(doc: ModelDocument): void {
    this.#clearOverlay();
    const refs = this.#source.selection.refs();
    if (refs.length === 0) return;
    const context = this.#source.activeContext;
    if (!doc.definition(context)) return;
    const store = doc.store(context);
    this.overlay.matrix.fromArray(this.#source.activeContextTransform);
    this.overlay.matrixWorldNeedsUpdate = true;

    const facePositions: number[] = [];
    const faceNormals: number[] = [];
    const edgePositions: number[] = [];
    for (const ref of refs) {
      if (ref.kind === 'face' && store.face(ref.id as FaceId)) {
        appendFaceTriangles(store, ref.id as FaceId, facePositions, faceNormals);
      } else if (ref.kind === 'edge' && store.edge(ref.id as EdgeId)) {
        appendEdge(store, ref.id as EdgeId, edgePositions);
      } else if (ref.kind === 'instance') {
        const instance = store.instance(ref.id as InstanceId);
        if (instance) this.overlay.add(this.#instanceBox(doc, instance.definitionId, instance.transform));
      }
    }
    if (facePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      setPositions(geometry, facePositions, faceNormals);
      this.overlay.add(new THREE.Mesh(geometry, this.#selectionFaceMaterial));
    }
    if (edgePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      setPositions(geometry, edgePositions);
      this.overlay.add(new THREE.LineSegments(geometry, this.#selectionEdgeMaterial));
    }
  }

  /** Box outline around an instance, the selection indicator for groups and components. */
  #instanceBox(
    doc: ModelDocument,
    definitionId: DefinitionId,
    transform: readonly number[],
  ): THREE.LineSegments {
    const node = this.#buildNode(doc, definitionId, new Set());
    node.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const positions: number[] = [];
    if (!box.isEmpty()) {
      for (const [a, b] of BOX_EDGE_CORNERS) {
        const start = corners[a];
        const end = corners[b];
        if (start && end) positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    setPositions(geometry, positions);
    const lines = new THREE.LineSegments(geometry, this.#selectionEdgeMaterial);
    lines.matrixAutoUpdate = false;
    lines.matrix.fromArray(transform);
    return lines;
  }
}
