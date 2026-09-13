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

import {
  IDENTITY,
  multiply,
  rotationAxisAngle,
  scaling,
  translation,
  type Mat4,
} from '../../kernel/math/mat4';
import { normalize, vec3 } from '../../kernel/math/vec3';
import { rgbFromSrgb } from '../mesh/color';
import type { ImportedMaterial, ImportedMesh, ImportedNode, ImportedScene } from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';
import { baseName, isExternalReference, type FileResolver, type InputFile } from './fileSet';
import { TextureCollector } from './textures';
import { child, childrenNamed, parseNumbers, parseXml, type XmlElement } from './xml';

/*
 * COLLADA 1.4/1.5 reader. three's ColladaLoader needs DOMParser, which workers don't have, so Planar reads the
 * subset it needs itself: geometry (triangles, polylist, polygons, tristrips, trifans), materials with diffuse color
 * and transparency, the node hierarchy with matrix/translate/rotate/scale transforms, instance_geometry,
 * instance_controller (bind pose) and instance_node (library nodes shared by several nodes), and the asset unit and
 * up axis. Diffuse textures are read from `<image>` elements through the picked files, with each primitive's first
 * TEXCOORD input as the vertex UVs.
 */

const MAX_XML_ELEMENTS = 5_000_000;
const MAX_DEPTH = 128;

export function parseDae(
  main: InputFile,
  resolver: FileResolver,
  limits: ImportLimits,
  warnings: string[],
): ImportedScene {
  const root = parseXml(new TextDecoder().decode(main.bytes), { maxElements: MAX_XML_ELEMENTS });
  if (root.name !== 'COLLADA') throw new ImportError('this is not a COLLADA file');

  const ids = new Map<string, XmlElement>();
  const stack = [root];
  for (let element = stack.pop(); element; element = stack.pop()) {
    const id = element.attributes.id;
    if (id !== undefined && !ids.has(id)) ids.set(id, element);
    stack.push(...element.children);
  }
  const lookup = (url: string | undefined, what: string): XmlElement | undefined => {
    if (url === undefined) return undefined;
    if (url.startsWith('#')) return ids.get(url.slice(1));
    if (isExternalReference(url) || url.includes('#'))
      warnings.push(`Ignored the external ${what} reference "${url}"`);
    return undefined;
  };

  const asset = child(root, 'asset');
  const meter = Number(child(asset, 'unit')?.attributes.meter ?? '1');
  const upText = (child(asset, 'up_axis')?.text ?? 'Y_UP').trim();
  if (upText === 'X_UP') warnings.push('The file is X-up, which is imported as Z-up');

  // -------------------------------------------------------------------------------- materials
  const materials: ImportedMaterial[] = [];
  const materialIndex = new Map<string, number>();
  const collector = new TextureCollector(resolver, warnings);

  const imagePath = (sampler: string): string | null => {
    // Effects name samplers by sid (a newparam), older exporters by id.
    let element = findParam(root, sampler) ?? ids.get(sampler);
    // COLLADA 1.4 profile_COMMON: newparam sampler2D → newparam surface → image; without params, the image itself.
    for (let hops = 0; element && element.name !== 'image' && hops < 4; hops++) {
      const source = child(child(element, 'sampler2D'), 'source')?.text.trim();
      const initFrom = child(child(element, 'surface'), 'init_from')?.text.trim();
      const next = source ?? initFrom;
      element = next === undefined ? undefined : (findParam(root, next) ?? ids.get(next));
    }
    if (element?.name !== 'image') return null;
    const init = child(element, 'init_from');
    const path = (child(init, 'ref')?.text ?? init?.text ?? '').trim();
    return path === '' ? null : path;
  };

  const materialFor = (target: string | undefined): number => {
    if (target === undefined) return -1;
    const key = target.startsWith('#') ? target.slice(1) : target;
    const known = materialIndex.get(key);
    if (known !== undefined) return known;
    const material = ids.get(key);
    let index = -1;
    if (material?.name === 'material') {
      const effect = lookup(child(material, 'instance_effect')?.attributes.url, 'effect');
      const common = child(effect, 'profile_COMMON');
      const technique = child(common, 'technique');
      const shading = technique?.children.find((element) =>
        ['constant', 'lambert', 'phong', 'blinn'].includes(element.name),
      );
      const colorSource = child(shading, 'diffuse') ?? child(shading, 'emission');
      const values = parseNumbers(child(colorSource, 'color')?.text ?? '');
      const texture = child(colorSource, 'texture')?.attributes.texture;
      const path = texture === undefined ? null : imagePath(texture);
      const name = path === null ? null : baseName(path);
      const image = path === null ? null : collector.fromReference(path);
      const color =
        values.length >= 3 && values.slice(0, 3).every(Number.isFinite)
          ? rgbFromSrgb(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0)
          : { r: 0.8, g: 0.8, b: 0.8 };
      let opacity = values.length >= 4 && Number.isFinite(values[3]) ? (values[3] ?? 1) : 1;
      const transparent = child(shading, 'transparent');
      const transparency = Number(child(child(shading, 'transparency'), 'float')?.text ?? 'NaN');
      if (transparent && Number.isFinite(transparency)) {
        opacity = transparent.attributes.opaque === 'RGB_ZERO' ? 1 - transparency : opacity * transparency;
      }
      const reference = collector.reference(image);
      index =
        materials.push({
          name: material.attributes.name ?? key,
          color,
          opacity: Math.min(1, Math.max(0, opacity)),
          textureName: name,
          ...(reference ? { texture: reference } : {}),
        }) - 1;
    }
    materialIndex.set(key, index);
    return index;
  };

  // -------------------------------------------------------------------------------- geometry
  const meshes: ImportedMesh[] = [];
  const meshIndex = new Map<string, number | null>();
  let triangleTotal = 0;
  let skippedPrimitives = 0;

  const floatSource = (id: string | undefined): { values: number[]; stride: number } | null => {
    const source = id === undefined ? undefined : lookup(id, 'source');
    if (!source) return null;
    const array = child(source, 'float_array');
    const accessor = child(child(source, 'technique_common'), 'accessor');
    const stride = Number(accessor?.attributes.stride ?? '1');
    return {
      values: parseNumbers(array?.text ?? ''),
      stride: Number.isInteger(stride) && stride > 0 ? stride : 1,
    };
  };

  const meshFor = (geometryUrl: string | undefined, bindings: ReadonlyMap<string, string>): number | null => {
    const geometry = lookup(geometryUrl, 'geometry');
    if (!geometry) return null;
    const key = `${geometry.attributes.id ?? ''}|${[...bindings]
      .map(([s, t]) => `${s}=${t}`)
      .sort()
      .join(',')}`;
    if (meshIndex.has(key)) return meshIndex.get(key) ?? null;
    const mesh = child(geometry, 'mesh');
    let result: number | null = null;
    if (mesh) {
      const vertices = child(mesh, 'vertices');
      const positionInput = childrenNamed(vertices, 'input').find(
        (input) => input.attributes.semantic === 'POSITION',
      );
      const source = floatSource(positionInput?.attributes.source);
      if (!source || source.stride < 3) throw new ImportError('a COLLADA geometry has no usable positions');
      const vertexCount = Math.floor(source.values.length / source.stride);
      const sourcePositions = new Float64Array(vertexCount * 3);
      for (let v = 0; v < vertexCount; v++) {
        for (let k = 0; k < 3; k++)
          sourcePositions[v * 3 + k] = source.values[v * source.stride + k] ?? Number.NaN;
      }
      // With texture coordinates, each distinct (position, UV) pair becomes an output vertex.
      const textured = mesh.children.some((primitive) =>
        childrenNamed(primitive, 'input').some((input) => input.attributes.semantic === 'TEXCOORD'),
      );
      const outPositions: number[] = [];
      const outUvs: number[] = [];
      const cornerIndex = new Map<number, number>();
      const outputVertex = (
        vertex: number,
        uvSource: { values: number[]; stride: number } | null,
        uv: number | undefined,
      ): number => {
        const uvCount = uvSource ? Math.floor(uvSource.values.length / uvSource.stride) : 0;
        const uvIndex =
          uvSource && uv !== undefined && Number.isInteger(uv) && uv >= 0 && uv < uvCount ? uv : -1;
        const key = vertex + (uvIndex + 1) * vertexCount;
        let index = cornerIndex.get(key);
        if (index === undefined) {
          index = outPositions.length / 3;
          outPositions.push(
            sourcePositions[vertex * 3] ?? 0,
            sourcePositions[vertex * 3 + 1] ?? 0,
            sourcePositions[vertex * 3 + 2] ?? 0,
          );
          if (uvSource && uvIndex >= 0) {
            outUvs.push(
              uvSource.values[uvIndex * uvSource.stride] ?? Number.NaN,
              uvSource.values[uvIndex * uvSource.stride + 1] ?? Number.NaN,
            );
          } else {
            outUvs.push(Number.NaN, Number.NaN);
          }
          cornerIndex.set(key, index);
        }
        return index;
      };
      const indices: number[] = [];
      const perTriangle: number[] = [];
      const vertexAt = (value: number | undefined): number => {
        if (value === undefined || !Number.isInteger(value) || value < 0 || value >= vertexCount) {
          throw new ImportError('a COLLADA geometry refers to a vertex that does not exist');
        }
        return value;
      };
      for (const primitive of mesh.children) {
        const kind = primitive.name;
        if (!['triangles', 'polylist', 'polygons', 'tristrips', 'trifans'].includes(kind)) {
          if (!['source', 'vertices', 'extra'].includes(kind)) skippedPrimitives++;
          continue;
        }
        const inputs = childrenNamed(primitive, 'input');
        const stride = Math.max(1, ...inputs.map((input) => Number(input.attributes.offset ?? '0') + 1));
        const vertexInput = inputs.find((input) => input.attributes.semantic === 'VERTEX');
        if (!vertexInput) continue;
        const vertexOffset = Number(vertexInput.attributes.offset ?? '0');
        const texcoordInputs = inputs
          .filter((input) => input.attributes.semantic === 'TEXCOORD')
          .sort((a, b) => Number(a.attributes.set ?? '0') - Number(b.attributes.set ?? '0'));
        const texcoordInput = texcoordInputs[0];
        const uvOffset = Number(texcoordInput?.attributes.offset ?? '0');
        const uvSource = texcoordInput ? floatSource(texcoordInput.attributes.source) : null;
        const usableUvs = uvSource && uvSource.stride >= 2 ? uvSource : null;
        const symbol = primitive.attributes.material;
        const material = materialFor(symbol === undefined ? undefined : (bindings.get(symbol) ?? symbol));
        const pushTriangle = (a: number, b: number, c: number): void => {
          indices.push(a, b, c);
          perTriangle.push(material);
          if (++triangleTotal > limits.maxTriangles) {
            throw new ImportError(
              `the model has more triangles than the import limit of ${limits.maxTriangles.toLocaleString('en-US')}`,
            );
          }
        };
        const corners = (p: readonly number[]): number[] => {
          const out: number[] = [];
          for (let i = 0; i + stride <= p.length; i += stride) {
            const vertex = vertexAt(p[i + vertexOffset]);
            out.push(textured ? outputVertex(vertex, usableUvs, p[i + uvOffset]) : vertex);
          }
          return out;
        };
        const fan = (loop: readonly number[]): void => {
          for (let i = 1; i + 1 < loop.length; i++)
            pushTriangle(loop[0] ?? 0, loop[i] ?? 0, loop[i + 1] ?? 0);
        };
        if (kind === 'triangles') {
          const loop = corners(parseNumbers(child(primitive, 'p')?.text ?? ''));
          for (let i = 0; i + 2 < loop.length; i += 3)
            pushTriangle(loop[i] ?? 0, loop[i + 1] ?? 0, loop[i + 2] ?? 0);
        } else if (kind === 'polylist') {
          const loop = corners(parseNumbers(child(primitive, 'p')?.text ?? ''));
          let start = 0;
          for (const count of parseNumbers(child(primitive, 'vcount')?.text ?? '')) {
            if (!Number.isInteger(count) || count < 0 || start + count > loop.length) {
              throw new ImportError('a COLLADA polygon list is inconsistent');
            }
            fan(loop.slice(start, start + count));
            start += count;
          }
        } else if (kind === 'polygons' || kind === 'trifans') {
          for (const p of childrenNamed(primitive, 'p')) fan(corners(parseNumbers(p.text)));
        } else {
          for (const p of childrenNamed(primitive, 'p')) {
            const strip = corners(parseNumbers(p.text));
            for (let i = 0; i + 2 < strip.length; i++) {
              if (i % 2 === 0) pushTriangle(strip[i] ?? 0, strip[i + 1] ?? 0, strip[i + 2] ?? 0);
              else pushTriangle(strip[i + 1] ?? 0, strip[i] ?? 0, strip[i + 2] ?? 0);
            }
          }
        }
      }
      if (indices.length > 0) {
        result =
          meshes.push({
            name: geometry.attributes.name ?? geometry.attributes.id ?? '',
            positions: textured ? Float64Array.from(outPositions) : sourcePositions,
            indices: Uint32Array.from(indices),
            materials: Int32Array.from(perTriangle),
            ...(textured ? { uvs: Float64Array.from(outUvs) } : {}),
          }) - 1;
      }
    } else {
      skippedPrimitives++;
    }
    meshIndex.set(key, result);
    return result;
  };

  // -------------------------------------------------------------------------------- nodes
  const nodes: ImportedNode[] = [];

  const nodeTransform = (element: XmlElement): Mat4 => {
    let matrix: Mat4 = IDENTITY;
    for (const item of element.children) {
      const v = parseNumbers(item.text);
      let step: Mat4 | null = null;
      if (item.name === 'matrix' && v.length === 16) {
        step = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => v[i] ?? Number.NaN);
      } else if (item.name === 'translate' && v.length === 3) {
        step = translation(vec3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
      } else if (item.name === 'scale' && v.length === 3) {
        step = scaling(vec3(v[0] ?? 1, v[1] ?? 1, v[2] ?? 1));
      } else if (item.name === 'rotate' && v.length === 4) {
        const axis = normalize(vec3(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0));
        if (axis) step = rotationAxisAngle(axis, ((v[3] ?? 0) * Math.PI) / 180);
      }
      if (step) matrix = multiply(matrix, step);
    }
    return matrix;
  };

  const bindingsOf = (instance: XmlElement): Map<string, string> => {
    const bindings = new Map<string, string>();
    const common = child(child(instance, 'bind_material'), 'technique_common');
    for (const binding of childrenNamed(common, 'instance_material')) {
      const { symbol, target } = binding.attributes;
      if (symbol !== undefined && target !== undefined) bindings.set(symbol, target);
    }
    return bindings;
  };

  const convertNode = (element: XmlElement, depth: number): number => {
    if (depth > MAX_DEPTH) throw new ImportError('the node hierarchy is too deep or refers to itself');
    if (nodes.length >= limits.maxNodes) {
      throw new ImportError(`the model has more than ${String(limits.maxNodes)} nodes, the import limit`);
    }
    const nodeMeshes: number[] = [];
    const children: number[] = [];
    const index =
      nodes.push({
        name: element.attributes.name ?? element.attributes.id ?? '',
        transform: [...nodeTransform(element)],
        meshes: nodeMeshes,
        children,
      }) - 1;
    for (const item of element.children) {
      if (item.name === 'instance_geometry') {
        const mesh = meshFor(item.attributes.url, bindingsOf(item));
        if (mesh !== null) nodeMeshes.push(mesh);
      } else if (item.name === 'instance_controller') {
        const controller = lookup(item.attributes.url, 'controller');
        const skin = child(controller, 'skin') ?? child(controller, 'morph');
        const mesh = meshFor(skin?.attributes.source, bindingsOf(item));
        if (mesh !== null) nodeMeshes.push(mesh);
      } else if (item.name === 'node') {
        children.push(convertNode(item, depth + 1));
      } else if (item.name === 'instance_node') {
        const target = lookup(item.attributes.url, 'node');
        if (target?.name === 'node') children.push(convertNode(target, depth + 1));
      }
    }
    return index;
  };

  const sceneUrl = child(child(root, 'scene'), 'instance_visual_scene')?.attributes.url;
  const visualScene =
    lookup(sceneUrl, 'visual scene') ?? child(child(root, 'library_visual_scenes'), 'visual_scene');
  if (!visualScene) throw new ImportError('the COLLADA file has no scene');
  const roots = childrenNamed(visualScene, 'node').map((node) => convertNode(node, 0));

  if (skippedPrimitives > 0) {
    warnings.push(
      `Skipped ${String(skippedPrimitives)} COLLADA elements that are not triangle geometry (lines, splines)`,
    );
  }
  const textures = collector.finish();
  return {
    materials,
    textures,
    meshes,
    nodes,
    roots,
    warnings,
    unitMeters: meter > 0 && Number.isFinite(meter) ? meter : 1,
    upAxis: upText === 'Y_UP' ? 'y' : 'z',
  };
}

/** A COLLADA `newparam` by its `sid`, anywhere in the document (effects scope them locally). */
function findParam(root: XmlElement, sid: string): XmlElement | undefined {
  const stack = [root];
  for (let element = stack.pop(); element; element = stack.pop()) {
    if (element.name === 'newparam' && element.attributes.sid === sid) return element;
    stack.push(...element.children);
  }
  return undefined;
}
