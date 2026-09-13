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

import type { Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { decodeDataUri, decodeGlb, encodeGlb, isGlb } from '../mesh/glb';
import type { ImportedMaterialTexture, ImportedScene, ImportedTexture } from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';
import { baseName, isExternalReference, type FileResolver, type InputFile } from './fileSet';
import { composeUvTransforms, TextureCollector } from './textures';
import { sceneFromObject3D } from './threeScene';

/*
 * glTF 2.0 (.gltf and .glb) through three's GLTFLoader. The loader would fetch external buffers and images, so the
 * file is first rewritten into a self-contained GLB: buffers are taken from data URIs, the GLB binary chunk or the
 * picked files; external URLs are ignored with a warning; base color images are read by Planar (from buffer views,
 * data URIs or picked files) and then removed with every other texture, so the loader has nothing to fetch; and
 * everything is merged into one binary chunk.
 */

type Json = Record<string, unknown>;

/** Extensions that only concern textures, which Planar drops before loading. */
const TEXTURE_EXTENSIONS = new Set([
  'KHR_texture_transform',
  'KHR_texture_basisu',
  'EXT_texture_webp',
  'EXT_texture_avif',
]);
const UNSUPPORTED_COMPRESSION = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression']);

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const arrayOf = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const indexOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function stripTextures(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripTextures(item);
    return;
  }
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (key.endsWith('Texture') || TEXTURE_EXTENSIONS.has(key)) Reflect.deleteProperty(value, key);
    else stripTextures(value[key]);
  }
}

export interface PreparedGltf {
  readonly glb: Uint8Array;
  /** Texture file name per glTF material index, where the material had a base color texture. */
  readonly textureNames: ReadonlyMap<number, string>;
  /** Usable base color texture per glTF material index. */
  readonly textures: ReadonlyMap<number, ImportedMaterialTexture>;
  readonly images: readonly ImportedTexture[];
}

/** glTF UVs have their origin at the top-left of the image; Planar's is at the bottom-left. */
const FLIP_V = [1, 0, 0, -1, 0, 1];

/** KHR_texture_transform as a UV transform: translation · rotation · scale, as three's GLTFLoader applies it. */
function khrTextureTransform(value: unknown): number[] {
  if (!isObject(value)) return [1, 0, 0, 1, 0, 0];
  const pair = (item: unknown, fallback: number): [number, number] =>
    Array.isArray(item) && item.length >= 2 && Number.isFinite(item[0]) && Number.isFinite(item[1])
      ? [Number(item[0]), Number(item[1])]
      : [fallback, fallback];
  const [ox, oy] = pair(value.offset, 0);
  const [sx, sy] = pair(value.scale, 1);
  const rotation = typeof value.rotation === 'number' && Number.isFinite(value.rotation) ? value.rotation : 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [cos * sx, -sin * sx, sin * sy, cos * sy, ox, oy];
}

/** Rewrites a .gltf or .glb into a self-contained GLB the loader can read without any request. */
export function prepareGltf(main: InputFile, resolver: FileResolver, warnings: string[]): PreparedGltf {
  let text: string;
  let glbBinary: Uint8Array | null = null;
  try {
    if (isGlb(main.bytes)) {
      const decoded = decodeGlb(main.bytes);
      text = decoded.json;
      glbBinary = decoded.binary;
    } else {
      text = new TextDecoder().decode(main.bytes);
    }
  } catch (error) {
    throw new ImportError(
      `the glTF file is damaged (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError('the glTF file is not valid JSON');
  }
  if (!isObject(parsed) || !isObject(parsed.asset) || !String(parsed.asset.version).startsWith('2')) {
    throw new ImportError('only glTF 2.0 files can be imported');
  }
  const json = parsed;
  const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed.map(String) : []);
  for (const extension of UNSUPPORTED_COMPRESSION) {
    if (used.has(extension))
      throw new ImportError(`the file uses ${extension} compression, which Planar can't read`);
  }

  // Texture names, before images are dropped.
  const images = arrayOf(json.images);
  const textures = arrayOf(json.textures);
  images.forEach((image) => {
    if (typeof image.uri === 'string' && isExternalReference(image.uri)) {
      warnings.push(`Ignored the external texture "${image.uri}": Planar never downloads files`);
    }
  });
  const textureNames = new Map<number, string>();
  const baseColorTextures = new Map<number, { texture: Json; info: Json }>();
  arrayOf(json.materials).forEach((material, index) => {
    const pbr = isObject(material.pbrMetallicRoughness) ? material.pbrMetallicRoughness : {};
    const info = isObject(pbr.baseColorTexture) ? pbr.baseColorTexture : null;
    const texture = textures[indexOf(info?.index) ?? -1];
    if (info && texture) baseColorTextures.set(index, { texture, info });
    const image = images[indexOf(texture?.source) ?? -1];
    if (!image) return;
    const uri = typeof image.uri === 'string' && !image.uri.startsWith('data:') ? baseName(image.uri) : null;
    const name = uri ?? (typeof image.name === 'string' ? image.name : null);
    if (name) textureNames.set(index, name);
  });

  // Resolve every buffer, then merge them into one aligned binary chunk.
  const chunks: (Uint8Array | null)[] = arrayOf(json.buffers).map((buffer, index) => {
    const declared = indexOf(buffer.byteLength);
    let data: Uint8Array | null = null;
    if (typeof buffer.uri === 'string') {
      data = buffer.uri.startsWith('data:')
        ? decodeDataUri(buffer.uri)
        : resolver.resolve(buffer.uri, 'buffer');
      if (buffer.uri.startsWith('data:') && !data)
        warnings.push(`Buffer ${String(index)} has an unreadable data URI`);
    } else if (index === 0) {
      data = glbBinary;
    }
    if (data && declared !== null && data.byteLength < declared) {
      warnings.push(`Buffer ${String(index)} is shorter than declared and was ignored`);
      return null;
    }
    return data;
  });
  const offsets: number[] = [];
  let total = 0;
  for (const chunk of chunks) {
    offsets.push(total);
    if (chunk) total = Math.ceil((total + chunk.byteLength) / 4) * 4;
  }
  const merged = new Uint8Array(total);
  chunks.forEach((chunk, index) => {
    if (chunk) merged.set(chunk, offsets[index] ?? 0);
  });

  // Base color images, before buffer views are rewritten.
  const bufferViews = arrayOf(json.bufferViews);
  const collector = new TextureCollector(resolver, warnings);
  const imageIndex = new Map<number, number | null>();
  const imageFor = (source: number): number | null => {
    const known = imageIndex.get(source);
    if (known !== undefined) return known;
    const image = images[source];
    let result: number | null = null;
    const label =
      typeof image?.name === 'string' && image.name !== '' ? image.name : `Image ${String(source + 1)}`;
    if (image && typeof image.uri === 'string') {
      // External URLs were warned about above; the resolver never fetches.
      if (!isExternalReference(image.uri)) {
        const mime = /^data:([^;,]*)/.exec(image.uri)?.[1] ?? '';
        if (mime !== '' && mime !== 'image/png' && mime !== 'image/jpeg') {
          collector.skip(label, `${mime} images are not supported`);
        } else {
          result = collector.fromReference(image.uri);
        }
      }
    } else if (image) {
      const view = bufferViews[indexOf(image.bufferView) ?? -1];
      const buffer = indexOf(view?.buffer);
      const chunk = buffer === null ? null : chunks[buffer];
      const offset = indexOf(view?.byteOffset ?? 0);
      const length = indexOf(view?.byteLength);
      if (view && chunk && offset !== null && length !== null && offset + length <= chunk.byteLength) {
        const mime = typeof image.mimeType === 'string' ? image.mimeType : '';
        const bytes = chunk.subarray(offset, offset + length);
        const name = `${label}${mime === 'image/jpeg' ? '.jpg' : mime === 'image/png' ? '.png' : ''}`;
        result = collector.fromBytes(name, bytes);
      } else {
        collector.skip(label, 'its data was not among the selected files');
      }
    }
    imageIndex.set(source, result);
    return result;
  };
  const materialTextures = new Map<number, ImportedMaterialTexture>();
  for (const [material, { texture, info }] of baseColorTextures) {
    const source = indexOf(texture.source);
    const extensions = isObject(texture.extensions) ? texture.extensions : {};
    if (source === null) {
      const other = ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif'].find(
        (name) => name in extensions,
      );
      const label = textureNames.get(material) ?? `Texture ${String(indexOf(info.index) ?? 0)}`;
      collector.skip(label, other ? `${other} images are not supported` : 'the texture has no image');
      continue;
    }
    const image = imageFor(source);
    if (image === null) continue;
    const texCoord = indexOf(info.texCoord) ?? 0;
    if (texCoord !== 0) {
      warnings.push(
        `Material ${String(material + 1)} maps its texture with a second UV set, which Planar reads as the first`,
      );
    }
    const infoExtensions = isObject(info.extensions) ? info.extensions : {};
    const transform = composeUvTransforms(FLIP_V, khrTextureTransform(infoExtensions.KHR_texture_transform));
    materialTextures.set(material, { image, uvTransform: transform });
  }
  const collectedImages = collector.finish();

  const validViews = new Set<number>();
  arrayOf(json.bufferViews).forEach((view, index) => {
    const buffer = indexOf(view.buffer);
    const chunk = buffer === null ? null : chunks[buffer];
    const offset = indexOf(view.byteOffset ?? 0);
    const length = indexOf(view.byteLength);
    if (!chunk || buffer === null || offset === null || length === null || offset + length > chunk.byteLength)
      return;
    view.buffer = 0;
    view.byteOffset = offset + (offsets[buffer] ?? 0);
    delete view.extensions;
    validViews.add(index);
  });
  const validAccessors = new Set<number>();
  arrayOf(json.accessors).forEach((accessor, index) => {
    const view = accessor.bufferView === undefined ? null : indexOf(accessor.bufferView);
    if (accessor.bufferView !== undefined && (view === null || !validViews.has(view))) return;
    if (isObject(accessor.sparse)) delete accessor.sparse;
    validAccessors.add(index);
  });
  let droppedPrimitives = 0;
  for (const mesh of arrayOf(json.meshes)) {
    const primitives = arrayOf(mesh.primitives).filter((primitive) => {
      delete primitive.targets;
      if (isObject(primitive.extensions)) delete primitive.extensions.KHR_draco_mesh_compression;
      const attributes = isObject(primitive.attributes) ? Object.values(primitive.attributes) : [];
      const accessors = [...attributes, ...(primitive.indices === undefined ? [] : [primitive.indices])];
      const ok = accessors.every((accessor) => {
        const accessorIndex = indexOf(accessor);
        return accessorIndex !== null && validAccessors.has(accessorIndex);
      });
      if (!ok) droppedPrimitives++;
      return ok;
    });
    mesh.primitives = primitives;
    delete mesh.weights;
  }
  if (droppedPrimitives > 0) {
    warnings.push(
      `Skipped ${String(droppedPrimitives)} mesh parts whose data was not among the selected files`,
    );
  }

  delete json.images;
  delete json.textures;
  delete json.samplers;
  delete json.animations;
  delete json.skins;
  for (const node of arrayOf(json.nodes)) {
    delete node.skin;
    delete node.weights;
  }
  stripTextures(json.materials);
  const keep = (list: unknown): string[] =>
    Array.isArray(list) ? list.map(String).filter((name) => !TEXTURE_EXTENSIONS.has(name)) : [];
  json.extensionsUsed = keep(json.extensionsUsed);
  json.extensionsRequired = keep(json.extensionsRequired);
  if (total > 0) json.buffers = [{ byteLength: total }];
  else delete json.buffers;
  return {
    glb: encodeGlb(json, total > 0 ? merged : null),
    textureNames,
    textures: materialTextures,
    images: collectedImages,
  };
}

export async function parseGltf(
  main: InputFile,
  resolver: FileResolver,
  limits: ImportLimits,
  warnings: string[],
): Promise<ImportedScene> {
  const prepared = prepareGltf(main, resolver, warnings);
  const loader = new GLTFLoader();
  const buffer = prepared.glb.buffer.slice(
    prepared.glb.byteOffset,
    prepared.glb.byteOffset + prepared.glb.byteLength,
  ) as ArrayBuffer;
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, '', resolve, (error) => {
      reject(new ImportError(`the glTF file could not be read (${error.message})`));
    });
  });
  const materialIndex = (material: Material): number | undefined =>
    gltf.parser.associations.get(material)?.materials;
  return sceneFromObject3D(
    gltf.scene,
    {
      limits,
      textureNameOf: (material) => prepared.textureNames.get(materialIndex(material) ?? -1) ?? null,
      textureOf: (material) => prepared.textures.get(materialIndex(material) ?? -1),
      textures: () => prepared.images,
      isMeshPart: (object) => gltf.parser.associations.get(object)?.primitives !== undefined,
      meshNameOf: (mesh) => {
        const index = gltf.parser.associations.get(mesh)?.meshes;
        const definitions = (gltf.parser.json as { meshes?: { name?: unknown }[] }).meshes;
        const name = index === undefined ? undefined : definitions?.[index]?.name;
        return typeof name === 'string' ? name : null;
      },
    },
    warnings,
  );
}
