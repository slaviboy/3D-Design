import type { Group, Material, Mesh } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { IDENTITY_TRANSFORM, type ImportedMaterial, type ImportedScene } from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';
import type { FileResolver, InputFile } from './fileSet';
import { materialLibraries, parseMtl } from './mtl';
import { TextureCollector } from './textures';
import { sceneFromObject3D } from './threeScene';

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ------------------------------------------------------------------------------------------------ OBJ

/** OBJ through three's OBJLoader, with materials (colors, opacity, map_Kd textures) from the picked MTL files. */
export function parseObj(
  main: InputFile,
  resolver: FileResolver,
  limits: ImportLimits,
  warnings: string[],
): ImportedScene {
  const text = new TextDecoder().decode(main.bytes);
  const materials = new Map<string, ImportedMaterial>();
  const collector = new TextureCollector(resolver, warnings);
  for (const library of materialLibraries(text)) {
    const bytes = resolver.resolve(library, 'material library');
    if (!bytes) continue;
    for (const [name, mtl] of parseMtl(new TextDecoder().decode(bytes))) {
      if (materials.has(name)) continue;
      const { textureUvTransform, ...material } = mtl;
      const image = material.textureName === null ? null : collector.fromReference(material.textureName);
      const texture = collector.reference(image, textureUvTransform);
      materials.set(name, texture ? { ...material, texture } : material);
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
  const textures = collector.finish();
  return sceneFromObject3D(
    root,
    {
      limits,
      materialByName: (name) => materials.get(name),
      onlyNamedMaterials: true,
      textures: () => textures,
    },
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
const TDS_MAP_USCALE = 0xa354;
const TDS_MAP_VSCALE = 0xa356;
const TDS_MAP_UOFFSET = 0xa358;
const TDS_MAP_VOFFSET = 0xa35a;

interface TdsChunk {
  readonly id: number;
  readChunk(): TdsChunk | null | undefined;
  readString(): string;
  readFloat(): number;
}

/** What Planar's replacement for TDSLoader.readMap stores as `material.map`: no texture, just its description. */
interface TdsMap {
  readonly name: string;
  readonly uvTransform: readonly number[];
}

/**
 * 3DS through three's TDSLoader. The loader would load texture maps through the DOM, so map chunks are read for
 * their file name, offset and scale, and the image is looked up among the picked files.
 */
export function parse3ds(
  main: InputFile,
  resolver: FileResolver,
  limits: ImportLimits,
  warnings: string[],
): ImportedScene {
  const bytes = main.bytes;
  if (bytes.byteLength < 6) throw new ImportError('the 3DS file is empty or truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== TDS_MAGIC || view.getUint32(2, true) > bytes.byteLength) {
    throw new ImportError('this is not a valid 3DS file');
  }
  const loader = new TDSLoader();
  (loader as unknown as { readMap: (chunk: TdsChunk) => TdsMap | null }).readMap = (chunk) => {
    let name = '';
    const transform = [1, 0, 0, 1, 0, 0];
    for (let next = chunk.readChunk(); next; next = chunk.readChunk()) {
      // Same meaning as three's texture repeat and offset: uv' = uv · scale + offset.
      if (next.id === TDS_MAP_NAME) name = next.readString();
      else if (next.id === TDS_MAP_USCALE) transform[0] = next.readFloat();
      else if (next.id === TDS_MAP_VSCALE) transform[3] = next.readFloat();
      else if (next.id === TDS_MAP_UOFFSET) transform[4] = next.readFloat();
      else if (next.id === TDS_MAP_VOFFSET) transform[5] = next.readFloat();
    }
    return name === '' ? null : { name, uvTransform: transform.map((v) => (Number.isFinite(v) ? v : 0)) };
  };
  let root: Group;
  try {
    root = loader.parse(arrayBufferOf(bytes), '');
  } catch (error) {
    throw new ImportError(
      `the 3DS file could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const collector = new TextureCollector(resolver, warnings);
  const textureOf = new Map<Material, ReturnType<TextureCollector['reference']>>();
  root.traverse((object) => {
    const list = (object as Partial<Mesh>).material;
    for (const material of Array.isArray(list) ? list : list ? [list] : []) {
      const map = (material as { map?: TdsMap | null }).map;
      if (!map || textureOf.has(material)) continue;
      textureOf.set(material, collector.reference(collector.fromReference(map.name), map.uvTransform));
    }
  });
  const textures = collector.finish();
  return sceneFromObject3D(
    root,
    { limits, textureOf: (material) => textureOf.get(material), textures: () => textures },
    warnings,
  );
}
