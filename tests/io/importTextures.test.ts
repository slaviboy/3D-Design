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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetId } from '../../src/kernel/ids';
import { vec3, type Vec3 } from '../../src/kernel/math/vec3';
import { validateDocument } from '../../src/kernel/model/validate';
import type { FaceView } from '../../src/kernel/model/EntityStore';
import type { MaterialData, TexturePlacement } from '../../src/kernel/model/types';
import { textureAxes, textureUv } from '../../src/kernel/ops/materials';
import { parseImportFiles } from '../../src/io/import/parseImport';
import { encodeGlb } from '../../src/io/mesh/glb';
import { DEFAULT_IMPORT_LIMITS } from '../../src/io/mesh/limits';
import { fitTexturePlacement } from '../../src/io/mesh/texturePlacement';
import type { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { jpegBytes, pngBytes } from '../kernel/imageBytes';
import { definitionsWithFaces, importInto, squareTds } from './importHelpers';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------------------------------------ fixtures

interface GltfQuadOptions {
  /** Positions (x, y, z) per vertex. */
  readonly positions: readonly number[];
  /** glTF UVs (origin at the top-left) per vertex. */
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
  /** Image bytes stored in a buffer view, or a URI. */
  readonly image: { readonly bytes: Uint8Array; readonly mimeType: string } | { readonly uri: string };
  readonly extra?: (json: Record<string, unknown>) => void;
}

/** A GLB with one mesh whose material has a base color texture. */
function texturedGlb({ positions, uvs, indices, image, extra }: GltfQuadOptions): Uint8Array {
  const position = new Float32Array(positions);
  const uv = new Float32Array(uvs);
  const index = new Uint16Array(indices);
  const parts: Uint8Array[] = [
    new Uint8Array(position.buffer),
    new Uint8Array(uv.buffer),
    new Uint8Array(index.buffer),
  ];
  if ('bytes' in image) parts.push(image.bytes);
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let length = 0;
  for (const part of parts) {
    length = Math.ceil(length / 4) * 4;
    views.push({ buffer: 0, byteOffset: length, byteLength: part.byteLength });
    length += part.byteLength;
  }
  const binary = new Uint8Array(Math.ceil(length / 4) * 4);
  parts.forEach((part, i) => {
    binary.set(part, views[i]?.byteOffset ?? 0);
  });
  const count = positions.length / 3;
  const json: Record<string, unknown> = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Panel', mesh: 0 }],
    meshes: [
      {
        name: 'Panel',
        primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'Painted',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } },
      },
    ],
    textures: [{ source: 0 }],
    images: [
      'bytes' in image ? { bufferView: 3, mimeType: image.mimeType, name: 'panel' } : { uri: image.uri },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: binary.byteLength }],
  };
  extra?.(json);
  return encodeGlb(json, binary);
}

const texturedFaces = (doc: ModelDocument): FaceView[] =>
  definitionsWithFaces(doc).flatMap((definition) => [...definition.store.faces()]);

const onlyMaterial = (doc: ModelDocument): MaterialData => {
  const [material] = [...doc.materials()];
  if (!material) throw new Error('expected a material');
  return material;
};

/** Image UVs (origin at the bottom-left) that a face shows at each of its outer corners. */
function faceUvs(doc: ModelDocument, face: FaceView): { point: Vec3; uv: { u: number; v: number } }[] {
  const material = doc.material(face.attributes.frontMaterialId ?? (-1 as never));
  const texture = material?.texture;
  const definition = definitionsWithFaces(doc).find((candidate) => candidate.store.face(face.id));
  if (!texture || !definition || !face.plane) throw new Error('expected a textured face');
  const axes = textureAxes(face.plane.normal);
  return definition.store
    .loopPoints(face.outer)
    .map((point) => ({ point, uv: textureUv(point, axes, texture, face.attributes.frontTexturePlacement) }));
}

// ------------------------------------------------------------------------------------------------ fitting

describe('texture placement fitting', () => {
  const axesPoints = (normal: Vec3, coordinates: readonly (readonly [number, number])[]): Vec3[] => {
    const axes = textureAxes(normal);
    return coordinates.map(([x, y]) =>
      vec3(
        axes.u.x * x + axes.v.x * y + normal.x * 0.5,
        axes.u.y * x + axes.v.y * y + normal.y * 0.5,
        axes.u.z * x + axes.v.z * y + normal.z * 0.5,
      ),
    );
  };

  it.each([
    [{ offsetX: 0.3, offsetY: -1.2, rotation: 0.7, scaleX: 1.5, scaleY: 0.5 }],
    [{ offsetX: -4, offsetY: 2, rotation: -2.5, scaleX: 2, scaleY: -3 }],
    [{ offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1 }],
  ])('recovers a planar mapping exactly (%o)', (placement: TexturePlacement) => {
    const normal = vec3(0.6, 0, 0.8);
    const points = axesPoints(normal, [
      [0, 0],
      [3, 0.5],
      [1, 2],
      [-1, 1.5],
    ]);
    const tile = { width: 1, height: 1 };
    const axes = textureAxes(normal);
    const uvs = points.map((point) => textureUv(point, axes, tile, placement));
    const fit = fitTexturePlacement(points, uvs, normal);
    expect(fit?.error).toBeCloseTo(0, 9);
    for (const [index, point] of points.entries()) {
      const uv = textureUv(point, axes, tile, fit?.placement ?? null);
      expect(uv.u).toBeCloseTo(uvs[index]?.u ?? Number.NaN, 9);
      expect(uv.v).toBeCloseTo(uvs[index]?.v ?? Number.NaN, 9);
    }
    expect(fit?.placement.scaleX).toBeGreaterThan(0);
  });

  it('reports the error of a sheared mapping and refuses collapsed coordinates', () => {
    const normal = vec3(0, 0, 1);
    const points = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0)];
    const sheared = fitTexturePlacement(
      points,
      [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
      ],
      normal,
    );
    expect(sheared?.error).toBeGreaterThan(0.1);
    const collapsed = fitTexturePlacement(
      points,
      [
        { u: 0, v: 0 },
        { u: 1, v: 1 },
        { u: 2, v: 2 },
      ],
      normal,
    );
    expect(collapsed).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ glTF

describe('glTF texture import', () => {
  // A 4 × 2 m panel in the XY plane. Image U = x/4 + 0.25 and V = y/2; glTF stores 1 − V.
  const PANEL = {
    positions: [0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0],
    uvs: [0.25, 1, 1.25, 1, 1.25, 0, 0.25, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };

  it('imports an embedded PNG with the placement that reproduces planar UVs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const png = pngBytes(64, 32);
    const glb = texturedGlb({ ...PANEL, image: { bytes: png, mimeType: 'image/png' } });
    const scene = await parseImportFiles([{ name: 'panel.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(scene.warnings).toEqual([]);
    expect(scene.textures).toHaveLength(1);
    expect(scene.materials[0]?.texture?.image).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const { doc, summary } = importInto(scene);
    expect(summary).toMatchObject({ faces: 1, materials: 1, textures: 1, warnings: [] });
    const [asset] = [...doc.assets()];
    expect(asset).toMatchObject({ mimeType: 'image/png', width: 64, height: 32 });
    expect(asset?.bytes).toEqual(png);
    const material = onlyMaterial(doc);
    expect(material.texture?.assetId).toBe(asset?.id);
    expect(material.texture?.width).toBeCloseTo(4, 9);
    expect(material.texture?.height).toBeCloseTo(2, 9);

    const [face] = texturedFaces(doc);
    const placement = face?.attributes.frontTexturePlacement;
    expect(placement?.offsetX).toBeCloseTo(-1, 9);
    expect(placement?.offsetY).toBeCloseTo(0, 9);
    expect(placement?.rotation).toBeCloseTo(0, 9);
    expect(placement?.scaleX).toBeCloseTo(1, 9);
    expect(placement?.scaleY).toBeCloseTo(1, 9);
    expect(face?.attributes.backTexturePlacement).toEqual(placement);
    for (const { point, uv } of faceUvs(doc, face as FaceView)) {
      expect(uv.u).toBeCloseTo(point.x / 4 + 0.25, 9);
      expect(uv.v).toBeCloseTo(point.y / 2, 9);
    }
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('keeps rotated and mirrored mappings aligned after the Y-up conversion', async () => {
    // U = y (up the panel), V = x / 2, which is a quarter turn and a mirror.
    const uvs = PANEL.positions.flatMap((_, i, all) =>
      i % 3 === 0 ? [all[i + 1] ?? 0, 1 - (all[i] ?? 0) / 2] : [],
    );
    const glb = texturedGlb({ ...PANEL, uvs, image: { bytes: jpegBytes(16, 16), mimeType: 'image/jpeg' } });
    const scene = await parseImportFiles([{ name: 'turned.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    const { doc } = importInto(scene, { swapYUpToZUp: true });
    const [face] = texturedFaces(doc);
    expect(face).toBeDefined();
    // Y-up (x, y, z) becomes (x, −z, y): the panel stands in the XZ plane, file y is world z.
    for (const { point, uv } of faceUvs(doc, face as FaceView)) {
      expect(uv.u).toBeCloseTo(point.z, 9);
      expect(uv.v).toBeCloseTo(point.x / 2, 9);
    }
    expect(Math.abs(face?.attributes.frontTexturePlacement?.rotation ?? 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('merges coplanar triangles only when their placements agree', async () => {
    // The second triangle's UVs are shifted by a quarter tile, so the two halves can't share one placement.
    const positions = [...PANEL.positions, 0, 0, 0, 4, 2, 0];
    const uvs = [0.25, 1, 1.25, 1, 1.25, 0, 0.25, 0, 0.5, 1, 1.5, 0];
    const glb = texturedGlb({
      positions,
      uvs,
      indices: [0, 1, 2, 4, 5, 3],
      image: { bytes: pngBytes(8, 8), mimeType: 'image/png' },
    });
    const scene = await parseImportFiles([{ name: 'split.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(importInto(scene).summary.faces).toBe(2);
    const whole = texturedGlb({ ...PANEL, image: { bytes: pngBytes(8, 8), mimeType: 'image/png' } });
    const wholeScene = await parseImportFiles([{ name: 'whole.glb', bytes: whole }], DEFAULT_IMPORT_LIMITS);
    expect(importInto(wholeScene).summary.faces).toBe(1);
    expect(importInto(wholeScene, { mergeCoplanar: false }).summary.faces).toBe(2);
  });

  it('adds one asset per distinct image and removes assets and materials on undo', async () => {
    const png = pngBytes(8, 8, 3);
    const glb = texturedGlb({
      ...PANEL,
      image: { bytes: png, mimeType: 'image/png' },
      extra: (json) => {
        // A second material and image with identical bytes, used by a second mesh node.
        (json.images as unknown[]).push({
          uri: `data:image/png;base64,${btoa(String.fromCharCode(...png))}`,
        });
        (json.textures as unknown[]).push({ source: 1 });
        (json.materials as unknown[]).push({
          name: 'Painted again',
          pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
        });
        (json.meshes as { primitives: Record<string, unknown>[] }[])[0]?.primitives.push({
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          indices: 2,
          material: 1,
        });
      },
    });
    const scene = await parseImportFiles([{ name: 'twice.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(scene.textures).toHaveLength(1);
    const { doc, summary } = importInto(scene);
    expect(summary.textures).toBe(1);
    expect([...doc.assets()]).toHaveLength(1);
    expect([...doc.materials()]).toHaveLength(2);
    expect(validateDocument(doc).problems).toEqual([]);

    // Importing again reuses the image and the materials.
    importInto(scene, {}, doc);
    expect([...doc.assets()]).toHaveLength(1);
    expect([...doc.materials()]).toHaveLength(2);
    doc.undo();
    doc.undo();
    expect([...doc.assets()]).toHaveLength(0);
    expect([...doc.materials()]).toHaveLength(0);
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('warns about an external image URL and never fetches it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const glb = texturedGlb({ ...PANEL, image: { uri: 'https://example.com/panel.png' } });
    const scene = await parseImportFiles([{ name: 'remote.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(scene.warnings).toEqual([expect.stringContaining('Ignored the external texture')]);
    expect(scene.textures).toEqual([]);
    expect(scene.materials[0]?.texture).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a sibling image among the picked files', async () => {
    const png = pngBytes(10, 10, 9);
    const glb = texturedGlb({ ...PANEL, image: { uri: 'maps/panel%20color.png' } });
    const scene = await parseImportFiles(
      [
        { name: 'site/panel.glb', bytes: glb },
        { name: 'site/maps/panel color.png', bytes: png },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([]);
    expect(scene.textures?.[0]?.bytes).toEqual(png);
  });

  it('skips KTX2 and WebP images with a counted warning and keeps the color', async () => {
    const webp = encode('RIFF\0\0\0\0WEBPVP8 ');
    const glb = texturedGlb({
      ...PANEL,
      image: { bytes: webp, mimeType: 'image/webp' },
      extra: (json) => {
        json.extensionsUsed = ['KHR_texture_basisu'];
        (json.images as unknown[]).push({ uri: 'panel.ktx2', mimeType: 'image/ktx2' });
        (json.textures as unknown[]).push({ extensions: { KHR_texture_basisu: { source: 1 } } });
        (json.materials as unknown[]).push({
          name: 'Compressed',
          pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], baseColorTexture: { index: 1 } },
        });
        (json.meshes as { primitives: Record<string, unknown>[] }[])[0]?.primitives.push({
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          indices: 2,
          material: 1,
        });
      },
    });
    const scene = await parseImportFiles([{ name: 'packed.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(scene.warnings).toEqual([
      expect.stringMatching(/Skipped 2 texture images .*WebP images are not supported.*KHR_texture_basisu/),
    ]);
    expect(scene.materials.map((material) => material.texture)).toEqual([undefined, undefined]);
    const { doc, summary } = importInto(scene);
    expect(summary.textures).toBe(0);
    expect([...doc.materials()].map((material) => material.texture)).toEqual([null, null]);
  });

  it('refuses images larger than the texture limits', async () => {
    const glb = texturedGlb({ ...PANEL, image: { bytes: pngBytes(9000, 16), mimeType: 'image/png' } });
    const scene = await parseImportFiles([{ name: 'huge.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    expect(scene.warnings).toEqual([expect.stringContaining('larger than 8192 pixels on a side')]);
    expect(scene.textures).toEqual([]);

    // The main thread checks again, in case a scene arrives with an image the worker did not check.
    const forged = await parseImportFiles(
      [
        {
          name: 'fine.glb',
          bytes: texturedGlb({ ...PANEL, image: { bytes: pngBytes(8, 8), mimeType: 'image/png' } }),
        },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    const { doc, summary } = importInto({
      ...forged,
      textures: [{ name: 'forged.png', bytes: pngBytes(8193, 8) }],
    });
    expect(summary.warnings).toEqual([expect.stringContaining('forged.png')]);
    expect([...doc.assets()]).toHaveLength(0);
    expect(onlyMaterial(doc).texture).toBeNull();
  });

  it('reports textured triangles whose UVs a planar placement cannot reproduce', async () => {
    // The first triangle maps without shear (V = 0.75·y); the second is skewed (V = 0.5·y + 0.25·x).
    const uvs = [0, 1, 1, 1, 1, -0.5, 0, 0];
    const glb = texturedGlb({ ...PANEL, uvs, image: { bytes: pngBytes(8, 8), mimeType: 'image/png' } });
    const scene = await parseImportFiles([{ name: 'skew.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    const { doc, summary } = importInto(scene);
    expect(summary.warnings).toEqual([expect.stringMatching(/^1 textured triangle has texture coordinates/)]);
    expect(summary.faces).toBe(2);
    expect(validateDocument(doc).problems).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ OBJ

const QUAD_OBJ = `mtllib quad.mtl
v 0 0 0
v 2 0 0
v 2 2 0
v 0 2 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
usemtl tiles
f 1/1 2/2 3/3 4/4
`;

describe('OBJ texture import', () => {
  it('reads map_Kd from a picked PNG, with its offset and scale options', async () => {
    const png = pngBytes(32, 32, 1);
    const mtl = 'newmtl tiles\nKd 1 1 1\nmap_Kd -o 0.5 0 -s 2 2 tile face.png\n';
    const scene = await parseImportFiles(
      [
        { name: 'quad.obj', bytes: encode(QUAD_OBJ) },
        { name: 'quad.mtl', bytes: encode(mtl) },
        { name: 'tile face.png', bytes: png },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([]);
    expect(scene.materials[0]).toMatchObject({
      name: 'tiles',
      textureName: 'tile face.png',
      texture: { image: 0, uvTransform: [2, 0, 0, 2, 0.5, 0] },
    });
    const { doc, summary } = importInto(scene);
    expect(summary).toMatchObject({ faces: 1, textures: 1 });
    expect([...doc.assets()][0]?.name).toBe('tile face.png');
    const [face] = texturedFaces(doc);
    // uv' = 2·uv + (0.5, 0), with uv = position / 2.
    for (const { point, uv } of faceUvs(doc, face as FaceView)) {
      expect(uv.u).toBeCloseTo(point.x + 0.5, 9);
      expect(uv.v).toBeCloseTo(point.y, 9);
    }
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('warns about external and unsupported map_Kd images and never fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mtl = [
      'newmtl tiles',
      'map_Kd https://example.com/tiles.png',
      'newmtl other',
      'map_Kd bark.tga',
    ].join('\n');
    const scene = await parseImportFiles(
      [
        { name: 'quad.obj', bytes: encode(QUAD_OBJ.replace('usemtl tiles', 'usemtl tiles')) },
        { name: 'quad.mtl', bytes: encode(mtl) },
        { name: 'bark.tga', bytes: new Uint8Array(32) },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([
      expect.stringContaining('Ignored the external texture "https://example.com/tiles.png"'),
      expect.stringMatching(/Skipped 1 texture image .*bark\.tga \(TGA images are not supported\)/),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------------ COLLADA

const TEXTURED_DAE = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_images>
    <image id="brick-image"><init_from>textures/brick.jpg</init_from></image>
  </library_images>
  <library_effects>
    <effect id="brick-effect"><profile_COMMON>
      <newparam sid="brick-surface"><surface type="2D"><init_from>brick-image</init_from></surface></newparam>
      <newparam sid="brick-sampler"><sampler2D><source>brick-surface</source></sampler2D></newparam>
      <technique sid="common"><lambert><diffuse><texture texture="brick-sampler" texcoord="UV"/></diffuse></lambert></technique>
    </profile_COMMON></effect>
  </library_effects>
  <library_materials>
    <material id="brick" name="Brick"><instance_effect url="#brick-effect"/></material>
  </library_materials>
  <library_geometries>
    <geometry id="wall" name="Wall"><mesh>
      <source id="wall-positions"><float_array id="wall-positions-array" count="12">0 0 0 3 0 0 3 0 1 0 0 1</float_array>
        <technique_common><accessor source="#wall-positions-array" count="4" stride="3"/></technique_common></source>
      <source id="wall-uvs"><float_array id="wall-uvs-array" count="8">0 0 1.5 0 1.5 0.5 0 0.5</float_array>
        <technique_common><accessor source="#wall-uvs-array" count="4" stride="2"/></technique_common></source>
      <vertices id="wall-vertices"><input semantic="POSITION" source="#wall-positions"/></vertices>
      <triangles material="brick" count="2">
        <input semantic="VERTEX" source="#wall-vertices" offset="0"/>
        <input semantic="TEXCOORD" source="#wall-uvs" offset="1" set="0"/>
        <p>0 0 1 1 2 2 0 0 2 2 3 3</p>
      </triangles>
    </mesh></geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene"><node id="wall-node" name="Wall">
      <instance_geometry url="#wall"><bind_material><technique_common>
        <instance_material symbol="brick" target="#brick"/>
      </technique_common></bind_material></instance_geometry>
    </node></visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`;

describe('COLLADA texture import', () => {
  it('reads a diffuse texture through image init_from and the TEXCOORD input', async () => {
    const jpeg = jpegBytes(40, 20);
    const scene = await parseImportFiles(
      [
        { name: 'wall.dae', bytes: encode(TEXTURED_DAE) },
        { name: 'brick.jpg', bytes: jpeg },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([]);
    expect(scene.materials).toEqual([
      expect.objectContaining({ name: 'Brick', textureName: 'brick.jpg', texture: expect.anything() }),
    ]);
    const { doc, summary } = importInto(scene, { unitMeters: scene.unitMeters ?? 1 });
    expect(summary).toMatchObject({ faces: 1, textures: 1, warnings: [] });
    const material = onlyMaterial(doc);
    expect(doc.asset(material.texture?.assetId ?? (-1 as AssetId))?.mimeType).toBe('image/jpeg');
    // One UV unit spans 2 m along the wall and 2 m up it.
    expect(material.texture?.width).toBeCloseTo(2, 9);
    expect(material.texture?.height).toBeCloseTo(2, 9);
    const [face] = texturedFaces(doc);
    for (const { point, uv } of faceUvs(doc, face as FaceView)) {
      expect(uv.u).toBeCloseTo(point.x / 2, 9);
      expect(uv.v).toBeCloseTo(point.z / 2, 9);
    }
    expect(validateDocument(doc).problems).toEqual([]);
  });

  it('keeps the color and says so when the image was not picked', async () => {
    const scene = await parseImportFiles(
      [{ name: 'wall.dae', bytes: encode(TEXTURED_DAE) }],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([expect.stringContaining('"brick.jpg" was not among the selected files')]);
    expect(scene.materials[0]?.texture).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ 3DS

describe('3DS texture import', () => {
  it('imports the diffuse map named in the file from the picked files', async () => {
    const scene = await parseImportFiles(
      [
        { name: 'plate.3ds', bytes: squareTds() },
        { name: 'wood.jpg', bytes: jpegBytes(12, 12) },
      ],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene.warnings).toEqual([]);
    expect(scene.materials[0]).toMatchObject({ textureName: 'wood.jpg', texture: { image: 0 } });
    const { doc, summary } = importInto(scene, { unitMeters: 0.0254 });
    expect(summary.textures).toBe(1);
    // The test file has no texture coordinates, so the face uses the default projection.
    expect(summary.warnings).toEqual([expect.stringContaining('no texture coordinates')]);
    expect(onlyMaterial(doc).texture).not.toBeNull();
    expect(validateDocument(doc).problems).toEqual([]);
  });
});
