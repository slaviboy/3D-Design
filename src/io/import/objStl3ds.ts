import type { Group } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { IDENTITY_TRANSFORM, type ImportedMaterial, type ImportedScene } from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';
import type { FileResolver, InputFile } from './fileSet';
import { materialLibraries, parseMtl } from './mtl';
import { sceneFromObject3D } from './threeScene';

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ------------------------------------------------------------------------------------------------ OBJ

/** OBJ through three's OBJLoader, with materials from the picked MTL files (colors and opacity only). */
export function parseObj(
  main: InputFile,
  resolver: FileResolver,
  limits: ImportLimits,
  warnings: string[],
): ImportedScene {
  const text = new TextDecoder().decode(main.bytes);
  const materials = new Map<string, ImportedMaterial>();
  for (const library of materialLibraries(text)) {
    const bytes = resolver.resolve(library, 'material library');
    if (!bytes) continue;
    for (const [name, material] of parseMtl(new TextDecoder().decode(bytes))) {
      if (!materials.has(name)) materials.set(name, material);
    }
  }
  let root: Group;
  try {
    root = new OBJLoader().parse(text);
  } catch (error) {
    throw new ImportError(
      `the OBJ file could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return sceneFromObject3D(
    root,
    { limits, materialByName: (name) => materials.get(name), onlyNamedMaterials: true },
    warnings,
  );
}

// ------------------------------------------------------------------------------------------------ STL

const STL_HEADER_BYTES = 84;
const STL_TRIANGLE_BYTES = 50;

/** Binary or ASCII STL through three's STLLoader. One mesh, no materials. */
export function parseStl(main: InputFile, limits: ImportLimits, warnings: string[]): ImportedScene {
  const bytes = main.bytes;
  if (bytes.byteLength >= STL_HEADER_BYTES) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (STL_HEADER_BYTES + count * STL_TRIANGLE_BYTES === bytes.byteLength && count > limits.maxTriangles) {
      throw new ImportError(
        `the model has ${count.toLocaleString('en-US')} triangles, more than the import limit of ${limits.maxTriangles.toLocaleString('en-US')}`,
      );
    }
  }
  let geometry;
  try {
    geometry = new STLLoader().parse(arrayBufferOf(bytes));
  } catch (error) {
    throw new ImportError(
      `the STL file could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const position = geometry.getAttribute('position');
  const triangles = Math.floor(position.count / 3);
  if (triangles > limits.maxTriangles) {
    throw new ImportError(
      `the model has ${triangles.toLocaleString('en-US')} triangles, more than the import limit of ${limits.maxTriangles.toLocaleString('en-US')}`,
    );
  }
  const positions = new Float64Array(triangles * 9);
  for (let i = 0; i < triangles * 3; i++) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  const indices = new Uint32Array(triangles * 3);
  indices.forEach((_, i) => (indices[i] = i));
  const name = main.name.replace(/^.*\//, '').replace(/\.stl$/i, '');
  return {
    materials: [],
    meshes: [{ name, positions, indices, materials: new Int32Array(triangles).fill(-1) }],
    nodes: [{ name, transform: IDENTITY_TRANSFORM, meshes: [0], children: [] }],
    roots: [0],
    warnings,
    unitMeters: null,
    upAxis: null,
  };
}

// ------------------------------------------------------------------------------------------------ 3DS

const TDS_MAGIC = 0x4d4d;
const TDS_MAP_NAME = 0xa300;

interface TdsChunk {
  readonly id: number;
  readChunk(): TdsChunk | null | undefined;
  readString(): string;
}

/**
 * 3DS through three's TDSLoader. The loader would load texture maps through the DOM, so map chunks are read for
 * their file names only.
 */
export function parse3ds(main: InputFile, limits: ImportLimits, warnings: string[]): ImportedScene {
  const bytes = main.bytes;
  if (bytes.byteLength < 6) throw new ImportError('the 3DS file is empty or truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== TDS_MAGIC || view.getUint32(2, true) > bytes.byteLength) {
    throw new ImportError('this is not a valid 3DS file');
  }
  const textureNames: string[] = [];
  const loader = new TDSLoader();
  (loader as unknown as { readMap: (chunk: TdsChunk) => null }).readMap = (chunk) => {
    for (let next = chunk.readChunk(); next; next = chunk.readChunk()) {
      if (next.id === TDS_MAP_NAME) textureNames.push(next.readString());
    }
    return null;
  };
  let root: Group;
  try {
    root = loader.parse(arrayBufferOf(bytes), '');
  } catch (error) {
    throw new ImportError(
      `the 3DS file could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (textureNames.length > 0) {
    warnings.push(`Textures are not imported; the file refers to ${[...new Set(textureNames)].join(', ')}`);
  }
  return sceneFromObject3D(root, { limits }, warnings);
}
