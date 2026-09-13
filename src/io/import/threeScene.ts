import type { BufferGeometry, Material, Mesh, Object3D } from 'three';
import { isIdentity } from '../mesh/axes';
import { clamp01 } from '../mesh/color';
import type {
  ImportedMaterial,
  ImportedMaterialTexture,
  ImportedMesh,
  ImportedNode,
  ImportedScene,
  ImportedTexture,
} from '../mesh/importedScene';
import { ImportError, type ImportLimits } from '../mesh/limits';

/*
 * Converts the object tree a three.js loader produced into a plain ImportedScene. Runs in the io worker, so only
 * plain arrays cross to the main thread. Meshes that share one geometry and material (glTF meshes used by several
 * nodes) map to one ImportedMesh, which the converter turns into a component.
 */

export interface ThreeSceneOptions {
  readonly limits: Pick<ImportLimits, 'maxTriangles' | 'maxNodes'>;
  /** Replaces a loader material by name (OBJ materials come from Planar's own MTL reader). */
  readonly materialByName?: (name: string) => ImportedMaterial | undefined;
  /** Loader materials without an override become "no material" (OBJ faces without a material library entry). */
  readonly onlyNamedMaterials?: boolean;
  /** The texture file name a loader material came with, when the loader dropped the texture itself. */
  readonly textureNameOf?: (material: Material) => string | null;
  /** The usable color texture of a loader material, when it has one. */
  readonly textureOf?: (material: Material) => ImportedMaterialTexture | undefined;
  /** Images referenced by the materials' textures. */
  readonly textures?: () => readonly ImportedTexture[];
  /** The name of the mesh data an object draws, when the loader named the object after its node instead. */
  readonly meshNameOf?: (mesh: Mesh) => string | null;
  /** Whether a child object is one part of its parent's mesh (a glTF primitive), rather than a node of its own. */
  readonly isMeshPart?: (object: Object3D) => boolean;
  readonly unitMeters?: number | null;
  readonly upAxis?: 'y' | 'z' | null;
}

interface ColoredMaterial extends Material {
  readonly color?: { readonly r: number; readonly g: number; readonly b: number };
  readonly map?: { readonly name?: string } | null;
}

/** Object types that only hold other objects; empty ones are dropped silently. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['Group', 'Object3D', 'Scene', 'Bone']);

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

export function sceneFromObject3D(
  root: Object3D,
  options: ThreeSceneOptions,
  warnings: string[],
): ImportedScene {
  const materials: ImportedMaterial[] = [];
  const materialIndex = new Map<Material, number>();
  const meshes: ImportedMesh[] = [];
  const meshIndex = new Map<string, number>();
  const nodes: ImportedNode[] = [];
  let triangles = 0;
  let skipped = 0;

  const indexOfMaterial = (material: Material | undefined): number => {
    if (!material) return -1;
    const known = materialIndex.get(material);
    if (known !== undefined) return known;
    const override = options.materialByName?.(material.name);
    if (!override && options.onlyNamedMaterials) {
      materialIndex.set(material, -1);
      return -1;
    }
    const colored = material as ColoredMaterial;
    let imported: ImportedMaterial = override ?? {
      name: material.name,
      color: colored.color
        ? { r: clamp01(colored.color.r), g: clamp01(colored.color.g), b: clamp01(colored.color.b) }
        : { r: 0.8, g: 0.8, b: 0.8 },
      opacity: material.transparent ? clamp01(material.opacity) : 1,
      textureName: options.textureNameOf?.(material) ?? colored.map?.name ?? null,
    };
    if (!override && imported.texture === undefined) {
      const texture = options.textureOf?.(material);
      if (texture) imported = { ...imported, texture };
    }
    const index = materials.push(imported) - 1;
    materialIndex.set(material, index);
    return index;
  };

  const convertMesh = (mesh: Mesh): number | null => {
    const geometry = mesh.geometry;
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const key = `${geometry.uuid}|${materialList.map((material) => material.uuid).join(',')}`;
    const known = meshIndex.get(key);
    if (known !== undefined) return known;
    const position = geometry.getAttribute('position') as BufferGeometry['attributes'][string] | undefined;
    if (!position || position.itemSize < 3) return null;
    const vertexCount = position.count;
    const index = geometry.getIndex();
    const elementCount = index ? index.count : vertexCount;
    const triangleTotal = Math.floor(elementCount / 3);
    triangles += triangleTotal;
    if (triangles > options.limits.maxTriangles) {
      throw new ImportError(
        `the model has more triangles than the import limit of ${options.limits.maxTriangles.toLocaleString('en-US')}`,
      );
    }
    const positions = new Float64Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = position.getX(i);
      positions[i * 3 + 1] = position.getY(i);
      positions[i * 3 + 2] = position.getZ(i);
    }
    const indices = new Uint32Array(triangleTotal * 3);
    for (let i = 0; i < triangleTotal * 3; i++) indices[i] = index ? index.getX(i) : i;
    const perTriangle = new Int32Array(triangleTotal);
    if (geometry.groups.length > 0 && Array.isArray(mesh.material)) {
      perTriangle.fill(-1);
      for (const group of geometry.groups) {
        const material = indexOfMaterial(materialList[group.materialIndex ?? 0]);
        const first = Math.floor(group.start / 3);
        const last = Math.min(triangleTotal, Math.floor((group.start + group.count) / 3));
        for (let t = first; t < last; t++) perTriangle[t] = material;
      }
    } else {
      perTriangle.fill(indexOfMaterial(materialList[0]));
    }
    const uv = geometry.getAttribute('uv') as BufferGeometry['attributes'][string] | undefined;
    let uvs: Float64Array | undefined;
    if (uv && uv.itemSize >= 2 && uv.count === vertexCount) {
      uvs = new Float64Array(vertexCount * 2);
      for (let i = 0; i < vertexCount; i++) {
        uvs[i * 2] = uv.getX(i);
        uvs[i * 2 + 1] = uv.getY(i);
      }
    }
    const imported = meshes.push({
      name: options.meshNameOf?.(mesh) ?? mesh.name,
      positions,
      indices,
      materials: perTriangle,
      ...(uvs ? { uvs } : {}),
    });
    meshIndex.set(key, imported - 1);
    return imported - 1;
  };

  const convertObject = (object: Object3D, depth: number): number => {
    if (depth > 256) throw new ImportError('the node hierarchy is too deep');
    if (nodes.length >= options.limits.maxNodes) {
      throw new ImportError(
        `the model has more than ${String(options.limits.maxNodes)} nodes, the import limit`,
      );
    }
    if (object.matrixAutoUpdate) object.updateMatrix();
    const nodeMeshes: number[] = [];
    const children: number[] = [];
    const node = nodes.push({
      name: object.name,
      transform: [...object.matrix.elements],
      meshes: nodeMeshes,
      children,
    });
    if (isMesh(object)) {
      const converted = convertMesh(object);
      if (converted !== null) nodeMeshes.push(converted);
    } else if (!CONTAINER_TYPES.has(object.type)) {
      skipped++;
    }
    for (const childObject of object.children) {
      if (object.matrixAutoUpdate) childObject.updateMatrix();
      // A loader often wraps each part of a mesh in an unnamed child mesh at the parent's origin; keep it in the parent.
      const inline =
        isMesh(childObject) &&
        childObject.children.length === 0 &&
        (childObject.name === '' ||
          childObject.name === object.name ||
          options.isMeshPart?.(childObject) === true) &&
        isIdentity(childObject.matrix.elements);
      if (inline) {
        const converted = convertMesh(childObject);
        if (converted !== null) nodeMeshes.push(converted);
        continue;
      }
      if (!isMesh(childObject) && !hasMeshes(childObject)) {
        if (!CONTAINER_TYPES.has(childObject.type)) skipped++;
        continue;
      }
      children.push(convertObject(childObject, depth + 1));
    }
    return node - 1;
  };

  const rootIndex = convertObject(root, 0);
  if (skipped > 0) {
    warnings.push(
      `Skipped ${String(skipped)} objects that are not triangle meshes (lines, points, cameras or lights)`,
    );
  }
  return {
    materials,
    meshes,
    nodes,
    roots: [rootIndex],
    ...(options.textures ? { textures: options.textures() } : {}),
    warnings,
    unitMeters: options.unitMeters ?? null,
    upAxis: options.upAxis ?? null,
  };
}

function hasMeshes(object: Object3D): boolean {
  let found = false;
  object.traverse((descendant) => {
    if (isMesh(descendant)) found = true;
  });
  return found;
}
