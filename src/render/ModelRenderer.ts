import * as THREE from 'three';
import type { DefinitionId, EdgeId, FaceId, InstanceId } from '../kernel/ids';
import { changeContext } from '../kernel/model/changes';
import type { EntityStore } from '../kernel/model/EntityStore';
import type { ModelDocument } from '../kernel/model/ModelDocument';
import { triangulateFace } from '../kernel/ops/triangulate';
import {
  FADED_OPACITY,
  GUIDE_LINE_HALF_LENGTH,
  GUIDE_POINT_SIZE,
  HOVER_FACE_OPACITY,
  SELECTION_FACE_OPACITY,
  VIEW_COLORS,
} from './palette';
import type { ViewChange, ViewEntityRef, ViewPreviewLineStyle, ViewSource } from './ViewSource';

interface DefinitionGeometry {
  readonly faces: THREE.BufferGeometry;
  readonly edges: THREE.BufferGeometry;
  readonly guides: THREE.BufferGeometry;
}

interface MaterialSet {
  readonly front: THREE.Material;
  readonly back: THREE.Material;
  readonly edge: THREE.Material;
}

/** Drawn on top of the model, after it. */
const PREVIEW_RENDER_ORDER = 10;

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

function appendEdge(store: EntityStore, edgeId: EdgeId, positions: number[], includeSoft = false): void {
  const edge = store.getEdge(edgeId);
  if (edge.attributes.hidden || (edge.attributes.soft && !includeSoft)) return;
  const a = store.position(edge.v0);
  const b = store.position(edge.v1);
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function appendGuides(store: EntityStore, positions: number[]): void {
  for (const guide of store.guides()) {
    if (guide.attributes.hidden) continue;
    const { point } = guide.geometry;
    if (guide.geometry.kind === 'line') {
      const { direction } = guide.geometry;
      const reach = GUIDE_LINE_HALF_LENGTH;
      positions.push(
        point.x - direction.x * reach,
        point.y - direction.y * reach,
        point.z - direction.z * reach,
        point.x + direction.x * reach,
        point.y + direction.y * reach,
        point.z + direction.z * reach,
      );
    } else {
      const s = GUIDE_POINT_SIZE;
      positions.push(point.x - s, point.y, point.z, point.x + s, point.y, point.z);
      positions.push(point.x, point.y - s, point.z, point.x, point.y + s, point.z);
      positions.push(point.x, point.y, point.z - s, point.x, point.y, point.z + s);
    }
  }
}

function setPositions(geometry: THREE.BufferGeometry, positions: number[], normals?: number[]): void {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function disposeMeshes(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      (object.geometry as THREE.BufferGeometry).dispose();
    }
  });
  group.clear();
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

const PREVIEW_COLORS: Readonly<Record<ViewPreviewLineStyle, number>> = {
  preview: VIEW_COLORS.preview,
  'axis-x': VIEW_COLORS.axisX,
  'axis-y': VIEW_COLORS.axisY,
  'axis-z': VIEW_COLORS.axisZ,
  guide: VIEW_COLORS.guide,
};

/**
 * Builds and maintains three.js objects for a model. Each definition's geometry is built once and shared by all of
 * its instances. Document changes mark only the touched definitions for rebuilding, and selection and tool previews
 * are drawn as separate overlays, so neither rebuilds model geometry.
 */
export class ModelRenderer {
  readonly root = new THREE.Group();
  /** Selection highlights, in the active context's coordinates. */
  readonly overlay = new THREE.Group();
  /** Tool previews: world-space lines plus highlights in the active context. */
  readonly preview = new THREE.Group();

  readonly #source: ViewSource;
  readonly #normal: MaterialSet = {
    front: new THREE.MeshLambertMaterial({
      color: VIEW_COLORS.faceFront,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    back: new THREE.MeshLambertMaterial({
      color: VIEW_COLORS.faceBack,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    edge: new THREE.LineBasicMaterial({ color: VIEW_COLORS.edge }),
  };
  readonly #faded: MaterialSet = {
    front: new THREE.MeshLambertMaterial({
      color: VIEW_COLORS.faceFront,
      side: THREE.FrontSide,
      transparent: true,
      opacity: FADED_OPACITY,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    back: new THREE.MeshLambertMaterial({
      color: VIEW_COLORS.faceBack,
      side: THREE.BackSide,
      transparent: true,
      opacity: FADED_OPACITY,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    edge: new THREE.LineBasicMaterial({ color: VIEW_COLORS.edge, transparent: true, opacity: FADED_OPACITY }),
  };
  readonly #guideMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.guide });
  readonly #selectionFaceMaterial = new THREE.MeshBasicMaterial({
    color: VIEW_COLORS.selection,
    transparent: true,
    opacity: SELECTION_FACE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #selectionEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.selection });
  readonly #hoverFaceMaterial = new THREE.MeshBasicMaterial({
    color: VIEW_COLORS.hover,
    transparent: true,
    opacity: HOVER_FACE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #hoverEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.hover });
  readonly #previewMaterials = new Map<ViewPreviewLineStyle, THREE.LineBasicMaterial>();

  readonly #geometries = new Map<DefinitionId, DefinitionGeometry>();
  readonly #dirtyDefinitions = new Set<DefinitionId>();
  #structureDirty = true;
  #selectionDirty = true;
  #previewDirty = true;

  constructor(source: ViewSource) {
    this.#source = source;
    for (const group of [this.root, this.overlay, this.preview]) group.matrixAutoUpdate = false;
  }

  /** Records what a session change invalidates. Call `update` before rendering. */
  handleChange(change: ViewChange): void {
    if (change.kind === 'document') {
      for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
      this.#geometries.clear();
      this.#structureDirty = true;
      this.#selectionDirty = true;
      this.#previewDirty = true;
    } else if (change.kind === 'model' && change.modelEvent) {
      for (const modelChange of change.modelEvent.changes) {
        const context = changeContext(modelChange);
        if (context !== null) this.#dirtyDefinitions.add(context);
        if (modelChange.kind.startsWith('instance.') || modelChange.kind.startsWith('definition.')) {
          this.#structureDirty = true;
        }
      }
      this.#selectionDirty = true;
      this.#previewDirty = true;
    } else if (change.kind === 'selection') {
      this.#selectionDirty = true;
    } else if (change.kind === 'context') {
      this.#structureDirty = true;
      this.#previewDirty = true;
    } else if (change.kind === 'preview') {
      this.#previewDirty = true;
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
    if (this.#previewDirty) {
      this.#rebuildPreview(doc);
      this.#previewDirty = false;
      changed = true;
    }
    return changed;
  }

  /** World-space bounds of the visible model. Guides are infinite and don't count. */
  bounds(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      if ((object.userData as { excludeFromBounds?: boolean }).excludeFromBounds === true) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
      box.union(part.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld));
    });
    return box;
  }

  dispose(): void {
    for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
    this.#geometries.clear();
    disposeMeshes(this.overlay);
    disposeMeshes(this.preview);
    const materials: THREE.Material[] = [
      this.#normal.front,
      this.#normal.back,
      this.#normal.edge,
      this.#faded.front,
      this.#faded.back,
      this.#faded.edge,
      this.#guideMaterial,
      this.#selectionFaceMaterial,
      this.#selectionEdgeMaterial,
      this.#hoverFaceMaterial,
      this.#hoverEdgeMaterial,
      ...this.#previewMaterials.values(),
    ];
    for (const material of materials) material.dispose();
  }

  #geometryFor(doc: ModelDocument, definitionId: DefinitionId): DefinitionGeometry {
    let geometry = this.#geometries.get(definitionId);
    if (!geometry) {
      geometry = {
        faces: new THREE.BufferGeometry(),
        edges: new THREE.BufferGeometry(),
        guides: new THREE.BufferGeometry(),
      };
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
    const guidePositions: number[] = [];
    appendGuides(store, guidePositions);
    setPositions(geometry.faces, facePositions, faceNormals);
    setPositions(geometry.edges, edgePositions);
    setPositions(geometry.guides, guidePositions);
  }

  #disposeGeometry(geometry: DefinitionGeometry): void {
    geometry.faces.dispose();
    geometry.edges.dispose();
    geometry.guides.dispose();
  }

  #rebuildTree(doc: ModelDocument): void {
    this.root.clear();
    const editPath = this.#validEditPath(doc);
    this.root.add(
      this.#buildNode(doc, doc.rootDefinitionId, new Set(), false, editPath.length > 0 ? 0 : null, editPath),
    );
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

  #validEditPath(doc: ModelDocument): readonly number[] {
    const path: number[] = [];
    let context = doc.rootDefinitionId;
    for (const id of this.#source.editPath) {
      const instance = doc.store(context).instance(id as InstanceId);
      if (!instance) break;
      path.push(id);
      context = instance.definitionId;
    }
    return path;
  }

  /**
   * One definition's geometry and, recursively, its instances. `pathDepth` is non-null for the open groups that
   * contain the active context: their own geometry fades, and of their instances only the next one on the edit path
   * stays unfaded. Everything inside the active context is drawn normally.
   */
  #buildNode(
    doc: ModelDocument,
    definitionId: DefinitionId,
    ancestors: Set<DefinitionId>,
    faded: boolean,
    pathDepth: number | null,
    editPath: readonly number[],
  ): THREE.Group {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.userData = { definitionId };
    if (ancestors.has(definitionId)) return group;
    const geometry = this.#geometryFor(doc, definitionId);
    const materials = faded || pathDepth !== null ? this.#faded : this.#normal;
    const guides = new THREE.LineSegments(geometry.guides, this.#guideMaterial);
    guides.userData = { excludeFromBounds: true };
    group.add(
      new THREE.Mesh(geometry.faces, materials.front),
      new THREE.Mesh(geometry.faces, materials.back),
      new THREE.LineSegments(geometry.edges, materials.edge),
      guides,
    );
    const nested = new Set(ancestors).add(definitionId);
    for (const instance of doc.store(definitionId).instances()) {
      if (instance.attributes.hidden) continue;
      let childFaded = faded;
      let childPath: number | null = null;
      if (pathDepth !== null) {
        const onPath = editPath[pathDepth] === instance.id;
        childFaded = !onPath;
        childPath = onPath && pathDepth + 1 < editPath.length ? pathDepth + 1 : null;
      }
      const child = this.#buildNode(doc, instance.definitionId, nested, childFaded, childPath, editPath);
      child.matrix.fromArray(instance.transform);
      child.matrixWorldNeedsUpdate = true;
      group.add(child);
    }
    return group;
  }

  #rebuildSelectionOverlay(doc: ModelDocument): void {
    disposeMeshes(this.overlay);
    const refs = this.#source.selection.refs();
    if (refs.length === 0) return;
    this.#drawHighlight(doc, this.overlay, refs, this.#selectionFaceMaterial, this.#selectionEdgeMaterial);
  }

  #rebuildPreview(doc: ModelDocument): void {
    disposeMeshes(this.preview);
    const preview = this.#source.preview;
    if (!preview) return;
    const byStyle = new Map<ViewPreviewLineStyle, number[]>();
    for (const { a, b, style } of preview.lines) {
      let positions = byStyle.get(style);
      if (!positions) byStyle.set(style, (positions = []));
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (const [style, positions] of byStyle) {
      const geometry = new THREE.BufferGeometry();
      setPositions(geometry, positions);
      const lines = new THREE.LineSegments(geometry, this.#previewMaterial(style));
      lines.renderOrder = PREVIEW_RENDER_ORDER;
      this.preview.add(lines);
    }
    if (preview.highlight.length > 0) {
      const highlight = new THREE.Group();
      highlight.matrixAutoUpdate = false;
      this.#drawHighlight(
        doc,
        highlight,
        preview.highlight,
        this.#hoverFaceMaterial,
        this.#hoverEdgeMaterial,
      );
      this.preview.add(highlight);
    }
  }

  #previewMaterial(style: ViewPreviewLineStyle): THREE.LineBasicMaterial {
    let material = this.#previewMaterials.get(style);
    if (!material) {
      material = new THREE.LineBasicMaterial({
        color: PREVIEW_COLORS[style],
        depthTest: false,
        transparent: true,
      });
      this.#previewMaterials.set(style, material);
    }
    return material;
  }

  /** Draws faces, edges and instance boxes of the active context into `target`, which gets the context transform. */
  #drawHighlight(
    doc: ModelDocument,
    target: THREE.Group,
    refs: readonly ViewEntityRef[],
    faceMaterial: THREE.Material,
    edgeMaterial: THREE.LineBasicMaterial,
  ): void {
    const context = this.#source.activeContext;
    if (!doc.definition(context)) return;
    const store = doc.store(context);
    target.matrix.fromArray(this.#source.activeContextTransform);
    target.matrixWorldNeedsUpdate = true;

    const facePositions: number[] = [];
    const faceNormals: number[] = [];
    const edgePositions: number[] = [];
    for (const ref of refs) {
      if (ref.kind === 'face' && store.face(ref.id as FaceId)) {
        appendFaceTriangles(store, ref.id as FaceId, facePositions, faceNormals);
      } else if (ref.kind === 'edge' && store.edge(ref.id as EdgeId)) {
        appendEdge(store, ref.id as EdgeId, edgePositions, true);
      } else if (ref.kind === 'instance') {
        const instance = store.instance(ref.id as InstanceId);
        if (instance)
          target.add(this.#instanceBox(doc, instance.definitionId, instance.transform, edgeMaterial));
      }
    }
    if (facePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      setPositions(geometry, facePositions, faceNormals);
      target.add(new THREE.Mesh(geometry, faceMaterial));
    }
    if (edgePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      setPositions(geometry, edgePositions);
      target.add(new THREE.LineSegments(geometry, edgeMaterial));
    }
  }

  /** Box outline around an instance, the selection indicator for groups and components. */
  #instanceBox(
    doc: ModelDocument,
    definitionId: DefinitionId,
    transform: readonly number[],
    material: THREE.LineBasicMaterial,
  ): THREE.LineSegments {
    const node = this.#buildNode(doc, definitionId, new Set(), false, null, []);
    node.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    node.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      if ((object.userData as { excludeFromBounds?: boolean }).excludeFromBounds === true) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
        box.union(part.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld));
      }
    });
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
    const lines = new THREE.LineSegments(geometry, material);
    lines.matrixAutoUpdate = false;
    lines.matrix.fromArray(transform);
    return lines;
  }
}
