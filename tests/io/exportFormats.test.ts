import { describe, expect, it } from 'vitest';
import type { DefinitionId, InstanceId } from '../../src/kernel/ids';
import { IDENTITY, translation } from '../../src/kernel/math/mat4';
import { vec3 } from '../../src/kernel/math/vec3';
import { ModelDocument } from '../../src/kernel/model/ModelDocument';
import {
  addInstance,
  addMaterial,
  setFaceAttributes,
  setInstanceAttributes,
} from '../../src/kernel/model/mutations';
import { makeComponent, makeGroup } from '../../src/kernel/ops/hierarchy';
import { insertSegments } from '../../src/kernel/ops/insertSegments';
import { solidVolume } from '../../src/kernel/ops/solids/solid';
import { ExportError, type ExportSource } from '../../src/io/export/exportScene';
import { EXPORT_FORMATS, exportModel, safeFileName, type ExportOptions } from '../../src/io/export/formats';
import { parseImportFiles } from '../../src/io/import/parseImport';
import { DEFAULT_IMPORT_LIMITS } from '../../src/io/mesh/limits';
import { boxEdges } from '../kernel/helpers';
import { definitionsWithFaces, facesUnder, importInto, worldBounds } from './importHelpers';

/** A 1 × 2 × 3 m box in the model root, with a red top face. */
function boxModel(): ModelDocument {
  const doc = new ModelDocument();
  doc.transact('Box', () => {
    insertSegments(doc, doc.rootDefinitionId, boxEdges(0, 0, 0, 1, 2, 3), { autoFace: true });
    const red = addMaterial(doc, { name: 'Red paint', color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    const top = [...doc.rootStore.faces()].find((face) => (face.plane?.normal.z ?? 0) > 0.5);
    if (top) setFaceAttributes(doc, doc.rootDefinitionId, top.id, { frontMaterialId: red });
  });
  return doc;
}

/** The box as a component, placed twice: at the origin and 5 m along X. */
function componentModel(): { doc: ModelDocument; definition: DefinitionId; instances: InstanceId[] } {
  const doc = boxModel();
  const root = doc.rootDefinitionId;
  const made = makeComponent(doc, root, { faces: [...doc.rootStore.faces()].map((face) => face.id) }, 'Box');
  const second = doc.transact('Copy', () =>
    addInstance(doc, root, made.definition, translation(vec3(5, 0, 0))),
  );
  return { doc, definition: made.definition, instances: [made.instance, second] };
}

const whole = (doc: ModelDocument): ExportSource => ({
  doc,
  context: doc.rootDefinitionId,
  contextTransform: IDENTITY,
  name: 'Model',
});

const options = (overrides: Partial<ExportOptions>): ExportOptions => ({
  format: 'glb',
  fileName: 'box',
  unit: 'm',
  swapZUpToYUp: true,
  ...overrides,
});

const totalVolume = (doc: ModelDocument): number =>
  definitionsWithFaces(doc).reduce((sum, definition) => sum + Math.abs(solidVolume(definition.store)), 0);

describe('export format registry', () => {
  it('lists the implemented exporters', () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual([
      'glb',
      'gltf',
      'obj',
      'stl',
      'stl-ascii',
      'dae',
    ]);
  });

  it('makes safe file names', () => {
    expect(safeFileName(' My: model?.stl ', '.stl')).toBe('My_ model_');
    expect(safeFileName('Sample House', '.stl')).toBe('Sample House');
    expect(safeFileName('', '.glb')).toBe('model');
  });
});

describe('glTF export', () => {
  it.each(['glb', 'gltf'] as const)(
    'round-trips a %s: counts, volume, bounds and materials',
    async (format) => {
      const [file] = exportModel(whole(boxModel()), options({ format }));
      expect(file?.name).toBe(`box.${format}`);
      const scene = await parseImportFiles(
        [{ name: file?.name ?? '', bytes: file?.bytes ?? new Uint8Array() }],
        DEFAULT_IMPORT_LIMITS,
      );
      expect(scene.warnings).toEqual([]);
      const { doc, summary } = importInto(scene, { swapYUpToZUp: true });
      expect(summary.faces).toBe(6);
      expect(totalVolume(doc)).toBeCloseTo(6, 5);
      const bounds = worldBounds(doc);
      expect(bounds.min.x).toBeCloseTo(0, 6);
      expect(bounds.max.y).toBeCloseTo(2, 6);
      expect(bounds.max.z).toBeCloseTo(3, 6);
      expect([...doc.materials()].map((material) => material.name)).toEqual(
        expect.arrayContaining(['Red paint']),
      );
    },
  );

  it('stores a component once and places it with instance transforms', async () => {
    const { doc } = componentModel();
    const [file] = exportModel(whole(doc), options({ format: 'glb' }));
    const glb = file?.bytes ?? new Uint8Array();
    const json = JSON.parse(
      new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))),
    ) as {
      meshes: unknown[];
      nodes: { mesh?: number; matrix?: number[] }[];
    };
    expect(json.meshes).toHaveLength(1);
    expect(json.nodes.filter((node) => node.mesh === 0)).toHaveLength(2);
    // Z-up +5 m along X stays along X in Y-up.
    expect(json.nodes.find((node) => node.matrix)?.matrix?.slice(12, 15)).toEqual([5, 0, 0]);

    const scene = await parseImportFiles([{ name: 'box.glb', bytes: glb }], DEFAULT_IMPORT_LIMITS);
    const back = importInto(scene, { swapYUpToZUp: true });
    expect(back.summary.components).toBe(1);
    const component = [...back.doc.definitions()].find(
      (definition) => !definition.attributes.isGroup && definition.store.faceCount > 0,
    );
    expect(back.doc.instancesOf(component?.id ?? back.doc.rootDefinitionId)).toHaveLength(2);
    expect(facesUnder(back.doc, back.doc.rootDefinitionId)).toBe(12);
    expect(worldBounds(back.doc).max.x).toBeCloseTo(6, 6);
  });
});

describe('STL export', () => {
  it.each(['stl', 'stl-ascii'] as const)('round-trips %s in millimeters', async (format) => {
    const [file] = exportModel(whole(boxModel()), options({ format, unit: 'mm', swapZUpToYUp: false }));
    expect(file?.name).toBe('box.stl');
    if (format === 'stl') expect(file?.bytes.byteLength).toBe(84 + 12 * 50);
    else expect(new TextDecoder().decode(file?.bytes)).toMatch(/^solid box\n[\s\S]*endsolid box\n$/);
    const scene = await parseImportFiles(
      [{ name: 'box.stl', bytes: file?.bytes ?? new Uint8Array() }],
      DEFAULT_IMPORT_LIMITS,
    );
    const { doc, summary } = importInto(scene, { unitMeters: 0.001 });
    expect(summary.faces).toBe(6);
    expect(totalVolume(doc)).toBeCloseTo(6, 5);
    expect(worldBounds(doc).max.z).toBeCloseTo(3, 5);
  });

  it('exports only the selection when asked, and leaves hidden instances out', () => {
    const { doc, instances } = componentModel();
    const [first, second] = instances;
    const triangles = (source: ExportSource): number =>
      new DataView(
        (exportModel(source, options({ format: 'stl' }))[0]?.bytes ?? new Uint8Array(84)).buffer,
      ).getUint32(80, true);
    expect(triangles(whole(doc))).toBe(24);
    expect(
      triangles({ ...whole(doc), selection: { faces: [], instances: first === undefined ? [] : [first] } }),
    ).toBe(12);
    doc.transact('Hide', () => {
      if (second !== undefined) setInstanceAttributes(doc, doc.rootDefinitionId, second, { hidden: true });
    });
    expect(triangles(whole(doc))).toBe(12);
  });

  it('refuses to export a model without visible faces', () => {
    expect(() => exportModel(whole(new ModelDocument()), options({ format: 'stl' }))).toThrow(ExportError);
  });
});

describe('OBJ export', () => {
  it('writes an OBJ and its MTL that import back with colors, and swaps Y and Z when asked', async () => {
    const files = exportModel(whole(boxModel()), options({ format: 'obj', fileName: 'my box' }));
    expect(files.map((file) => file.name)).toEqual(['my_box.obj', 'my_box.mtl']);
    const obj = new TextDecoder().decode(files[0]?.bytes);
    const mtl = new TextDecoder().decode(files[1]?.bytes);
    expect(obj).toContain('mtllib my_box.mtl');
    expect(obj.match(/^f /gm)).toHaveLength(12);
    expect(mtl).toContain('newmtl Red_paint');
    expect(mtl).toContain('Kd 1 0 0');
    // Z-up height 3 becomes Y in the file.
    const ys = [...obj.matchAll(/^v \S+ (\S+) \S+$/gm)].map((match) => Number(match[1]));
    expect(Math.max(...ys)).toBeCloseTo(3, 9);

    const scene = await parseImportFiles(
      files.map((file) => ({ name: file.name, bytes: file.bytes })),
      DEFAULT_IMPORT_LIMITS,
    );
    const { doc, summary } = importInto(scene, { swapYUpToZUp: true });
    expect(summary.faces).toBe(6);
    expect(worldBounds(doc).max).toEqual({ x: 1, y: 2, z: 3 });
    const red = [...doc.materials()].find((material) => material.name === 'Red_paint');
    expect(red?.color.r).toBeCloseTo(1, 6);
  });

  it('keeps Z up and scales to the chosen unit', () => {
    const [file] = exportModel(
      whole(boxModel()),
      options({ format: 'obj', unit: 'cm', swapZUpToYUp: false }),
    );
    const zs = [...new TextDecoder().decode(file?.bytes).matchAll(/^v \S+ \S+ (\S+)$/gm)].map((match) =>
      Number(match[1]),
    );
    expect(Math.max(...zs)).toBeCloseTo(300, 9);
  });
});

describe('COLLADA export', () => {
  it('round-trips components, units and the up axis', async () => {
    const { doc } = componentModel();
    const [file] = exportModel(whole(doc), options({ format: 'dae', unit: 'cm', swapZUpToYUp: false }));
    const text = new TextDecoder().decode(file?.bytes);
    expect(text).toContain('<unit name="centimeter" meter="0.01"/>');
    expect(text.match(/<geometry /g)).toHaveLength(1);
    const scene = await parseImportFiles(
      [{ name: 'box.dae', bytes: file?.bytes ?? new Uint8Array() }],
      DEFAULT_IMPORT_LIMITS,
    );
    expect(scene).toMatchObject({ unitMeters: 0.01, upAxis: 'z' });
    const back = importInto(scene, { unitMeters: 0.01 });
    expect(back.summary.components).toBe(1);
    expect(facesUnder(back.doc, back.doc.rootDefinitionId)).toBe(12);
    expect(totalVolume(back.doc)).toBeCloseTo(6, 5);
    expect(worldBounds(back.doc).max.x).toBeCloseTo(6, 6);
    expect([...back.doc.materials()].map((material) => material.name)).toContain('Red paint');
  });

  it('exports groups nested in the open context', () => {
    const doc = boxModel();
    doc.transact('Group', () =>
      makeGroup(doc, doc.rootDefinitionId, { faces: [...doc.rootStore.faces()].map((face) => face.id) }),
    );
    const [file] = exportModel(whole(doc), options({ format: 'dae', swapZUpToYUp: true }));
    const text = new TextDecoder().decode(file?.bytes);
    expect(text).toContain('<up_axis>Y_UP</up_axis>');
    expect(text.match(/<node /g)).toHaveLength(2);
  });
});
