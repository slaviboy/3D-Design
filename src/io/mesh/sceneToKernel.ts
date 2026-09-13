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

import type { AssetId, DefinitionId, InstanceId, MaterialId, TagId } from '../../kernel/ids';
import { IDENTITY, invertAffine, transformPoint } from '../../kernel/math/mat4';
import { cross, length, normalize, sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import { sha256Hex, textureBytesProblem } from '../../kernel/model/assets';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import {
  addDefinition,
  addInstance,
  addMaterial,
  addTextureAsset,
  removeDefinition,
} from '../../kernel/model/mutations';
import {
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type FaceAttributes,
  type MaterialTexture,
  type TexturePlacement,
} from '../../kernel/model/types';
import { uniqueDefinitionName } from '../../kernel/ops/hierarchy';
import { insertTriangleMesh, type FaceProvenance, type TriangleMesh } from '../../kernel/ops/solids/mesh';
import { EPS_AREA } from '../../kernel/tolerance';
import { convertTransform, importConversion, isIdentity, type Conversion } from './axes';
import { validateImportedScene, type ImportedMesh, type ImportedScene } from './importedScene';
import { DEFAULT_IMPORT_LIMITS, ImportError, type ImportLimits } from './limits';
import { fitTexturePlacement, PLACEMENT_FIT_TOLERANCE, placementForTile } from './texturePlacement';

export interface SceneImportOptions {
  /** Name of the group or component that holds the import (usually the file name without extension). */
  readonly name: string;
  /** Meters per file unit. */
  readonly unitMeters: number;
  /** Convert Y-up file coordinates to Planar's Z-up. */
  readonly swapYUpToZUp: boolean;
  /** Regroup adjacent coplanar triangles with the same material into polygons. */
  readonly mergeCoplanar: boolean;
  /** Wrap the import in a group or in a reusable component. */
  readonly as: 'group' | 'component';
  readonly limits?: Pick<ImportLimits, 'maxTriangles' | 'maxNodes'>;
  /** Tag of the new group or component instance. */
  readonly tagId?: TagId | null;
}

export interface SceneImportSummary {
  /** The instance placed at the origin of the context, holding everything imported. */
  readonly instance: InstanceId;
  readonly definition: DefinitionId;
  readonly faces: number;
  /** Nested groups created for the file's node hierarchy (the outer group not counted). */
  readonly groups: number;
  /** Component definitions created for meshes the file reuses. */
  readonly components: number;
  readonly materials: number;
  /** Texture images used by the imported materials (added, or reused when the model already had the image). */
  readonly textures: number;
  readonly triangles: number;
  /** Triangles dropped because they had repeated corners or no area. */
  readonly degenerateTriangles: number;
  /** Nodes that were skipped, with the reason, and texture mapping notes. */
  readonly warnings: readonly string[];
}

/** Per-triangle texture fit states. */
const FIT_NONE = 0;
const FIT_EXACT = 1;
const FIT_APPROXIMATE = 2;
const FIT_UNUSABLE = 3;
const FIT_NO_UVS = 4;

interface MeshFits {
  /** Converted positions (meters, Z-up). */
  readonly positions: Float64Array;
  /** Per triangle, one of the FIT_* states. */
  readonly state: Uint8Array;
  /** Per triangle: offsetX, offsetY, rotation, scaleX, scaleY, for a 1 m × 1 m tile. */
  readonly placements: Float64Array;
}

/** Tile sizes are at least this; the per-face placement scale keeps the mapping. */
const MIN_TILE_SIZE = 0.001;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] ?? null)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function point(positions: Float64Array, index: number): Vec3 {
  return vec3(positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0);
}

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${String(count)} ${count === 1 ? singular : pluralForm}`;

/**
 * Inserts an imported scene into `context` as one new group (or component) at the context origin, in one undoable
 * transaction. The node hierarchy becomes nested groups; a mesh drawn by several nodes becomes a component with one
 * instance per use. Units and axes are baked into the geometry so kernel tolerances stay in meters. Textured
 * materials get a texture asset per distinct image, and each textured face gets the planar placement that best
 * reproduces its texture coordinates (IMPORT_EXPORT.md, "Textures"). On any error the transaction is rolled back
 * and the model is left unchanged.
 */
export function insertImportedScene(
  doc: ModelDocument,
  context: DefinitionId,
  scene: ImportedScene,
  options: SceneImportOptions,
): SceneImportSummary {
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  validateImportedScene(scene, limits);
  if (scene.nodes.length > limits.maxNodes) {
    throw new ImportError(
      `the model has ${String(scene.nodes.length)} nodes, more than the import limit of ${String(limits.maxNodes)}`,
    );
  }
  let convert: Conversion;
  try {
    convert = importConversion(options.unitMeters, options.swapYUpToZUp);
  } catch (error) {
    throw new ImportError(error instanceof Error ? error.message : String(error));
  }

  // How many nodes draw each set of meshes (a glTF mesh with several primitives is several meshes drawn together),
  // to find the ones to share as components.
  const setKey = (meshes: readonly number[]): string => meshes.join(',');
  const uses = new Map<string, number>();
  const visit = (node: number): void => {
    const view = scene.nodes[node];
    if (!view) return;
    if (view.meshes.length > 0) uses.set(setKey(view.meshes), (uses.get(setKey(view.meshes)) ?? 0) + 1);
    for (const child of view.children) visit(child);
  };
  const shared = (meshes: readonly number[]): boolean =>
    meshes.length > 0 && (uses.get(setKey(meshes)) ?? 0) > 1;
  for (const root of scene.roots) visit(root);

  // Texture fits, before anything is added: one placement per textured triangle in converted coordinates. A
  // textured material's tile size is the median fitted size of one UV unit, so typical faces get a scale near 1.
  const textures = scene.textures ?? [];
  const skippedImages: string[] = [];
  const usableImage = textures.map((texture) => {
    const problem = textureBytesProblem(texture.bytes);
    if (problem !== null) skippedImages.push(`${texture.name} (${problem.replace(/^the image /, '')})`);
    return problem === null;
  });
  const isTextured = (material: number): boolean => {
    const texture = scene.materials[material]?.texture;
    return texture !== undefined && usableImage[texture.image] === true;
  };
  const meshFits: MeshFits[] = [];
  const tileSamples = new Map<number, { widths: number[]; heights: number[] }>();
  for (const mesh of scene.meshes) {
    const vertexCount = mesh.positions.length / 3;
    const positions = new Float64Array(mesh.positions.length);
    for (let i = 0; i < vertexCount; i++) {
      const p = transformPoint(convert.matrix, point(mesh.positions, i));
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }
    const triangleTotal = mesh.materials.length;
    const state = new Uint8Array(triangleTotal);
    const placements = new Float64Array(triangleTotal * 5);
    for (let t = 0; t < triangleTotal; t++) {
      const material = mesh.materials[t] ?? -1;
      if (!isTextured(material)) continue;
      const [ta = 1, tb = 0, tc = 0, td = 1, te = 0, tf = 0] =
        scene.materials[material]?.texture?.uvTransform ?? [];
      const corners = [0, 1, 2].map((k) => mesh.indices[t * 3 + k] ?? 0);
      const uvs = corners.map((corner) => {
        const u = mesh.uvs?.[corner * 2] ?? Number.NaN;
        const v = mesh.uvs?.[corner * 2 + 1] ?? Number.NaN;
        return { u: ta * u + tc * v + te, v: tb * u + td * v + tf };
      });
      if (!uvs.every((uv) => Number.isFinite(uv.u) && Number.isFinite(uv.v))) {
        state[t] = FIT_NO_UVS;
        continue;
      }
      const points = corners.map((corner) => point(positions, corner));
      const [pa = vec3(0, 0, 0), pb = pa, pc = pa] = points;
      const normal = normalize(cross(sub(pb, pa), sub(pc, pa)));
      if (!normal) continue; // degenerate; dropped below
      const fit = fitTexturePlacement(points, uvs, normal);
      if (!fit) {
        state[t] = FIT_UNUSABLE;
        continue;
      }
      state[t] = fit.error > PLACEMENT_FIT_TOLERANCE ? FIT_APPROXIMATE : FIT_EXACT;
      const { offsetX, offsetY, rotation, scaleX, scaleY } = fit.placement;
      placements.set([offsetX, offsetY, rotation, scaleX, scaleY], t * 5);
      const samples = tileSamples.get(material) ?? { widths: [], heights: [] };
      samples.widths.push(Math.abs(scaleX));
      samples.heights.push(Math.abs(scaleY));
      tileSamples.set(material, samples);
    }
    meshFits.push({ positions, state, placements });
  }

  return doc.transact('Import', () => {
    const materialIds = new Map<number, MaterialId>();
    const materialTextures = new Map<number, MaterialTexture>();
    const assetIds = new Map<number, AssetId>();
    const usedAssets = new Set<AssetId>();

    /** The asset for an image: an existing one with the same bytes, or a new one. */
    const assetFor = (image: number): AssetId | null => {
      const known = assetIds.get(image);
      if (known !== undefined) return known;
      const texture = textures[image];
      if (!texture || usableImage[image] !== true) return null;
      const digest = sha256Hex(texture.bytes);
      const existing = [...doc.assets()].find(
        (asset) => asset.bytes.byteLength === texture.bytes.byteLength && sha256Hex(asset.bytes) === digest,
      );
      const id = existing?.id ?? addTextureAsset(doc, texture.name, texture.bytes);
      assetIds.set(image, id);
      return id;
    };

    const materialFor = (index: number): MaterialId | null => {
      if (index < 0) return null;
      const existing = materialIds.get(index);
      if (existing !== undefined) return existing;
      const source = scene.materials[index];
      if (!source) return null;
      let texture: MaterialTexture | null = null;
      if (source.texture && isTextured(index)) {
        const assetId = assetFor(source.texture.image);
        const asset = assetId === null ? undefined : doc.asset(assetId);
        if (assetId !== null && asset) {
          const samples = tileSamples.get(index);
          const width = median(samples?.widths ?? []) ?? 1;
          const height = median(samples?.heights ?? []) ?? (width * asset.height) / Math.max(1, asset.width);
          texture = {
            assetId,
            width: Math.max(MIN_TILE_SIZE, width),
            height: Math.max(MIN_TILE_SIZE, height),
          };
          usedAssets.add(assetId);
          materialTextures.set(index, texture);
        }
      }
      const reuse = [...doc.materials()].find(
        (material) =>
          material.name === source.name &&
          material.opacity === source.opacity &&
          material.color.r === source.color.r &&
          material.color.g === source.color.g &&
          material.color.b === source.color.b &&
          (material.texture === null || texture === null
            ? material.texture === texture
            : material.texture.assetId === texture.assetId &&
              material.texture.width === texture.width &&
              material.texture.height === texture.height),
      );
      const id =
        reuse?.id ??
        addMaterial(doc, {
          name: source.name === '' ? `Material ${String(index + 1)}` : source.name,
          color: source.color,
          opacity: Math.min(1, Math.max(0, source.opacity)),
          texture,
        });
      materialIds.set(index, id);
      return id;
    };

    let faces = 0;
    let groups = 0;
    let triangles = 0;
    let degenerate = 0;
    let approximate = 0;
    let unusable = 0;
    let withoutUvs = 0;
    const components = new Map<string, DefinitionId | null>();
    const countedFits = new Set<number>();

    const insertMesh = (definition: DefinitionId, meshIndex: number): boolean => {
      const mesh: ImportedMesh | undefined = scene.meshes[meshIndex];
      const fits = meshFits[meshIndex];
      if (!mesh || !fits) return false;
      const { positions } = fits;
      // A mesh inserted several times (by nodes that don't share it as a component) is counted once in warnings.
      const countFits = !countedFits.has(meshIndex);
      countedFits.add(meshIndex);
      const indices: number[] = [];
      const keys: number[] = [];
      const provenance = new Map<number, FaceProvenance>();
      const keyOf = new Map<string, number>();
      for (let t = 0; t < mesh.materials.length; t++) {
        const a = mesh.indices[t * 3] ?? 0;
        const b = mesh.indices[t * 3 + 1] ?? 0;
        const c = mesh.indices[t * 3 + 2] ?? 0;
        const pa = point(positions, a);
        const area = length(cross(sub(point(positions, b), pa), sub(point(positions, c), pa))) / 2;
        if (a === b || b === c || a === c || !(area > EPS_AREA)) {
          degenerate++;
          continue;
        }
        const material = mesh.materials[t] ?? -1;
        const id = materialFor(material);
        const tile = materialTextures.get(material);
        const state = fits.state[t] ?? FIT_NONE;
        let placement: TexturePlacement | null = null;
        if (tile) {
          if (state === FIT_EXACT || state === FIT_APPROXIMATE) {
            const base = t * 5;
            placement = placementForTile(
              {
                offsetX: fits.placements[base] ?? 0,
                offsetY: fits.placements[base + 1] ?? 0,
                rotation: fits.placements[base + 2] ?? 0,
                scaleX: fits.placements[base + 3] ?? 1,
                scaleY: fits.placements[base + 4] ?? 1,
              },
              tile.width,
              tile.height,
            );
          }
          if (countFits) {
            if (state === FIT_APPROXIMATE) approximate++;
            else if (state === FIT_UNUSABLE) unusable++;
            else if (state === FIT_NO_UVS) withoutUvs++;
          }
        }
        // Triangles share a key (and one attributes object) when material and rounded placement match. The mesh
        // builder compares placements with a tolerance before merging coplanar triangles, so textures don't smear.
        const keyText =
          placement === null
            ? String(material)
            : [
                material,
                placement.offsetX,
                placement.offsetY,
                placement.rotation,
                placement.scaleX,
                placement.scaleY,
              ]
                .map((value) => value.toPrecision(10))
                .join('|');
        let key = keyOf.get(keyText);
        if (key === undefined) {
          key = keyOf.size + 1;
          keyOf.set(keyText, key);
          const attributes: FaceAttributes = {
            ...DEFAULT_FACE_ATTRIBUTES,
            frontMaterialId: id,
            backMaterialId: id,
            frontTexturePlacement: placement,
            backTexturePlacement: placement,
          };
          provenance.set(key, { attributes });
        }
        indices.push(a, b, c);
        keys.push(key);
      }
      triangles += keys.length;
      if (keys.length === 0) return false;
      const triangleMesh: TriangleMesh = {
        positions,
        indices: Uint32Array.from(indices),
        faceIds: Uint32Array.from(keys),
      };
      const inserted = insertTriangleMesh(doc, definition, triangleMesh, provenance, {
        mergeCoplanar: options.mergeCoplanar,
      });
      faces += inserted.faces.length;
      return inserted.faces.length > 0;
    };

    const componentFor = (meshes: readonly number[]): DefinitionId | null => {
      const key = setKey(meshes);
      if (components.has(key)) return components.get(key) ?? null;
      const first = scene.meshes[meshes[0] ?? -1];
      const baseName = first?.name.trim() ?? '';
      let definition: DefinitionId | null = addDefinition(doc, {
        name: uniqueDefinitionName(doc, baseName === '' ? 'Mesh' : baseName),
        isGroup: false,
      });
      let filled = false;
      for (const meshIndex of meshes) {
        if (insertMesh(definition, meshIndex)) filled = true;
      }
      if (!filled) {
        removeDefinition(doc, definition);
        definition = null;
      }
      components.set(key, definition);
      return definition;
    };

    /** Fills a definition with a node's meshes and children. Returns whether anything was added. */
    const fillNode = (definition: DefinitionId, nodeIndex: number, warnings: string[]): boolean => {
      const node = scene.nodes[nodeIndex];
      if (!node) return false;
      let filled = false;
      if (shared(node.meshes)) {
        const component = componentFor(node.meshes);
        if (component !== null) {
          addInstance(doc, definition, component, IDENTITY);
          filled = true;
        }
      } else {
        for (const meshIndex of node.meshes) {
          if (insertMesh(definition, meshIndex)) filled = true;
        }
      }
      for (const child of node.children) {
        if (placeNode(definition, child, warnings)) filled = true;
      }
      return filled;
    };

    /** Adds a node as a nested group of `parent`. */
    const placeNode = (parent: DefinitionId, nodeIndex: number, warnings: string[]): boolean => {
      const node = scene.nodes[nodeIndex];
      if (!node) return false;
      const transform = convertTransform(convert, node.transform);
      if (!invertAffine(transform)) {
        warnings.push(`Skipped "${node.name}" because its transform flattens it`);
        return false;
      }
      // A node that draws only shared meshes and has no children is placed as the component instance itself.
      if (node.children.length === 0 && shared(node.meshes)) {
        const component = componentFor(node.meshes);
        if (component === null) return false;
        addInstance(doc, parent, component, transform);
        return true;
      }
      const definition = addDefinition(doc, {
        name: node.name.trim() === '' ? 'Group' : node.name.trim(),
        isGroup: true,
      });
      if (!fillNode(definition, nodeIndex, warnings)) {
        removeDefinition(doc, definition);
        return false;
      }
      addInstance(doc, parent, definition, transform);
      groups++;
      return true;
    };

    const warnings: string[] = [];
    const name = options.name.trim() === '' ? 'Import' : options.name.trim();
    const top = addDefinition(doc, {
      name: options.as === 'group' ? name : uniqueDefinitionName(doc, name),
      isGroup: options.as === 'group',
    });
    let filled = false;
    const [onlyRoot] = scene.roots;
    const onlyRootNode = onlyRoot === undefined ? undefined : scene.nodes[onlyRoot];
    if (
      scene.roots.length === 1 &&
      onlyRoot !== undefined &&
      onlyRootNode &&
      isIdentity(onlyRootNode.transform)
    ) {
      // A single root at the file origin needs no group of its own.
      filled = fillNode(top, onlyRoot, warnings);
    } else {
      for (const root of scene.roots) if (placeNode(top, root, warnings)) filled = true;
    }
    if (!filled || faces === 0) {
      throw new ImportError(
        degenerate > 0
          ? `the file has no usable faces (${String(degenerate)} degenerate triangles were dropped)`
          : 'the file has no faces to import',
      );
    }
    if (skippedImages.length > 0) {
      warnings.push(
        `Skipped ${plural(skippedImages.length, 'texture image', 'texture images')} that can't be used: ${skippedImages.join(', ')}`,
      );
    }
    if (approximate + unusable > 0) {
      warnings.push(
        `${plural(approximate + unusable, 'textured triangle has', 'textured triangles have')} texture coordinates that a planar placement can't reproduce exactly (stretched, skewed, wrapped or collapsed mapping); the closest fit is used${unusable > 0 ? ', or the default projection where the coordinates collapse' : ''}`,
      );
    }
    if (withoutUvs > 0) {
      warnings.push(
        `${plural(withoutUvs, 'textured triangle has', 'textured triangles have')} no texture coordinates and ${withoutUvs === 1 ? 'uses' : 'use'} the default projection`,
      );
    }
    const instance = addInstance(doc, context, top, IDENTITY, {
      ...DEFAULT_INSTANCE_ATTRIBUTES,
      tagId: options.tagId ?? null,
    });
    return {
      instance,
      definition: top,
      faces,
      groups,
      components: [...components.values()].filter((id) => id !== null).length,
      materials: new Set(materialIds.values()).size,
      textures: usedAssets.size,
      triangles,
      degenerateTriangles: degenerate,
      warnings,
    };
  });
}
