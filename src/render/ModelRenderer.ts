/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import type { AssetId, DefinitionId, EdgeId, FaceId, InstanceId, MaterialId } from '../kernel/ids';
import { changeContext } from '../kernel/model/changes';
import type { EntityStore } from '../kernel/model/EntityStore';
import type { ModelDocument } from '../kernel/model/ModelDocument';
import type { TextureAssetData } from '../kernel/model/types';
import { isTagVisible } from '../kernel/model/visibility';
import { resolveAnnotation } from '../kernel/ops/annotations';
import {
  sideMaterial,
  sidePlacement,
  textureAxes,
  textureCoordinates,
  type FaceSide,
} from '../kernel/ops/materials';
import { smoothVertexNormals } from '../kernel/ops/shading';
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
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { DEFAULT_STYLE_SETTINGS, type ModelAxes, type StyleSettings } from '../kernel/model/types';
import { buildEdgeStyleArrays } from './styles/edgeGeometry';
import {
  BACK_EDGE_RENDER_ORDER,
  EdgeStyleMaterials,
  srgbColor,
  X_RAY_OPACITY,
  type StyleView,
} from './styles/edgeStyle';

/** Triangles of one definition that share a side and a material. `materialId` null means the default material. */
interface FaceBucket {
  readonly side: FaceSide;
  readonly materialId: MaterialId | null;
  readonly geometry: THREE.BufferGeometry;
}

interface DefinitionGeometry {
  /** One merged geometry per (side, material). Replaced whenever the definition is rebuilt. */
  faces: FaceBucket[];
  readonly edges: THREE.BufferGeometry;
  readonly guides: THREE.BufferGeometry;
  readonly annotations: THREE.BufferGeometry;
  /** Edge ends, for the endpoints style. */
  readonly endpoints: THREE.BufferGeometry;
  /** Wide outline candidates; null unless the style shows profiles. */
  profiles: LineSegmentsGeometry | null;
  /** Wide edges; null unless the style uses depth cue. */
  depthCue: LineSegmentsGeometry | null;
}

/** A decoded texture image, shared by every material that uses the asset. */
interface TextureEntry {
  readonly bytes: Uint8Array;
  texture: THREE.Texture | null;
}

/** Drawn on top of the model, after it. */
const PREVIEW_RENDER_ORDER = 10;

/** Writes a face's triangles (positions and flat normals) to the output arrays. Degenerate faces are skipped. */
function appendFaceTriangles(
  doc: ModelDocument,
  store: EntityStore,
  faceId: FaceId,
  positions: number[],
  normals: number[],
): void {
  const face = store.getFace(faceId);
  if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) return;
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

interface BucketArrays {
  readonly side: FaceSide;
  readonly materialId: MaterialId | null;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
}

/**
 * Splits a definition's visible faces into buckets by side and material. Each vertex carries its position, its
 * normal (averaged across smooth surfaces, flat otherwise) and texture coordinates in meters from the planar
 * projection and the side's placement; materials divide those by their tile size.
 */
function buildFaceBuckets(doc: ModelDocument, store: EntityStore): BucketArrays[] {
  const buckets = new Map<string, BucketArrays>();
  const bucketFor = (side: FaceSide, materialId: MaterialId | null): BucketArrays => {
    const key = `${side}:${materialId === null ? 'default' : String(materialId)}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { side, materialId, positions: [], normals: [], uvs: [] }));
    return bucket;
  };
  const smooth = smoothVertexNormals(store);
  for (const face of store.faces()) {
    if (face.attributes.hidden || !face.plane || !isTagVisible(doc, face.attributes.tagId)) continue;
    const { normal } = face.plane;
    const axes = textureAxes(normal);
    const vertexNormals = smooth.get(face.id);
    const { vertices, indices } = triangulateFace(store, face.id);
    for (const side of ['front', 'back'] as const) {
      const materialId = sideMaterial(face.attributes, side);
      const bucket = bucketFor(side, materialId !== null && doc.material(materialId) ? materialId : null);
      const placement = sidePlacement(face.attributes, side);
      for (const index of indices) {
        const vertex = vertices[index];
        if (vertex === undefined) continue;
        const p = store.position(vertex);
        const n = vertexNormals?.get(vertex) ?? normal;
        const uv = textureCoordinates(p, axes, placement);
        bucket.positions.push(p.x, p.y, p.z);
        bucket.normals.push(n.x, n.y, n.z);
        bucket.uvs.push(uv.x, uv.y);
      }
    }
  }
  return [...buckets.values()].filter((bucket) => bucket.positions.length > 0);
}

function appendEdge(
  doc: ModelDocument,
  store: EntityStore,
  edgeId: EdgeId,
  positions: number[],
  includeSoft = false,
): void {
  const edge = store.getEdge(edgeId);
  if (edge.attributes.hidden || (edge.attributes.soft && !includeSoft)) return;
  if (!isTagVisible(doc, edge.attributes.tagId)) return;
  const a = store.position(edge.v0);
  const b = store.position(edge.v1);
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function appendGuides(doc: ModelDocument, store: EntityStore, positions: number[]): void {
  for (const guide of store.guides()) {
    if (guide.attributes.hidden || !isTagVisible(doc, guide.attributes.tagId)) continue;
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

/** Extension, dimension and leader lines of a definition's visible annotations. */
function appendAnnotations(doc: ModelDocument, store: EntityStore, positions: number[]): void {
  for (const annotation of store.annotations()) {
    if (annotation.attributes.hidden || !isTagVisible(doc, annotation.attributes.tagId)) continue;
    for (const [a, b] of resolveAnnotation(store, annotation).lines)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
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

/** Keeps faces behind their own edges. */
const FACE_POLYGON_OFFSET = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

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
  /** Called when something finished loading in the background (a decoded texture) and a new frame is needed. */
  readonly #onAsyncChange: () => void;
  /** Edge materials of the current style; rebuilt, with every definition's geometry, when the style changes. */
  readonly #edgeStyles = new EdgeStyleMaterials(DEFAULT_STYLE_SETTINGS);
  /** The style and drawing axes the current geometry and materials were built for. */
  #style: StyleSettings | null = null;
  #axes: ModelAxes | null = null;
  readonly #guideMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.guide });
  readonly #annotationMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.annotation });
  readonly #selectionFaceMaterial = new THREE.MeshBasicMaterial({
    color: VIEW_COLORS.selection,
    transparent: true,
    opacity: SELECTION_FACE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #selectionEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.selection });
  readonly #lockedEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.locked });
  readonly #hoverFaceMaterial = new THREE.MeshBasicMaterial({
    color: VIEW_COLORS.hover,
    transparent: true,
    opacity: HOVER_FACE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  readonly #hoverEdgeMaterial = new THREE.LineBasicMaterial({ color: VIEW_COLORS.hover });
  readonly #previewMaterials = new Map<ViewPreviewLineStyle, THREE.LineBasicMaterial>();

  /** three.js materials for faces, keyed by material (or `default`), side and fading. */
  readonly #faceMaterials = new Map<string, THREE.Material>();
  readonly #textures = new Map<AssetId, TextureEntry>();
  readonly #dirtyMaterials = new Set<MaterialId>();
  readonly #dirtyAssets = new Set<AssetId>();
  #disposed = false;

  readonly #geometries = new Map<DefinitionId, DefinitionGeometry>();
  readonly #dirtyDefinitions = new Set<DefinitionId>();
  #structureDirty = true;
  #selectionDirty = true;
  #previewDirty = true;

  constructor(source: ViewSource, onAsyncChange: () => void = () => undefined) {
    this.#source = source;
    this.#onAsyncChange = onAsyncChange;
    for (const group of [this.root, this.overlay, this.preview]) group.matrixAutoUpdate = false;
  }

  /** Records what a session change invalidates. Call `update` before rendering. */
  handleChange(change: ViewChange): void {
    if (change.kind === 'document') {
      for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
      this.#geometries.clear();
      this.#disposeFaceMaterials(() => true);
      for (const id of [...this.#textures.keys()]) this.#disposeTexture(id);
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
        if (modelChange.kind.startsWith('tag.')) {
          // Tag visibility can affect any definition's geometry and which instances are drawn.
          for (const definitionId of this.#geometries.keys()) this.#dirtyDefinitions.add(definitionId);
          this.#structureDirty = true;
        }
        if (modelChange.kind === 'material.attributes') {
          this.#dirtyMaterials.add(modelChange.id);
          this.#structureDirty = true;
        } else if (modelChange.kind === 'material.add' || modelChange.kind === 'material.remove') {
          this.#dirtyMaterials.add(modelChange.data.id);
          this.#structureDirty = true;
        } else if (modelChange.kind === 'asset.add' || modelChange.kind === 'asset.remove') {
          this.#dirtyAssets.add(modelChange.data.id);
          this.#structureDirty = true;
        }
        // Edges colored by material show material colors, so material changes rebuild them.
        if (modelChange.kind.startsWith('material.') && this.#style?.edgeColorMode === 'byMaterial') {
          for (const definitionId of this.#geometries.keys()) this.#dirtyDefinitions.add(definitionId);
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
    if (doc.style !== this.#style || (doc.style.edgeColorMode === 'byAxis' && doc.axes !== this.#axes)) {
      // A new style rebuilds every material and definition; style changes are rare, one-step user actions.
      this.#style = doc.style;
      this.#axes = doc.axes;
      this.#edgeStyles.setStyle(doc.style);
      this.#disposeFaceMaterials(() => true);
      for (const definitionId of this.#geometries.keys()) this.#dirtyDefinitions.add(definitionId);
      this.#structureDirty = true;
      changed = true;
    }
    for (const assetId of this.#dirtyAssets) {
      const entry = this.#textures.get(assetId);
      if (entry && doc.asset(assetId)?.bytes !== entry.bytes) this.#disposeTexture(assetId);
    }
    this.#dirtyAssets.clear();
    if (this.#dirtyMaterials.size > 0) {
      const dirty = new Set<string>([...this.#dirtyMaterials].map(String));
      this.#disposeFaceMaterials((key) => dirty.has(key.split(':')[0] ?? ''));
      this.#dirtyMaterials.clear();
    }
    for (const definitionId of this.#dirtyDefinitions) {
      const geometry = this.#geometries.get(definitionId);
      if (!geometry) continue;
      if (doc.definition(definitionId)) {
        this.#fillGeometry(doc, doc.store(definitionId), geometry);
        // Face buckets are new geometries, so the meshes that show them must be rebuilt.
        this.#structureDirty = true;
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
    this.#disposed = true;
    for (const geometry of this.#geometries.values()) this.#disposeGeometry(geometry);
    this.#geometries.clear();
    disposeMeshes(this.overlay);
    disposeMeshes(this.preview);
    this.#disposeFaceMaterials(() => true);
    for (const id of [...this.#textures.keys()]) this.#disposeTexture(id);
    const materials: THREE.Material[] = [
      ...this.#edgeStyles.materials(),
      this.#guideMaterial,
      this.#annotationMaterial,
      this.#selectionFaceMaterial,
      this.#selectionEdgeMaterial,
      this.#lockedEdgeMaterial,
      this.#hoverFaceMaterial,
      this.#hoverEdgeMaterial,
      ...this.#previewMaterials.values(),
    ];
    for (const material of materials) material.dispose();
  }

  /** Passes the frame's drawing size, camera and model depth range to the style materials. */
  setStyleView(view: StyleView): void {
    this.#edgeStyles.setView(view);
  }

  // ---------------------------------------------------------------------------------------------- face materials

  /**
   * The three.js material for one side of faces painted with `materialId` (null: the default material, drawn in
   * the style's front or back color). Model materials use `MeshStandardMaterial` for metalness and roughness;
   * transparent ones don't write depth, so three.js draws them after opaque geometry, sorted back to front.
   */
  #faceMaterial(
    doc: ModelDocument,
    materialId: MaterialId | null,
    side: FaceSide,
    faded: boolean,
  ): THREE.Material {
    const style = doc.style;
    // Monochrome and hidden line ignore materials; every face shares the default bucket's material.
    const ignoresMaterials = style.faceStyle === 'monochrome' || style.faceStyle === 'hiddenLine';
    const data = materialId === null || ignoresMaterials ? undefined : doc.material(materialId);
    const key = `${data ? String(data.id) : 'default'}:${side}:${faded ? 'faded' : 'normal'}`;
    const cached = this.#faceMaterials.get(key);
    if (cached) return cached;
    const threeSide = side === 'front' ? THREE.FrontSide : THREE.BackSide;
    let material: THREE.Material;
    if (style.faceStyle === 'hiddenLine') {
      // Unlit faces in the background color hide what is behind them.
      material = new THREE.MeshBasicMaterial({
        color: srgbColor(style.backgroundColor),
        side: threeSide,
        ...(faded ? { transparent: true, opacity: FADED_OPACITY } : {}),
        ...FACE_POLYGON_OFFSET,
      });
    } else if (!data) {
      material = new THREE.MeshLambertMaterial({
        color: srgbColor(side === 'front' ? style.frontColor : style.backColor),
        side: threeSide,
        ...(faded ? { transparent: true, opacity: FADED_OPACITY } : {}),
        ...FACE_POLYGON_OFFSET,
      });
    } else {
      const opacity = data.opacity * (faded ? FADED_OPACITY : 1);
      const transparent = opacity < 1;
      const standard = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(data.color.r, data.color.g, data.color.b),
        metalness: data.metalness,
        roughness: data.roughness,
        side: threeSide,
        transparent,
        opacity,
        depthWrite: !transparent || faded,
        ...FACE_POLYGON_OFFSET,
      });
      const showTextures = style.faceStyle === 'shadedWithTextures';
      const asset = data.texture && showTextures ? doc.asset(data.texture.assetId) : undefined;
      const base = asset ? this.#textureFor(asset) : null;
      if (base && data.texture) {
        const map = base.clone();
        map.repeat.set(1 / data.texture.width, 1 / data.texture.height);
        map.needsUpdate = true;
        standard.map = map;
        standard.color.setRGB(1, 1, 1);
      }
      material = standard;
    }
    if (style.xRay) {
      material.transparent = true;
      material.opacity *= X_RAY_OPACITY;
      material.depthWrite = false;
    }
    this.#faceMaterials.set(key, material);
    return material;
  }

  #disposeFaceMaterials(matches: (key: string) => boolean): void {
    for (const [key, material] of [...this.#faceMaterials]) {
      if (!matches(key)) continue;
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
      this.#faceMaterials.delete(key);
    }
  }

  /** The decoded texture of an asset, or null while it is still decoding or when it can't be decoded. */
  #textureFor(asset: TextureAssetData): THREE.Texture | null {
    const existing = this.#textures.get(asset.id);
    if (existing?.bytes === asset.bytes) return existing.texture;
    if (existing) this.#disposeTexture(asset.id);
    const entry: TextureEntry = { bytes: asset.bytes, texture: null };
    this.#textures.set(asset.id, entry);
    // Without image decoding (outside a browser) textured materials show their color.
    if (typeof createImageBitmap !== 'function') return null;
    // Bytes go straight from memory to the decoder; no object URL or network request is involved.
    createImageBitmap(new Blob([asset.bytes.slice()], { type: asset.mimeType }), {
      imageOrientation: 'flipY',
    })
      .then((bitmap) => {
        if (this.#disposed || this.#textures.get(asset.id) !== entry) {
          bitmap.close();
          return;
        }
        const texture = new THREE.Texture(bitmap);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        entry.texture = texture;
        for (const material of this.#source.doc.materials()) {
          if (material.texture?.assetId === asset.id) this.#dirtyMaterials.add(material.id);
        }
        this.#structureDirty = true;
        this.#onAsyncChange();
      })
      .catch(() => {
        // An undecodable image falls back to the material's color; the entry stays so decoding isn't retried.
      });
    return null;
  }

  #disposeTexture(assetId: AssetId): void {
    const entry = this.#textures.get(assetId);
    if (!entry) return;
    this.#textures.delete(assetId);
    if (entry.texture) {
      const image = entry.texture.image as { close?: () => void } | null;
      entry.texture.dispose();
      image?.close?.();
    }
  }

  // ---------------------------------------------------------------------------------------------- geometry

  #geometryFor(doc: ModelDocument, definitionId: DefinitionId): DefinitionGeometry {
    let geometry = this.#geometries.get(definitionId);
    if (!geometry) {
      geometry = {
        faces: [],
        edges: new THREE.BufferGeometry(),
        guides: new THREE.BufferGeometry(),
        annotations: new THREE.BufferGeometry(),
        endpoints: new THREE.BufferGeometry(),
        profiles: null,
        depthCue: null,
      };
      this.#fillGeometry(doc, doc.store(definitionId), geometry);
      this.#geometries.set(definitionId, geometry);
    }
    return geometry;
  }

  #fillGeometry(doc: ModelDocument, store: EntityStore, geometry: DefinitionGeometry): void {
    for (const bucket of geometry.faces) bucket.geometry.dispose();
    geometry.faces = buildFaceBuckets(doc, store).map((arrays) => {
      const faces = new THREE.BufferGeometry();
      setPositions(faces, arrays.positions, arrays.normals);
      faces.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uvs, 2));
      return { side: arrays.side, materialId: arrays.materialId, geometry: faces };
    });
    const style = doc.style;
    const edges = buildEdgeStyleArrays(doc, store, style, style.profiles);
    const guidePositions: number[] = [];
    appendGuides(doc, store, guidePositions);
    setPositions(geometry.edges, edges.positions);
    geometry.edges.setAttribute('color', new THREE.Float32BufferAttribute(edges.colors, 3));
    geometry.edges.setAttribute('edgeOther', new THREE.Float32BufferAttribute(edges.others, 3));
    geometry.edges.setAttribute('lineDistance', new THREE.Float32BufferAttribute(edges.distances, 1));
    setPositions(geometry.endpoints, edges.endpoints);
    geometry.profiles?.dispose();
    geometry.profiles = null;
    if (style.profiles && edges.profilePositions.length > 0) {
      const profiles = new LineSegmentsGeometry().setPositions(edges.profilePositions);
      profiles.setAttribute(
        'profileInA',
        new THREE.InstancedBufferAttribute(new Float32Array(edges.profileInA), 3),
      );
      profiles.setAttribute(
        'profileInB',
        new THREE.InstancedBufferAttribute(new Float32Array(edges.profileInB), 3),
      );
      geometry.profiles = profiles;
    }
    geometry.depthCue?.dispose();
    geometry.depthCue =
      style.showEdges && style.depthCue && edges.positions.length > 0
        ? new LineSegmentsGeometry().setPositions(edges.positions).setColors(edges.colors)
        : null;
    setPositions(geometry.guides, guidePositions);
    const annotationPositions: number[] = [];
    appendAnnotations(doc, store, annotationPositions);
    setPositions(geometry.annotations, annotationPositions);
  }

  #disposeGeometry(geometry: DefinitionGeometry): void {
    for (const bucket of geometry.faces) bucket.geometry.dispose();
    geometry.edges.dispose();
    geometry.guides.dispose();
    geometry.annotations.dispose();
    geometry.endpoints.dispose();
    geometry.profiles?.dispose();
    geometry.depthCue?.dispose();
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
   * stays unfaded. Everything inside the active context is drawn normally. `inherited` is the material of the
   * innermost painted instance around this node, which faces with the default material show.
   */
  #buildNode(
    doc: ModelDocument,
    definitionId: DefinitionId,
    ancestors: Set<DefinitionId>,
    faded: boolean,
    pathDepth: number | null,
    editPath: readonly number[],
    inherited: MaterialId | null = null,
  ): THREE.Group {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.userData = { definitionId };
    if (ancestors.has(definitionId)) return group;
    const geometry = this.#geometryFor(doc, definitionId);
    const fadedNode = faded || pathDepth !== null;
    const guides = new THREE.LineSegments(geometry.guides, this.#guideMaterial);
    guides.userData = { excludeFromBounds: true };
    const annotations = new THREE.LineSegments(geometry.annotations, this.#annotationMaterial);
    annotations.userData = { excludeFromBounds: true };
    const style = doc.style;
    const edgeStyles = this.#edgeStyles;
    for (const bucket of geometry.faces) {
      const material = this.#faceMaterial(doc, bucket.materialId ?? inherited, bucket.side, fadedNode);
      const mesh = new THREE.Mesh(bucket.geometry, material);
      mesh.visible = style.faceStyle !== 'wireframe';
      group.add(mesh);
    }
    const edges = new THREE.LineSegments(geometry.edges, fadedNode ? edgeStyles.fadedEdge : edgeStyles.edge);
    // Depth cue draws the edges as wide lines instead.
    edges.visible = style.showEdges && geometry.depthCue === null;
    group.add(edges, guides, annotations);
    // Style extras share the definition's geometry; none of them count for bounds or cast shadows.
    const addExtra = (object: THREE.Object3D): void => {
      object.userData = { excludeFromBounds: true, noShadows: true };
      group.add(object);
    };
    const facesHideEdges = style.faceStyle !== 'wireframe' && !style.xRay;
    if (!fadedNode && style.showEdges && style.backEdges && facesHideEdges) {
      const backEdges = new THREE.LineSegments(geometry.edges, edgeStyles.backEdge);
      backEdges.renderOrder = BACK_EDGE_RENDER_ORDER;
      addExtra(backEdges);
    }
    if (style.showEdges && geometry.depthCue) {
      addExtra(
        new LineSegments2(geometry.depthCue, fadedNode ? edgeStyles.fadedDepthCue : edgeStyles.depthCue),
      );
    }
    if (style.profiles && geometry.profiles) {
      addExtra(
        new LineSegments2(geometry.profiles, fadedNode ? edgeStyles.fadedProfile : edgeStyles.profile),
      );
    }
    if (!fadedNode && style.showEdges && style.endpoints) {
      addExtra(new THREE.Points(geometry.endpoints, edgeStyles.endpoint));
    }
    const nested = new Set(ancestors).add(definitionId);
    for (const instance of doc.store(definitionId).instances()) {
      if (instance.attributes.hidden) continue;
      const onPath = pathDepth !== null && editPath[pathDepth] === instance.id;
      // A hidden tag hides the instance and everything inside it, except an open group being edited.
      if (!onPath && !isTagVisible(doc, instance.attributes.tagId)) continue;
      let childFaded = faded;
      let childPath: number | null = null;
      if (pathDepth !== null) {
        childFaded = !onPath;
        childPath = onPath && pathDepth + 1 < editPath.length ? pathDepth + 1 : null;
      }
      const child = this.#buildNode(
        doc,
        instance.definitionId,
        nested,
        childFaded,
        childPath,
        editPath,
        instance.attributes.materialId ?? inherited,
      );
      // Read by the shadow controller, which sets castShadow and receiveShadow on the meshes below.
      Object.assign(child.userData, {
        castShadows: instance.attributes.castShadows,
        receiveShadows: instance.attributes.receiveShadows,
      });
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
    this.#drawHighlight(
      doc,
      this.overlay,
      refs,
      this.#selectionFaceMaterial,
      this.#selectionEdgeMaterial,
      this.#lockedEdgeMaterial,
    );
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
    /** Box outline of locked groups and components. */
    lockedEdgeMaterial: THREE.LineBasicMaterial = edgeMaterial,
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
        appendFaceTriangles(doc, store, ref.id as FaceId, facePositions, faceNormals);
      } else if (ref.kind === 'edge' && store.edge(ref.id as EdgeId)) {
        appendEdge(doc, store, ref.id as EdgeId, edgePositions, true);
      } else if (ref.kind === 'instance') {
        const instance = store.instance(ref.id as InstanceId);
        if (instance) {
          const material = instance.attributes.locked ? lockedEdgeMaterial : edgeMaterial;
          target.add(this.#instanceBox(doc, instance.definitionId, instance.transform, material));
        }
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
