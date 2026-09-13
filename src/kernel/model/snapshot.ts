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

import type { AnnotationId, SceneId, SectionPlaneId } from '../ids';
import type { AnnotationAnchor, AnnotationData, AnnotationGeometry } from './types';
import {
  DEFAULT_SHADOW_SETTINGS,
  type SceneCamera,
  type SceneData,
  type SceneSectionState,
  type SectionPlaneData,
  type ShadowSettings,
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
import { isMat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import { err, ok, type Result } from '../result';
import type { Change } from './changes';
import { ModelDocument, type DocumentOptions } from './ModelDocument';
import type { AssetId } from '../ids';
import { isTextureMimeType, MAX_TEXTURE_BYTES, sha256Hex } from './assets';
import {
  DEFAULT_MATERIAL_METALNESS,
  DEFAULT_MATERIAL_ROUGHNESS,
  type TexturePlacement,
  type TextureAssetData,
  type TextureMimeType,
  DEFAULT_MODEL_AXES,
  DEFAULT_TAG_COLOR,
  type CurveData,
  type CurveParams,
  type EdgeAttributes,
  type EdgeData,
  type FaceAttributes,
  type FaceData,
  type GuideAttributes,
  type GuideData,
  type GuideGeometry,
  type InstanceAttributes,
  type InstanceData,
  type Loop,
  type MaterialData,
  type ModelAxes,
  type TagData,
  type VertexData,
} from './types';
import { validateDocument } from './validate';
import type { ValidationProblem } from '../errors';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_FOG_SETTINGS,
  DEFAULT_STYLE_SETTINGS,
  type EdgeColorMode,
  type EnvironmentSettings,
  type FaceStyle,
  type FogSettings,
  type NamedStyle,
  type Rgb,
  type StyleSettings,
} from './types';
import {
  environmentCopy,
  fogCopy,
  isDefaultEnvironment,
  isDefaultFog,
  isDefaultStyle,
  namedStylesCopy,
  styleCopy,
} from './presentation';

export const SNAPSHOT_FORMAT = 'planar-document';
export const SNAPSHOT_VERSION = 1;
const MAX_REPORTED_ERRORS = 10;

/** Face attributes as stored: texture placements are written only when set. */
export type FaceAttributesSnapshot = Omit<FaceAttributes, 'frontTexturePlacement' | 'backTexturePlacement'> &
  Partial<Pick<FaceAttributes, 'frontTexturePlacement' | 'backTexturePlacement'>>;

export interface FaceSnapshot extends Omit<FaceData, 'attributes'> {
  readonly attributes: FaceAttributesSnapshot;
}

/** A material as stored: metalness and roughness are written only when not the default, the texture only when set. */
export type MaterialSnapshot = Pick<MaterialData, 'id' | 'name' | 'color' | 'opacity'> &
  Partial<Pick<MaterialData, 'metalness' | 'roughness' | 'texture'>>;

/** A texture asset as stored. The bytes live outside the snapshot, found by their SHA-256 digest. */
export interface TextureAssetSnapshot {
  readonly id: AssetId;
  readonly name: string;
  readonly mimeType: TextureMimeType;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly sha256: string;
}

/** Supplies texture bytes for {@link restoreSnapshot}, by SHA-256 digest (lowercase hex). */
export type TextureBytesSource = (sha256: string) => Uint8Array | undefined;

export interface DefinitionSnapshot {
  readonly id: DefinitionId;
  readonly name: string;
  readonly isGroup: boolean;
  readonly vertices: readonly VertexData[];
  readonly edges: readonly EdgeData[];
  readonly faces: readonly FaceSnapshot[];
  readonly curves: readonly CurveData[];
  readonly instances: readonly InstanceData[];
  readonly guides: readonly GuideData[];
  /** Present only when the definition has annotations. */
  readonly annotations?: readonly AnnotationData[];
  /** Present only when the definition has section planes. */
  readonly sectionPlanes?: readonly SectionPlaneData[];
}

/** Plain-JSON form of a document's contents. History is not included. */
export interface DocumentSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly nextId: number;
  readonly rootDefinitionId: DefinitionId;
  readonly materials: readonly MaterialSnapshot[];
  readonly tags: readonly TagData[];
  readonly definitions: readonly DefinitionSnapshot[];
  /** Present only when the drawing axes differ from the default. */
  readonly axes?: ModelAxes;
  /** Present only when the document stores texture images. */
  readonly textures?: readonly TextureAssetSnapshot[];
  /** Present only when the shadow settings differ from the default. */
  readonly shadows?: ShadowSettings;
  /** Present only when the document has scenes. In display order. */
  readonly scenes?: readonly SceneSnapshot[];
  /** Present only when the style differs from the default. */
  readonly style?: StyleSettings;
  /** Present only when the model has saved styles. In display order. */
  readonly styles?: readonly NamedStyle[];
  /** Present only when the fog settings differ from the default. */
  readonly fog?: FogSettings;
  /** Present only when the environment settings differ from the default. */
  readonly environment?: EnvironmentSettings;
}

/** The encoded image of every texture asset, keyed by SHA-256 digest, for storing next to a snapshot. */
export function snapshotTextureFiles(
  doc: ModelDocument,
): Map<string, { readonly mimeType: TextureMimeType; readonly bytes: Uint8Array }> {
  const files = new Map<string, { mimeType: TextureMimeType; bytes: Uint8Array }>();
  for (const asset of [...doc.assets()].sort(byId)) {
    files.set(sha256Hex(asset.bytes), { mimeType: asset.mimeType, bytes: asset.bytes });
  }
  return files;
}

const shadowCopy = (s: ShadowSettings): ShadowSettings => ({
  enabled: s.enabled,
  dateTime: s.dateTime,
  latitude: s.latitude,
  longitude: s.longitude,
  northAngle: s.northAngle,
  light: s.light,
  dark: s.dark,
  useSunForShading: s.useSunForShading,
  onFaces: s.onFaces,
  onGround: s.onGround,
});

function isDefaultShadows(s: ShadowSettings): boolean {
  const defaults = DEFAULT_SHADOW_SETTINGS;
  return (Object.keys(defaults) as (keyof ShadowSettings)[]).every((key) => Object.is(s[key], defaults[key]));
}

/**
 * A scene as written to a snapshot. The style and fog save flags are written only when set, and the saved style and
 * fog only when present, so scenes from before styles existed keep their exact form.
 */
export type SceneSnapshot = Omit<SceneData, 'saves' | 'style' | 'fog'> & {
  readonly saves: Omit<SceneData['saves'], 'style' | 'fog'> & {
    readonly style?: boolean;
    readonly fog?: boolean;
  };
  readonly style?: StyleSettings;
  readonly fog?: FogSettings;
};

function sceneCopy(scene: SceneData): SceneSnapshot {
  const vector = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
  const camera = scene.camera;
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    includeInAnimation: scene.includeInAnimation,
    saves: {
      camera: scene.saves.camera,
      visibleTags: scene.saves.visibleTags,
      activeSections: scene.saves.activeSections,
      shadows: scene.saves.shadows,
      axes: scene.saves.axes,
      ...(scene.saves.style ? { style: true } : {}),
      ...(scene.saves.fog ? { fog: true } : {}),
    },
    ...(scene.style ? { style: styleCopy(scene.style) } : {}),
    ...(scene.fog ? { fog: fogCopy(scene.fog) } : {}),
    camera: camera
      ? {
          eye: vector(camera.eye),
          target: vector(camera.target),
          up: vector(camera.up),
          fovDegrees: camera.fovDegrees,
          projection: camera.projection,
          orthoHalfHeight: camera.orthoHalfHeight,
        }
      : null,
    hiddenTags: scene.hiddenTags ? [...scene.hiddenTags] : null,
    sections: scene.sections ? scene.sections.map((s) => ({ context: s.context, plane: s.plane })) : null,
    shadows: scene.shadows ? shadowCopy(scene.shadows) : null,
    axes: scene.axes
      ? {
          origin: vector(scene.axes.origin),
          xAxis: vector(scene.axes.xAxis),
          yAxis: vector(scene.axes.yAxis),
        }
      : null,
  };
}

// -------------------------------------------------------------------------------------------------- writing

const vec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const loopCopy = (loop: Loop): Loop => loop.map((use) => ({ edge: use.edge, reversed: use.reversed }));
const edgeAttributes = (a: EdgeAttributes): EdgeAttributes => ({
  soft: a.soft,
  smooth: a.smooth,
  hidden: a.hidden,
  materialId: a.materialId,
  tagId: a.tagId,
});
const placementCopy = (p: TexturePlacement): TexturePlacement => ({
  offsetX: p.offsetX,
  offsetY: p.offsetY,
  rotation: p.rotation,
  scaleX: p.scaleX,
  scaleY: p.scaleY,
});
const faceAttributes = (a: FaceAttributes): FaceAttributesSnapshot => ({
  frontMaterialId: a.frontMaterialId,
  backMaterialId: a.backMaterialId,
  tagId: a.tagId,
  hidden: a.hidden,
  ...(a.frontTexturePlacement ? { frontTexturePlacement: placementCopy(a.frontTexturePlacement) } : {}),
  ...(a.backTexturePlacement ? { backTexturePlacement: placementCopy(a.backTexturePlacement) } : {}),
});
const materialSnapshot = (m: MaterialData): MaterialSnapshot => ({
  id: m.id,
  name: m.name,
  color: { r: m.color.r, g: m.color.g, b: m.color.b },
  opacity: m.opacity,
  ...(m.metalness !== DEFAULT_MATERIAL_METALNESS ? { metalness: m.metalness } : {}),
  ...(m.roughness !== DEFAULT_MATERIAL_ROUGHNESS ? { roughness: m.roughness } : {}),
  ...(m.texture
    ? { texture: { assetId: m.texture.assetId, width: m.texture.width, height: m.texture.height } }
    : {}),
});
const instanceAttributes = (a: InstanceAttributes): InstanceAttributes => ({
  name: a.name,
  tagId: a.tagId,
  materialId: a.materialId,
  hidden: a.hidden,
  locked: a.locked,
  castShadows: a.castShadows,
  receiveShadows: a.receiveShadows,
});
const guideAttributes = (a: GuideAttributes): GuideAttributes => ({ hidden: a.hidden, tagId: a.tagId });

function annotationGeometryCopy(geometry: AnnotationGeometry): AnnotationGeometry {
  const anchor = (a: AnnotationAnchor): AnnotationAnchor => ({ point: vec(a.point), vertex: a.vertex });
  switch (geometry.kind) {
    case 'linear-dimension':
      return {
        kind: geometry.kind,
        start: anchor(geometry.start),
        end: anchor(geometry.end),
        offset: vec(geometry.offset),
      };
    case 'radial-dimension':
      return {
        kind: geometry.kind,
        curve: geometry.curve,
        diameter: geometry.diameter,
        labelPoint: vec(geometry.labelPoint),
      };
    case 'leader-text':
      return { kind: geometry.kind, target: anchor(geometry.target), offset: vec(geometry.offset) };
    case 'screen-text':
      return { kind: geometry.kind, x: geometry.x, y: geometry.y };
  }
}

function guideGeometryCopy(geometry: GuideGeometry): GuideGeometry {
  return geometry.kind === 'line'
    ? { kind: 'line', point: vec(geometry.point), direction: vec(geometry.direction) }
    : { kind: 'point', point: vec(geometry.point) };
}

function curveParamsCopy(params: CurveParams): CurveParams {
  if (params.kind === 'polyline') return { kind: 'polyline' };
  const frame = {
    center: vec(params.center),
    normal: vec(params.normal),
    xAxis: vec(params.xAxis),
    radius: params.radius,
  };
  switch (params.kind) {
    case 'circle':
      return { kind: 'circle', ...frame, segments: params.segments };
    case 'polygon':
      return { kind: 'polygon', ...frame, sides: params.sides };
    case 'arc':
      return {
        kind: 'arc',
        ...frame,
        startAngle: params.startAngle,
        endAngle: params.endAngle,
        segments: params.segments,
      };
  }
}

const byId = <T extends { readonly id: number }>(a: T, b: T): number => a.id - b.id;

function isDefaultAxes(axes: ModelAxes): boolean {
  const same = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  return (
    same(axes.origin, DEFAULT_MODEL_AXES.origin) &&
    same(axes.xAxis, DEFAULT_MODEL_AXES.xAxis) &&
    same(axes.yAxis, DEFAULT_MODEL_AXES.yAxis)
  );
}

/** Canonical snapshot: entities sorted by id, with a fixed key order, so equal documents serialize identically. */
export function createSnapshot(doc: ModelDocument): DocumentSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    nextId: doc.ids.next,
    rootDefinitionId: doc.rootDefinitionId,
    materials: [...doc.materials()].sort(byId).map(materialSnapshot),
    tags: [...doc.tags()].sort(byId).map((t) => ({
      id: t.id,
      name: t.name,
      visible: t.visible,
      color: { r: t.color.r, g: t.color.g, b: t.color.b },
    })),
    definitions: [...doc.definitions()].sort(byId).map((definition) => {
      const store = definition.store;
      return {
        id: definition.id,
        name: definition.attributes.name,
        isGroup: definition.attributes.isGroup,
        vertices: [...store.vertices()].sort(byId).map((v) => ({ id: v.id, position: vec(v.position) })),
        edges: [...store.edges()]
          .sort(byId)
          .map((e) => ({ id: e.id, v0: e.v0, v1: e.v1, attributes: edgeAttributes(e.attributes) })),
        faces: [...store.faces()].sort(byId).map((f) => ({
          id: f.id,
          outer: loopCopy(f.outer),
          inners: f.inners.map(loopCopy),
          attributes: faceAttributes(f.attributes),
        })),
        curves: [...store.curves()]
          .sort(byId)
          .map((c) => ({ id: c.id, params: curveParamsCopy(c.params), edges: [...c.edges] })),
        instances: [...store.instances()].sort(byId).map((i) => ({
          id: i.id,
          definitionId: i.definitionId,
          transform: [...i.transform],
          attributes: instanceAttributes(i.attributes),
        })),
        guides: [...store.guides()].sort(byId).map((g) => ({
          id: g.id,
          geometry: guideGeometryCopy(g.geometry),
          attributes: guideAttributes(g.attributes),
        })),
        ...(store.annotationCount === 0
          ? {}
          : {
              annotations: [...store.annotations()].sort(byId).map((a) => ({
                id: a.id,
                geometry: annotationGeometryCopy(a.geometry),
                attributes: {
                  text: a.attributes.text,
                  hidden: a.attributes.hidden,
                  tagId: a.attributes.tagId,
                },
              })),
            }),
        ...(store.sectionPlaneCount === 0
          ? {}
          : {
              sectionPlanes: [...store.sectionPlanes()].sort(byId).map((s) => ({
                id: s.id,
                name: s.name,
                point: vec(s.point),
                normal: vec(s.normal),
                active: s.active,
              })),
            }),
      };
    }),
    ...(isDefaultAxes(doc.axes)
      ? {}
      : { axes: { origin: vec(doc.axes.origin), xAxis: vec(doc.axes.xAxis), yAxis: vec(doc.axes.yAxis) } }),
    ...([...doc.assets()].length === 0
      ? {}
      : {
          textures: [...doc.assets()].sort(byId).map((asset) => ({
            id: asset.id,
            name: asset.name,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            byteLength: asset.bytes.byteLength,
            sha256: sha256Hex(asset.bytes),
          })),
        }),
    ...(isDefaultShadows(doc.shadows) ? {} : { shadows: shadowCopy(doc.shadows) }),
    ...(doc.scenes.length === 0 ? {} : { scenes: doc.scenes.map(sceneCopy) }),
    ...(isDefaultStyle(doc.style) ? {} : { style: styleCopy(doc.style) }),
    ...(doc.inModelStyles.length === 0 ? {} : { styles: namedStylesCopy(doc.inModelStyles) }),
    ...(isDefaultFog(doc.fog) ? {} : { fog: fogCopy(doc.fog) }),
    ...(isDefaultEnvironment(doc.environment) ? {} : { environment: environmentCopy(doc.environment) }),
  };
}

/**
 * Content hash of a document (history and the id counter are excluded). Two documents with identical contents,
 * including entity ids, have the same hash. Used to check undo/redo and serialization round trips.
 */
export function hashDocument(doc: ModelDocument): string {
  return cyrb53(JSON.stringify({ ...createSnapshot(doc), nextId: 0 }));
}

/** 53-bit non-cryptographic string hash (cyrb53, public domain). */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// -------------------------------------------------------------------------------------------------- reading

type Json = Record<string, unknown>;

/** Collects structural errors with JSON paths while reading untrusted input. */
class Reader {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    if (this.errors.length < MAX_REPORTED_ERRORS) this.errors.push(`${path}: ${message}`);
  }

  record(value: unknown, path: string): Json {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Json;
    this.fail(path, 'expected an object');
    return {};
  }

  list(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.fail(path, 'expected an array');
    return [];
  }

  // The reader is the trust boundary where nominal id brands are applied, so the caller chooses the brand.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  id<T extends number>(value: unknown, path: string): T {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value as T;
    this.fail(path, 'expected a positive integer id');
    return 0 as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  nullableId<T extends number>(value: unknown, path: string): T | null {
    return value === null ? null : this.id<T>(value, path);
  }

  number(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.fail(path, 'expected a finite number');
    return 0;
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value === 'boolean') return value;
    this.fail(path, 'expected a boolean');
    return false;
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string') return value;
    this.fail(path, 'expected a string');
    return '';
  }

  vec3(value: unknown, path: string): Vec3 {
    const v = this.record(value, path);
    return {
      x: this.number(v.x, `${path}.x`),
      y: this.number(v.y, `${path}.y`),
      z: this.number(v.z, `${path}.z`),
    };
  }

  loop(value: unknown, path: string): Loop {
    return this.list(value, path).map((entry, index) => {
      const use = this.record(entry, `${path}[${String(index)}]`);
      return {
        edge: this.id<EdgeId>(use.edge, `${path}[${String(index)}].edge`),
        reversed: this.boolean(use.reversed, `${path}[${String(index)}].reversed`),
      };
    });
  }
}

function readCurveParams(r: Reader, value: unknown, path: string): CurveParams {
  const p = r.record(value, path);
  if (p.kind === 'polyline') return { kind: 'polyline' };
  const frame = {
    center: r.vec3(p.center, `${path}.center`),
    normal: r.vec3(p.normal, `${path}.normal`),
    xAxis: r.vec3(p.xAxis, `${path}.xAxis`),
    radius: r.number(p.radius, `${path}.radius`),
  };
  switch (p.kind) {
    case 'circle':
      return { kind: 'circle', ...frame, segments: r.number(p.segments, `${path}.segments`) };
    case 'polygon':
      return { kind: 'polygon', ...frame, sides: r.number(p.sides, `${path}.sides`) };
    case 'arc':
      return {
        kind: 'arc',
        ...frame,
        startAngle: r.number(p.startAngle, `${path}.startAngle`),
        endAngle: r.number(p.endAngle, `${path}.endAngle`),
        segments: r.number(p.segments, `${path}.segments`),
      };
    default:
      r.fail(`${path}.kind`, 'unknown curve kind');
      return { kind: 'polyline' };
  }
}

function readGuideGeometry(r: Reader, value: unknown, path: string): GuideGeometry {
  const g = r.record(value, path);
  const point = r.vec3(g.point, `${path}.point`);
  switch (g.kind) {
    case 'line':
      return { kind: 'line', point, direction: r.vec3(g.direction, `${path}.direction`) };
    case 'point':
      return { kind: 'point', point };
    default:
      r.fail(`${path}.kind`, 'unknown guide kind');
      return { kind: 'point', point };
  }
}

function readAnchor(r: Reader, value: unknown, path: string): AnnotationAnchor {
  const a = r.record(value, path);
  return {
    point: r.vec3(a.point, `${path}.point`),
    vertex: r.nullableId<VertexId>(a.vertex, `${path}.vertex`),
  };
}

function readAnnotationGeometry(r: Reader, value: unknown, path: string): AnnotationGeometry {
  const g = r.record(value, path);
  switch (g.kind) {
    case 'linear-dimension':
      return {
        kind: 'linear-dimension',
        start: readAnchor(r, g.start, `${path}.start`),
        end: readAnchor(r, g.end, `${path}.end`),
        offset: r.vec3(g.offset, `${path}.offset`),
      };
    case 'radial-dimension':
      return {
        kind: 'radial-dimension',
        curve: r.id<CurveId>(g.curve, `${path}.curve`),
        diameter: r.boolean(g.diameter, `${path}.diameter`),
        labelPoint: r.vec3(g.labelPoint, `${path}.labelPoint`),
      };
    case 'leader-text':
      return {
        kind: 'leader-text',
        target: readAnchor(r, g.target, `${path}.target`),
        offset: r.vec3(g.offset, `${path}.offset`),
      };
    case 'screen-text':
      return { kind: 'screen-text', x: r.number(g.x, `${path}.x`), y: r.number(g.y, `${path}.y`) };
    default:
      r.fail(`${path}.kind`, 'unknown annotation kind');
      return { kind: 'screen-text', x: 0, y: 0 };
  }
}

function readPlacement(r: Reader, value: unknown, path: string): TexturePlacement | null {
  if (value === undefined || value === null) return null;
  const p = r.record(value, path);
  return {
    offsetX: r.number(p.offsetX, `${path}.offsetX`),
    offsetY: r.number(p.offsetY, `${path}.offsetY`),
    rotation: r.number(p.rotation, `${path}.rotation`),
    scaleX: r.number(p.scaleX, `${path}.scaleX`),
    scaleY: r.number(p.scaleY, `${path}.scaleY`),
  };
}

function readMaterial(r: Reader, value: unknown, path: string): MaterialData {
  const m = r.record(value, path);
  const color = r.record(m.color, `${path}.color`);
  const texture =
    m.texture === undefined || m.texture === null ? null : r.record(m.texture, `${path}.texture`);
  return {
    id: r.id<MaterialId>(m.id, `${path}.id`),
    name: r.string(m.name, `${path}.name`),
    color: {
      r: r.number(color.r, `${path}.color.r`),
      g: r.number(color.g, `${path}.color.g`),
      b: r.number(color.b, `${path}.color.b`),
    },
    opacity: r.number(m.opacity, `${path}.opacity`),
    // Physical attributes and textures were added later; older files get the defaults.
    metalness:
      m.metalness === undefined ? DEFAULT_MATERIAL_METALNESS : r.number(m.metalness, `${path}.metalness`),
    roughness:
      m.roughness === undefined ? DEFAULT_MATERIAL_ROUGHNESS : r.number(m.roughness, `${path}.roughness`),
    texture: texture
      ? {
          assetId: r.id<AssetId>(texture.assetId, `${path}.texture.assetId`),
          width: r.number(texture.width, `${path}.texture.width`),
          height: r.number(texture.height, `${path}.texture.height`),
        }
      : null,
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function readTextureAsset(
  r: Reader,
  value: unknown,
  path: string,
  textureBytes: TextureBytesSource,
): TextureAssetData {
  const t = r.record(value, path);
  const id = r.id<AssetId>(t.id, `${path}.id`);
  const name = r.string(t.name, `${path}.name`);
  const mimeType = isTextureMimeType(t.mimeType) ? t.mimeType : 'image/png';
  if (!isTextureMimeType(t.mimeType)) r.fail(`${path}.mimeType`, 'expected image/png or image/jpeg');
  const width = r.number(t.width, `${path}.width`);
  const height = r.number(t.height, `${path}.height`);
  const byteLength = r.number(t.byteLength, `${path}.byteLength`);
  const digest = r.string(t.sha256, `${path}.sha256`);
  let bytes: Uint8Array = new Uint8Array(0);
  if (!SHA256_HEX.test(digest)) {
    r.fail(`${path}.sha256`, 'expected a SHA-256 digest');
  } else if (byteLength > MAX_TEXTURE_BYTES) {
    r.fail(`${path}.byteLength`, 'the texture is too large');
  } else {
    const found = textureBytes(digest);
    if (!found) r.fail(path, 'the texture image is missing');
    else if (found.byteLength !== byteLength || sha256Hex(found) !== digest) {
      r.fail(path, 'the texture image is corrupt');
    } else bytes = found;
  }
  return { id, name, mimeType, width, height, bytes };
}

function readDefinition(
  r: Reader,
  value: unknown,
  path: string,
): DefinitionSnapshot & { readonly faces: readonly FaceData[] } {
  const d = r.record(value, path);
  const at = (key: string, index: number): string => `${path}.${key}[${String(index)}]`;
  return {
    id: r.id<DefinitionId>(d.id, `${path}.id`),
    name: r.string(d.name, `${path}.name`),
    isGroup: r.boolean(d.isGroup, `${path}.isGroup`),
    vertices: r.list(d.vertices, `${path}.vertices`).map((entry, i) => {
      const v = r.record(entry, at('vertices', i));
      return {
        id: r.id<VertexId>(v.id, `${at('vertices', i)}.id`),
        position: r.vec3(v.position, `${at('vertices', i)}.position`),
      };
    }),
    edges: r.list(d.edges, `${path}.edges`).map((entry, i) => {
      const p = at('edges', i);
      const e = r.record(entry, p);
      const a = r.record(e.attributes, `${p}.attributes`);
      return {
        id: r.id<EdgeId>(e.id, `${p}.id`),
        v0: r.id<VertexId>(e.v0, `${p}.v0`),
        v1: r.id<VertexId>(e.v1, `${p}.v1`),
        attributes: {
          soft: r.boolean(a.soft, `${p}.attributes.soft`),
          smooth: r.boolean(a.smooth, `${p}.attributes.smooth`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          materialId: r.nullableId<MaterialId>(a.materialId, `${p}.attributes.materialId`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
        },
      };
    }),
    faces: r.list(d.faces, `${path}.faces`).map((entry, i) => {
      const p = at('faces', i);
      const f = r.record(entry, p);
      const a = r.record(f.attributes, `${p}.attributes`);
      return {
        id: r.id<FaceId>(f.id, `${p}.id`),
        outer: r.loop(f.outer, `${p}.outer`),
        inners: r.list(f.inners, `${p}.inners`).map((loop, j) => r.loop(loop, `${p}.inners[${String(j)}]`)),
        attributes: {
          frontMaterialId: r.nullableId<MaterialId>(a.frontMaterialId, `${p}.attributes.frontMaterialId`),
          backMaterialId: r.nullableId<MaterialId>(a.backMaterialId, `${p}.attributes.backMaterialId`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          // Texture placements are optional; files without them use the default projection.
          frontTexturePlacement: readPlacement(
            r,
            a.frontTexturePlacement,
            `${p}.attributes.frontTexturePlacement`,
          ),
          backTexturePlacement: readPlacement(
            r,
            a.backTexturePlacement,
            `${p}.attributes.backTexturePlacement`,
          ),
        },
      };
    }),
    curves: r.list(d.curves, `${path}.curves`).map((entry, i) => {
      const p = at('curves', i);
      const c = r.record(entry, p);
      return {
        id: r.id<CurveId>(c.id, `${p}.id`),
        params: readCurveParams(r, c.params, `${p}.params`),
        edges: r.list(c.edges, `${p}.edges`).map((edge, j) => r.id<EdgeId>(edge, `${p}.edges[${String(j)}]`)),
      };
    }),
    instances: r.list(d.instances, `${path}.instances`).map((entry, i) => {
      const p = at('instances', i);
      const inst = r.record(entry, p);
      const a = r.record(inst.attributes, `${p}.attributes`);
      if (!isMat4(inst.transform)) r.fail(`${p}.transform`, 'expected 16 finite numbers');
      return {
        id: r.id<InstanceId>(inst.id, `${p}.id`),
        definitionId: r.id<DefinitionId>(inst.definitionId, `${p}.definitionId`),
        transform: isMat4(inst.transform) ? [...inst.transform] : [],
        attributes: {
          name: r.string(a.name, `${p}.attributes.name`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
          materialId: r.nullableId<MaterialId>(a.materialId, `${p}.attributes.materialId`),
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          locked: r.boolean(a.locked, `${p}.attributes.locked`),
          castShadows: r.boolean(a.castShadows, `${p}.attributes.castShadows`),
          receiveShadows: r.boolean(a.receiveShadows, `${p}.attributes.receiveShadows`),
        },
      };
    }),
    // Documents saved before guides existed have no `guides` array.
    guides: (d.guides === undefined ? [] : r.list(d.guides, `${path}.guides`)).map((entry, i) => {
      const p = at('guides', i);
      const g = r.record(entry, p);
      const a = r.record(g.attributes, `${p}.attributes`);
      return {
        id: r.id<GuideId>(g.id, `${p}.id`),
        geometry: readGuideGeometry(r, g.geometry, `${p}.geometry`),
        attributes: {
          hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
          tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
        },
      };
    }),
    annotations: (d.annotations === undefined ? [] : r.list(d.annotations, `${path}.annotations`)).map(
      (entry, i) => {
        const p = at('annotations', i);
        const n = r.record(entry, p);
        const a = r.record(n.attributes, `${p}.attributes`);
        return {
          id: r.id<AnnotationId>(n.id, `${p}.id`),
          geometry: readAnnotationGeometry(r, n.geometry, `${p}.geometry`),
          attributes: {
            text: a.text === null ? null : r.string(a.text, `${p}.attributes.text`),
            hidden: r.boolean(a.hidden, `${p}.attributes.hidden`),
            tagId: r.nullableId<TagId>(a.tagId, `${p}.attributes.tagId`),
          },
        };
      },
    ),
    sectionPlanes: (d.sectionPlanes === undefined
      ? []
      : r.list(d.sectionPlanes, `${path}.sectionPlanes`)
    ).map((entry, i) => {
      const p = at('sectionPlanes', i);
      const s = r.record(entry, p);
      return {
        id: r.id<SectionPlaneId>(s.id, `${p}.id`),
        name: r.string(s.name, `${p}.name`),
        point: r.vec3(s.point, `${p}.point`),
        normal: r.vec3(s.normal, `${p}.normal`),
        active: r.boolean(s.active, `${p}.active`),
      };
    }),
  };
}

function readShadows(r: Reader, value: unknown, path: string): ShadowSettings {
  const s = r.record(value, path);
  return {
    enabled: r.boolean(s.enabled, `${path}.enabled`),
    dateTime: r.string(s.dateTime, `${path}.dateTime`),
    latitude: r.number(s.latitude, `${path}.latitude`),
    longitude: r.number(s.longitude, `${path}.longitude`),
    northAngle: r.number(s.northAngle, `${path}.northAngle`),
    light: r.number(s.light, `${path}.light`),
    dark: r.number(s.dark, `${path}.dark`),
    useSunForShading: r.boolean(s.useSunForShading, `${path}.useSunForShading`),
    onFaces: r.boolean(s.onFaces, `${path}.onFaces`),
    onGround: r.boolean(s.onGround, `${path}.onGround`),
  };
}

function readRgb(r: Reader, value: unknown, path: string): Rgb {
  const c = r.record(value, path);
  return { r: r.number(c.r, `${path}.r`), g: r.number(c.g, `${path}.g`), b: r.number(c.b, `${path}.b`) };
}

/** Enum values are read as text; the validator reports unknown ones. */
function readStyle(r: Reader, value: unknown, path: string): StyleSettings {
  const s = r.record(value, path);
  return {
    faceStyle: r.string(s.faceStyle, `${path}.faceStyle`) as FaceStyle,
    xRay: r.boolean(s.xRay, `${path}.xRay`),
    frontColor: readRgb(r, s.frontColor, `${path}.frontColor`),
    backColor: readRgb(r, s.backColor, `${path}.backColor`),
    showEdges: r.boolean(s.showEdges, `${path}.showEdges`),
    backEdges: r.boolean(s.backEdges, `${path}.backEdges`),
    profiles: r.boolean(s.profiles, `${path}.profiles`),
    profileWidth: r.number(s.profileWidth, `${path}.profileWidth`),
    depthCue: r.boolean(s.depthCue, `${path}.depthCue`),
    depthCueWidth: r.number(s.depthCueWidth, `${path}.depthCueWidth`),
    extensions: r.boolean(s.extensions, `${path}.extensions`),
    extensionLength: r.number(s.extensionLength, `${path}.extensionLength`),
    endpoints: r.boolean(s.endpoints, `${path}.endpoints`),
    edgeColorMode: r.string(s.edgeColorMode, `${path}.edgeColorMode`) as EdgeColorMode,
    edgeColor: readRgb(r, s.edgeColor, `${path}.edgeColor`),
    backgroundColor: readRgb(r, s.backgroundColor, `${path}.backgroundColor`),
    sky: r.boolean(s.sky, `${path}.sky`),
    skyColor: readRgb(r, s.skyColor, `${path}.skyColor`),
    ground: r.boolean(s.ground, `${path}.ground`),
    groundColor: readRgb(r, s.groundColor, `${path}.groundColor`),
    groundFromBelow: r.boolean(s.groundFromBelow, `${path}.groundFromBelow`),
  };
}

function readNamedStyles(r: Reader, value: unknown, path: string): NamedStyle[] {
  return r.list(value, path).map((entry, i) => {
    const p = `${path}[${String(i)}]`;
    const n = r.record(entry, p);
    return { name: r.string(n.name, `${p}.name`), settings: readStyle(r, n.settings, `${p}.settings`) };
  });
}

function readFog(r: Reader, value: unknown, path: string): FogSettings {
  const f = r.record(value, path);
  return {
    enabled: r.boolean(f.enabled, `${path}.enabled`),
    start: r.number(f.start, `${path}.start`),
    end: r.number(f.end, `${path}.end`),
    useBackgroundColor: r.boolean(f.useBackgroundColor, `${path}.useBackgroundColor`),
    color: readRgb(r, f.color, `${path}.color`),
  };
}

function readEnvironment(r: Reader, value: unknown, path: string): EnvironmentSettings {
  const e = r.record(value, path);
  return {
    enabled: r.boolean(e.enabled, `${path}.enabled`),
    environmentId: r.string(e.environmentId, `${path}.environmentId`),
    rotationDegrees: r.number(e.rotationDegrees, `${path}.rotationDegrees`),
    exposure: r.number(e.exposure, `${path}.exposure`),
    showAsBackground: r.boolean(e.showAsBackground, `${path}.showAsBackground`),
    useForReflections: r.boolean(e.useForReflections, `${path}.useForReflections`),
  };
}

function readScene(r: Reader, value: unknown, path: string): SceneData {
  const s = r.record(value, path);
  const saves = r.record(s.saves, `${path}.saves`);
  const nullable = <T>(field: unknown, read: () => T): T | null => (field === null ? null : read());
  return {
    id: r.id<SceneId>(s.id, `${path}.id`),
    name: r.string(s.name, `${path}.name`),
    description: r.string(s.description, `${path}.description`),
    includeInAnimation: r.boolean(s.includeInAnimation, `${path}.includeInAnimation`),
    saves: {
      camera: r.boolean(saves.camera, `${path}.saves.camera`),
      visibleTags: r.boolean(saves.visibleTags, `${path}.saves.visibleTags`),
      activeSections: r.boolean(saves.activeSections, `${path}.saves.activeSections`),
      shadows: r.boolean(saves.shadows, `${path}.saves.shadows`),
      axes: r.boolean(saves.axes, `${path}.saves.axes`),
      // Style and fog flags were added later; scenes without them save neither.
      style: saves.style === undefined ? false : r.boolean(saves.style, `${path}.saves.style`),
      fog: saves.fog === undefined ? false : r.boolean(saves.fog, `${path}.saves.fog`),
    },
    style: s.style === undefined || s.style === null ? null : readStyle(r, s.style, `${path}.style`),
    fog: s.fog === undefined || s.fog === null ? null : readFog(r, s.fog, `${path}.fog`),
    camera: nullable(s.camera, (): SceneCamera => {
      const c = r.record(s.camera, `${path}.camera`);
      if (c.projection !== 'perspective' && c.projection !== 'parallel') {
        r.fail(`${path}.camera.projection`, 'expected "perspective" or "parallel"');
      }
      return {
        eye: r.vec3(c.eye, `${path}.camera.eye`),
        target: r.vec3(c.target, `${path}.camera.target`),
        up: r.vec3(c.up, `${path}.camera.up`),
        fovDegrees: r.number(c.fovDegrees, `${path}.camera.fovDegrees`),
        projection: c.projection === 'parallel' ? 'parallel' : 'perspective',
        orthoHalfHeight: r.number(c.orthoHalfHeight, `${path}.camera.orthoHalfHeight`),
      };
    }),
    hiddenTags: nullable(s.hiddenTags, () =>
      r
        .list(s.hiddenTags, `${path}.hiddenTags`)
        .map((id, i) => r.id<TagId>(id, `${path}.hiddenTags[${String(i)}]`)),
    ),
    sections: nullable(s.sections, () =>
      r.list(s.sections, `${path}.sections`).map((entry, i): SceneSectionState => {
        const p = `${path}.sections[${String(i)}]`;
        const e = r.record(entry, p);
        return {
          context: r.id<DefinitionId>(e.context, `${p}.context`),
          plane: r.nullableId<SectionPlaneId>(e.plane, `${p}.plane`),
        };
      }),
    ),
    shadows: nullable(s.shadows, () => readShadows(r, s.shadows, `${path}.shadows`)),
    axes: nullable(s.axes, () => {
      const a = r.record(s.axes, `${path}.axes`);
      return {
        origin: r.vec3(a.origin, `${path}.axes.origin`),
        xAxis: r.vec3(a.xAxis, `${path}.axes.xAxis`),
        yAxis: r.vec3(a.yAxis, `${path}.axes.yAxis`),
      };
    }),
  };
}

/**
 * Builds a document from an untrusted snapshot. Structure, id uniqueness and every kernel invariant are checked,
 * and nothing partial is ever returned.
 */
export function restoreSnapshot(
  input: unknown,
  options: DocumentOptions = {},
  textureBytes: TextureBytesSource = () => undefined,
): Result<ModelDocument> {
  const plan = readLoadPlan(input, textureBytes);
  if (!plan.ok) return err(plan.error);
  const doc = createLoadedDocument(plan.value, options);
  try {
    doc.applyWithoutHistory(plan.value.changes);
  } catch (error) {
    return err(`Invalid document: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = validateDocument(doc);
  if (!report.ok) return err(`Invalid document geometry: ${describeProblems(report.problems)}`);
  return ok(doc);
}

/** A snapshot whose structure and ids were checked, as the changes that build it. Used by restore and repair. */
export interface LoadPlan {
  readonly rootDefinitionId: DefinitionId;
  readonly rootName: string;
  readonly nextId: number;
  /** Changes in dependency order: document settings, assets, materials, tags, then each context's contents. */
  readonly changes: readonly Change[];
}

/** An empty document with the plan's root definition and id counter, ready for the plan's changes. */
export function createLoadedDocument(plan: LoadPlan, options: DocumentOptions = {}): ModelDocument {
  const doc = new ModelDocument(options, { rootDefinitionId: plan.rootDefinitionId, nextId: plan.nextId });
  doc.applyWithoutHistory([
    {
      kind: 'definition.attributes',
      id: plan.rootDefinitionId,
      from: doc.getDefinition(plan.rootDefinitionId).attributes,
      to: { name: plan.rootName, isGroup: false },
    },
  ]);
  return doc;
}

export function describeProblems(problems: readonly ValidationProblem[]): string {
  return problems
    .slice(0, MAX_REPORTED_ERRORS)
    .map((problem) => `${problem.code} (${problem.message})`)
    .join('; ');
}

/** Reads an untrusted snapshot's structure and checks its ids, without building the document. */
export function readLoadPlan(
  input: unknown,
  textureBytes: TextureBytesSource = () => undefined,
): Result<LoadPlan> {
  const r = new Reader();
  const root = r.record(input, '$');
  if (root.format !== SNAPSHOT_FORMAT) return err('This is not a Planar document');
  if (root.version !== SNAPSHOT_VERSION) {
    return err(`Unsupported document version ${String(root.version)} (expected ${String(SNAPSHOT_VERSION)})`);
  }
  const nextId = r.id(root.nextId, '$.nextId');
  const rootDefinitionId = r.id<DefinitionId>(root.rootDefinitionId, '$.rootDefinitionId');
  const materials: MaterialData[] = r
    .list(root.materials, '$.materials')
    .map((entry, i) => readMaterial(r, entry, `$.materials[${String(i)}]`));
  const textures: TextureAssetData[] = (
    root.textures === undefined ? [] : r.list(root.textures, '$.textures')
  ).map((entry, i) => readTextureAsset(r, entry, `$.textures[${String(i)}]`, textureBytes));
  const tags: TagData[] = r.list(root.tags, '$.tags').map((entry, i) => {
    const p = `$.tags[${String(i)}]`;
    const t = r.record(entry, p);
    // Tag colors were added after the first file version; older files get the default color.
    const color = t.color === undefined ? DEFAULT_TAG_COLOR : r.record(t.color, `${p}.color`);
    return {
      id: r.id<TagId>(t.id, `${p}.id`),
      name: r.string(t.name, `${p}.name`),
      visible: r.boolean(t.visible, `${p}.visible`),
      color: {
        r: r.number(color.r, `${p}.color.r`),
        g: r.number(color.g, `${p}.color.g`),
        b: r.number(color.b, `${p}.color.b`),
      },
    };
  });
  const definitions = r
    .list(root.definitions, '$.definitions')
    .map((entry, i) => readDefinition(r, entry, `$.definitions[${String(i)}]`));
  const axesRecord = root.axes === undefined ? null : r.record(root.axes, '$.axes');
  const axes: ModelAxes | null = axesRecord
    ? {
        origin: r.vec3(axesRecord.origin, '$.axes.origin'),
        xAxis: r.vec3(axesRecord.xAxis, '$.axes.xAxis'),
        yAxis: r.vec3(axesRecord.yAxis, '$.axes.yAxis'),
      }
    : null;
  // Documents saved before shadow settings and scenes existed have neither.
  const shadows = root.shadows === undefined ? null : readShadows(r, root.shadows, '$.shadows');
  const scenes =
    root.scenes === undefined
      ? []
      : r.list(root.scenes, '$.scenes').map((entry, i) => readScene(r, entry, `$.scenes[${String(i)}]`));
  // Documents saved before styles, fog and environments existed have none of them.
  const style = root.style === undefined ? null : readStyle(r, root.style, '$.style');
  const styles = root.styles === undefined ? [] : readNamedStyles(r, root.styles, '$.styles');
  const fog = root.fog === undefined ? null : readFog(r, root.fog, '$.fog');
  const environment =
    root.environment === undefined ? null : readEnvironment(r, root.environment, '$.environment');
  if (r.errors.length > 0) return err(`Invalid document structure: ${r.errors.join('; ')}`);
  const settingsChanges: Change[] = [];
  if (style) settingsChanges.push({ kind: 'document.style', from: DEFAULT_STYLE_SETTINGS, to: style });
  if (styles.length > 0) settingsChanges.push({ kind: 'document.styles', from: [], to: styles });
  if (fog) settingsChanges.push({ kind: 'document.fog', from: DEFAULT_FOG_SETTINGS, to: fog });
  if (environment) {
    settingsChanges.push({
      kind: 'document.environment',
      from: DEFAULT_ENVIRONMENT_SETTINGS,
      to: environment,
    });
  }

  const allIds = [
    ...textures.map((t) => t.id),
    ...materials.map((m) => m.id),
    ...tags.map((t) => t.id),
    ...definitions.flatMap((d) => [
      d.id,
      ...d.vertices.map((v) => v.id),
      ...d.edges.map((e) => e.id),
      ...d.faces.map((f) => f.id),
      ...d.curves.map((c) => c.id),
      ...d.instances.map((instance) => instance.id),
      ...d.guides.map((g) => g.id),
      ...(d.annotations ?? []).map((a) => a.id),
      ...(d.sectionPlanes ?? []).map((s) => s.id),
    ]),
    ...scenes.map((scene) => scene.id),
  ];
  const seen = new Set<number>();
  for (const id of allIds) {
    if (seen.has(id)) return err(`Invalid document: id ${String(id)} is used more than once`);
    if (id >= nextId) return err(`Invalid document: id ${String(id)} is not below nextId`);
    seen.add(id);
  }
  const rootDefinition = definitions.find((d) => d.id === rootDefinitionId);
  if (!rootDefinition) return err('Invalid document: the root definition is missing');

  const changes: Change[] = [];
  for (const d of definitions) {
    if (d.id !== rootDefinitionId)
      changes.push({ kind: 'definition.add', data: { id: d.id, name: d.name, isGroup: d.isGroup } });
  }
  if (axes) changes.push({ kind: 'document.axes', from: DEFAULT_MODEL_AXES, to: axes });
  if (shadows) changes.push({ kind: 'document.shadows', from: DEFAULT_SHADOW_SETTINGS, to: shadows });
  changes.push(...settingsChanges);
  scenes.forEach((data, index) => changes.push({ kind: 'scene.add', data, index }));
  for (const data of textures) changes.push({ kind: 'asset.add', data });
  for (const data of materials) changes.push({ kind: 'material.add', data });
  for (const data of tags) changes.push({ kind: 'tag.add', data });
  for (const d of definitions) {
    const context = d.id;
    for (const data of d.vertices) changes.push({ kind: 'vertex.add', context, data });
    for (const data of d.edges) changes.push({ kind: 'edge.add', context, data });
    for (const data of d.faces) changes.push({ kind: 'face.add', context, data });
    for (const data of d.curves) changes.push({ kind: 'curve.add', context, data });
    for (const data of d.guides) changes.push({ kind: 'guide.add', context, data });
    for (const data of d.annotations ?? []) changes.push({ kind: 'annotation.add', context, data });
    for (const data of d.sectionPlanes ?? []) changes.push({ kind: 'section.add', context, data });
  }
  for (const d of definitions) {
    for (const data of d.instances) changes.push({ kind: 'instance.add', context: d.id, data });
  }

  return ok({ rootDefinitionId, rootName: rootDefinition.name, nextId, changes });
}
