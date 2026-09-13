import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY } from '../../src/kernel/math/mat4';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import { solidVolume } from '../../src/kernel/ops/solids/solid';
import { importAcceptedExtensions, IMPORT_FORMATS } from '../../src/io/import/formats';
import { parseImportFiles } from '../../src/io/import/parseImport';
import { parseXml } from '../../src/io/import/xml';
import type { ImportedScene } from '../../src/io/mesh/importedScene';
import { DEFAULT_IMPORT_LIMITS, ImportError, type ImportLimits } from '../../src/io/mesh/limits';
import {
  binaryStl,
  cubeTriangles,
  definitionsWithFaces,
  facesUnder,
  fixture,
  importInto,
  sharedMeshGlb,
  squareTds,
  worldBounds,
} from './importHelpers';

const limits = (overrides: Partial<ImportLimits> = {}): ImportLimits => ({
  ...DEFAULT_IMPORT_LIMITS,
  ...overrides,
});
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import format registry', () => {
  it('lists only implemented formats and accepts their companion files and zips', () => {
    expect(IMPORT_FORMATS.map((format) => format.id)).toEqual(['gltf', 'obj', 'stl', 'dae', '3ds']);
    expect(importAcceptedExtensions()).toEqual(
      expect.arrayContaining(['.glb', '.gltf', '.bin', '.obj', '.mtl', '.stl', '.dae', '.3ds', '.zip']),
    );
  });
});

describe('OBJ import', () => {
  it('reads geometry with MTL colors, opacity and texture names from the picked files', async () => {
    const scene = await parseImportFiles([fixture('cube.obj'), fixture('cube.mtl')], limits());
    expect(scene.materials.map((material) => material.name).sort()).toEqual(['gray', 'red']);
    expect(scene.materials.find((material) => material.name === 'red')).toMatchObject({
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.5,
      textureName: 'bricks.png',
    });
    const { doc, summary } = importInto(scene, { swapYUpToZUp: true });
    expect(summary).toMatchObject({
      faces: 6,
      groups: 1,
      components: 0,
      materials: 2,
      degenerateTriangles: 0,
    });
    const [cube] = definitionsWithFaces(doc);
    expect(cube?.attributes).toMatchObject({ name: 'cube', isGroup: true });
    expect(solidVolume(cube?.store ?? doc.rootStore)).toBeCloseTo(1, 9);
    // Y-up (x, y, z) becomes Z-up (x, −z, y).
    const bounds = worldBounds(doc);
    expect(bounds.min).toEqual({ x: 0, y: -1, z: 0 });
    expect(bounds.max).toEqual({ x: 1, y: 0, z: 1 });
    const top = [...(cube?.store.faces() ?? [])].find((face) => (face.plane?.normal.z ?? 0) > 0.5);
    const topMaterial = doc.material(top?.attributes.frontMaterialId ?? (-1 as never));
    expect(topMaterial?.name).toBe('red');
  });

  it('imports without materials, with a warning, when the MTL file was not picked', async () => {
    const scene = await parseImportFiles([fixture('cube.obj')], limits());
    expect(scene.warnings).toEqual([expect.stringContaining('"cube.mtl" was not among the selected files')]);
    const { summary } = importInto(scene);
    expect(summary).toMatchObject({ faces: 6, materials: 0 });
  });

  it('reads OBJ and MTL files from a zip', async () => {
    const zip = zipSync({
      'model/cube.obj': fixture('cube.obj').bytes,
      'model/cube.mtl': fixture('cube.mtl').bytes,
    });
    const scene = await parseImportFiles([{ name: 'cube.zip', bytes: zip }], limits());
    expect(scene.materials).toHaveLength(2);
    expect(scene.warnings).toEqual([]);
  });

  it('ignores an external material library with a warning and never fetches it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const text = new TextDecoder()
      .decode(fixture('cube.obj').bytes)
      .replace('mtllib cube.mtl', 'mtllib https://example.com/cube.mtl');
    const scene = await parseImportFiles([{ name: 'cube.obj', bytes: encode(text) }], limits());
    expect(scene.warnings).toEqual([expect.stringContaining('Ignored the external material library')]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('STL import', () => {
  it('reads ASCII STL, applying the unit scale', async () => {
    const scene = await parseImportFiles([fixture('tetra.stl')], limits());
    const { doc, summary } = importInto(scene, { unitMeters: 0.001 });
    expect(summary.faces).toBe(4);
    expect(worldBounds(doc).max).toEqual({ x: 0.01, y: 0.01, z: 0.01 });
    const [tetra] = definitionsWithFaces(doc);
    expect(solidVolume(tetra?.store ?? doc.rootStore)).toBeCloseTo(1e-6 / 6, 12);
  });

  it('reads binary STL and merges coplanar triangles only when asked to', async () => {
    const file = { name: 'cube.stl', bytes: binaryStl(cubeTriangles(2)) };
    const scene = await parseImportFiles([file], limits());
    expect(importInto(scene).summary).toMatchObject({ faces: 6, triangles: 12, groups: 0 });
    expect(importInto(scene, { mergeCoplanar: false }).summary.faces).toBe(12);
  });

  it('refuses a model with more triangles than the configured limit', async () => {
    const file = { name: 'cube.stl', bytes: binaryStl(cubeTriangles()) };
    await expect(parseImportFiles([file], limits({ maxTriangles: 5 }))).rejects.toThrow(
      /12 triangles, more than the import limit of 5/,
    );
  });
});

describe('glTF import', () => {
  it('reads an embedded data-URI buffer, warns about an external texture and records its name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const scene = await parseImportFiles([fixture('quad.gltf')], limits());
    expect(scene.warnings).toEqual([expect.stringContaining('Ignored the external texture')]);
    expect(scene.materials).toEqual([
      { name: 'Sky', color: { r: 0, g: 0.5, b: 1 }, opacity: 1, textureName: 'sky.png' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const upright = importInto(scene, { swapYUpToZUp: false });
    expect(worldBounds(upright.doc)).toEqual({ min: { x: 0, y: 0, z: -1 }, max: { x: 1, y: 0, z: 0 } });
    const turned = importInto(scene, { swapYUpToZUp: true });
    expect(turned.summary.faces).toBe(1);
    expect(worldBounds(turned.doc)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } });
  });

  it('resolves an external buffer only from the picked files', async () => {
    const json = JSON.parse(new TextDecoder().decode(fixture('quad.gltf').bytes)) as {
      buffers: { uri: string }[];
    };
    const dataUri = json.buffers[0]?.uri ?? '';
    const binary = Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    json.buffers[0] = { uri: 'quad.bin' };
    const withBin = await parseImportFiles(
      [
        { name: 'quad.gltf', bytes: encode(JSON.stringify(json)) },
        { name: 'quad.bin', bytes: binary },
      ],
      limits(),
    );
    expect(withBin.meshes).toHaveLength(1);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    json.buffers[0] = { uri: 'https://example.com/quad.bin' };
    await expect(
      parseImportFiles([{ name: 'quad.gltf', bytes: encode(JSON.stringify(json)) }], limits()),
    ).rejects.toThrow(/no triangle meshes/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns a mesh drawn by several nodes into a component and keeps the node hierarchy', async () => {
    const scene = await parseImportFiles([{ name: 'pair.glb', bytes: sharedMeshGlb() }], limits());
    expect(scene.meshes).toHaveLength(1);
    const { doc, summary } = importInto(scene);
    expect(summary).toMatchObject({ faces: 1, groups: 1, components: 1, materials: 1 });
    const component = [...doc.definitions()].find((definition) =>
      definition.attributes.name.startsWith('Tile'),
    );
    expect(component?.attributes.isGroup).toBe(false);
    expect(doc.instancesOf(component?.id ?? doc.rootDefinitionId)).toHaveLength(2);
    expect(facesUnder(doc, doc.rootDefinitionId)).toBe(2);
    expect(worldBounds(doc)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 1, z: 0 } });
  });

  it('rejects damaged files', async () => {
    const truncated = sharedMeshGlb().slice(0, 30);
    await expect(
      parseImportFiles([{ name: 'broken.glb', bytes: truncated }], limits()),
    ).rejects.toBeInstanceOf(ImportError);
    await expect(
      parseImportFiles([{ name: 'broken.gltf', bytes: encode('{ nope') }], limits()),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      parseImportFiles([{ name: 'old.gltf', bytes: encode('{"asset":{"version":"1.0"}}') }], limits()),
    ).rejects.toThrow(/only glTF 2.0/);
  });
});

describe('COLLADA import', () => {
  it('reads units, up axis, materials and shared library nodes', async () => {
    const scene = await parseImportFiles([fixture('components.dae')], limits());
    expect(scene).toMatchObject({ unitMeters: 0.01, upAxis: 'z' });
    expect(scene.materials).toEqual([
      { name: 'Blue & Bold', color: { r: 0, g: 0, b: 1 }, opacity: 1, textureName: null },
    ]);
    const { doc, summary } = importInto(scene, { unitMeters: scene.unitMeters ?? 1 });
    expect(summary).toMatchObject({ faces: 1, components: 1, groups: 2 });
    const component = [...doc.definitions()].find(
      (definition) => !definition.attributes.isGroup && definition.store.faceCount > 0,
    );
    expect(doc.instancesOf(component?.id ?? doc.rootDefinitionId)).toHaveLength(2);
    const bounds = worldBounds(doc);
    expect(bounds.min.x).toBeCloseTo(0, 9);
    expect(bounds.max.x).toBeCloseTo(3, 9);
    expect(bounds.max.y).toBeCloseTo(1, 9);
  });

  it('refuses entity declarations, broken XML and out-of-range indices', async () => {
    const dae = new TextDecoder().decode(fixture('components.dae').bytes);
    const withEntity = dae.replace('<COLLADA', '<!DOCTYPE c [<!ENTITY boom "boom">]><COLLADA');
    await expect(parseImportFiles([{ name: 'a.dae', bytes: encode(withEntity) }], limits())).rejects.toThrow(
      /declares entities/,
    );
    await expect(
      parseImportFiles([{ name: 'b.dae', bytes: encode(dae.slice(0, 400)) }], limits()),
    ).rejects.toThrow(/not well formed/);
    const badIndex = dae.replace('<p>0 1 2 3</p>', '<p>0 1 2 9</p>');
    await expect(parseImportFiles([{ name: 'c.dae', bytes: encode(badIndex) }], limits())).rejects.toThrow(
      /vertex that does not exist/,
    );
  });

  it('decodes only the predefined XML entities', () => {
    expect(parseXml('<a x="&lt;&#65;&#x42;">1 &amp; 2</a>', { maxElements: 10 })).toMatchObject({
      attributes: { x: '<AB' },
      text: '1 & 2',
    });
    expect(() => parseXml('<a>&unknown;</a>', { maxElements: 10 })).toThrow(/unknown entity/);
  });
});

describe('3DS import', () => {
  it('reads meshes and material colors, and names the textures it does not import', async () => {
    const scene = await parseImportFiles([{ name: 'plate.3ds', bytes: squareTds() }], limits());
    expect(scene.warnings).toEqual([expect.stringContaining('wood.jpg')]);
    const { doc, summary } = importInto(scene, { unitMeters: 0.0254 });
    expect(summary).toMatchObject({ faces: 1, materials: 1 });
    const material = [...doc.materials()][0];
    expect(material?.color.g).toBeGreaterThan(0.9);
    expect(material?.color.r).toBeLessThan(0.1);
    expect(worldBounds(doc).max.x).toBeCloseTo(0.254, 6);
  });

  it('rejects files that are not 3DS', async () => {
    await expect(
      parseImportFiles([{ name: 'x.3ds', bytes: encode('hello world') }], limits()),
    ).rejects.toThrow(/not a valid 3DS file/);
  });
});

describe('import selection and limits', () => {
  it('needs exactly one model file', async () => {
    await expect(parseImportFiles([fixture('cube.mtl')], limits())).rejects.toThrow(
      /none of the selected files/,
    );
    await expect(parseImportFiles([fixture('cube.obj'), fixture('tetra.stl')], limits())).rejects.toThrow(
      /one model at a time/,
    );
  });

  it('refuses oversize files and unsafe zip entries', async () => {
    await expect(parseImportFiles([fixture('cube.obj')], limits({ maxFileBytes: 64 }))).rejects.toThrow(
      /larger than the import limit/,
    );
    const zip = zipSync({ '../cube.obj': fixture('cube.obj').bytes });
    await expect(parseImportFiles([{ name: 'evil.zip', bytes: zip }], limits())).rejects.toThrow(
      /unsafe path/,
    );
  });
});

describe('conversion to kernel geometry', () => {
  const square = (
    positions: number[],
    indices: number[],
    transform: readonly number[] = IDENTITY,
  ): ImportedScene => ({
    materials: [],
    meshes: [
      {
        name: 'Square',
        positions: Float64Array.from(positions),
        indices: Uint32Array.from(indices),
        materials: new Int32Array(indices.length / 3).fill(-1),
      },
    ],
    nodes: [
      { name: 'Root', transform: IDENTITY, meshes: [], children: [1] },
      { name: 'Part', transform, meshes: [0], children: [] },
    ],
    roots: [0],
    warnings: [],
    unitMeters: null,
    upAxis: null,
  });

  it('scales node translations with the unit and bakes the scale into geometry', () => {
    const translated = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1];
    const scene = square([0, 0, 0, 50, 0, 0, 50, 50, 0, 0, 50, 0], [0, 1, 2, 0, 2, 3], translated);
    const { doc, summary } = importInto(scene, { unitMeters: 0.01 });
    expect(summary).toMatchObject({ faces: 1, groups: 1 });
    const [part] = doc.store(summary.definition).instances();
    expect(part?.transform[12]).toBeCloseTo(1, 12);
    expect(worldBounds(doc)).toEqual({ min: { x: 1, y: 0, z: 0 }, max: { x: 1.5, y: 0.5, z: 0 } });
  });

  it('drops degenerate triangles and reports how many', () => {
    const scene = square([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 0, 0], [0, 1, 2, 0, 0, 1, 0, 1, 3]);
    expect(importInto(scene).summary).toMatchObject({ faces: 1, triangles: 1, degenerateTriangles: 2 });
  });

  it('wraps the import in a component when asked', () => {
    const scene = square([0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 1, 2]);
    const { doc, summary } = importInto(scene, { as: 'component', name: 'Part' });
    expect(doc.getDefinition(summary.definition).attributes).toEqual({ name: 'Part#1', isGroup: false });
  });

  it.each([
    ['NaN coordinates', square([0, 0, 0, 1, Number.NaN, 0, 1, 1, 0], [0, 1, 2]), /not finite numbers/],
    ['Infinity coordinates', square([0, 0, 0, 1, Infinity, 0, 1, 1, 0], [0, 1, 2]), /not finite numbers/],
    ['an index out of range', square([0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 1, 7]), /vertex that does not exist/],
    ['only degenerate triangles', square([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]), /no usable faces/],
    [
      'a node cycle',
      { ...square([0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 1, 2]), roots: [] } satisfies ImportedScene,
      /no faces|cycle/,
    ],
  ])('rejects %s and leaves the model unchanged', (_label, scene, message) => {
    const doc = new ModelDocument({ validateOnCommit: true });
    const cyclic: ImportedScene =
      scene.roots.length === 0
        ? {
            ...scene,
            nodes: [
              { name: 'A', transform: IDENTITY, meshes: [0], children: [1] },
              { name: 'B', transform: IDENTITY, meshes: [], children: [0] },
            ],
            roots: [],
          }
        : scene;
    expect(() => importInto(cyclic, {}, doc)).toThrow(message);
    expect(doc.canUndo).toBe(false);
    expect(doc.rootStore.instanceCount).toBe(0);
    expect([...doc.definitions()]).toHaveLength(1);
    expect([...doc.materials()]).toHaveLength(0);
  });
});
