import type { DefinitionId, FaceId, InstanceId, MaterialId } from '../../kernel/ids';
import {
  linearDeterminant,
  multiply,
  transformDirection,
  transformNormal,
  transformPoint,
  type Mat4,
} from '../../kernel/math/mat4';
import { normalize, vec3, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import type { Rgb } from '../../kernel/model/types';
import { isTagVisible } from '../../kernel/model/visibility';
import { triangulateFace } from '../../kernel/ops/triangulate';
import { convertTransform, type Conversion } from '../mesh/axes';

/*
 * The part of a model an exporter writes, in file units and file axes: one triangle mesh per (definition, inherited
 * material), reused by every instance that draws it, and a node tree with instance transforms. Faces are always
 * triangulated. Hidden entities and entities on hidden tags are left out.
 */

export interface ExportSource {
  readonly doc: ModelDocument;
  /** The definition whose contents are exported: the model root or the open group. */
  readonly context: DefinitionId;
  /** World transform of that definition. */
  readonly contextTransform: Mat4;
  /** Export only these entities of the context. Everything in it when omitted. */
  readonly selection?: { readonly faces: readonly FaceId[]; readonly instances: readonly InstanceId[] };
  /** Name of the top node (the document name). */
  readonly name: string;
}

export interface ExportMaterial {
  readonly name: string;
  /** Linear RGB. */
  readonly color: Rgb;
  readonly opacity: number;
}

export interface ExportPrimitive {
  /** Index into {@link ExportScene.materials}, or -1 for faces without a material. */
  readonly material: number;
  /** Three vertex indices per triangle, counter-clockwise seen from the front. */
  readonly indices: Uint32Array;
}

export interface ExportMesh {
  readonly name: string;
  /** x, y, z per vertex. Vertices are not shared between faces, so each face keeps its own normal. */
  readonly positions: Float64Array;
  /** Unit normal per vertex. */
  readonly normals: Float64Array;
  readonly primitives: readonly ExportPrimitive[];
}

export interface ExportNode {
  readonly name: string;
  /** Local transform relative to the parent node, column-major. */
  readonly transform: Mat4;
  readonly mesh: number | null;
  readonly children: readonly number[];
}

export interface ExportScene {
  readonly materials: readonly ExportMaterial[];
  readonly meshes: readonly ExportMesh[];
  readonly nodes: readonly ExportNode[];
  readonly roots: readonly number[];
  readonly triangles: number;
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

export function collectExportScene(source: ExportSource, conversion: Conversion): ExportScene {
  const { doc } = source;
  const materials: ExportMaterial[] = [];
  const materialIndex = new Map<MaterialId, number>();
  const meshes: ExportMesh[] = [];
  const meshCache = new Map<string, number | null>();
  const nodes: ExportNode[] = [];
  let triangles = 0;

  const indexOfMaterial = (id: MaterialId | null): number => {
    if (id === null) return -1;
    const known = materialIndex.get(id);
    if (known !== undefined) return known;
    const material = doc.material(id);
    const index = material
      ? materials.push({ name: material.name, color: material.color, opacity: material.opacity }) - 1
      : -1;
    materialIndex.set(id, index);
    return index;
  };

  const buildMesh = (
    definition: DefinitionId,
    inherited: MaterialId | null,
    faceFilter: ReadonlySet<FaceId> | null,
  ): number | null => {
    const store = doc.store(definition);
    const byMaterial = new Map<number, number[]>();
    const positions: number[] = [];
    const normals: number[] = [];
    const faces = [...store.faces()].sort((a, b) => a.id - b.id);
    for (const face of faces) {
      if (!face.plane || face.attributes.hidden || !isTagVisible(doc, face.attributes.tagId)) continue;
      if (faceFilter && !faceFilter.has(face.id)) continue;
      const triangulation = triangulateFace(store, face.id);
      const normal = normalize(transformDirection(conversion.matrix, face.plane.normal)) ?? vec3(0, 0, 1);
      const base = positions.length / 3;
      for (const vertex of triangulation.vertices) {
        const p = transformPoint(conversion.matrix, store.position(vertex));
        positions.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
      }
      const material = indexOfMaterial(face.attributes.frontMaterialId ?? inherited);
      const list = byMaterial.get(material) ?? [];
      for (const index of triangulation.indices) list.push(base + index);
      byMaterial.set(material, list);
    }
    if (positions.length === 0) return null;
    const primitives = [...byMaterial]
      .filter(([, list]) => list.length >= 3)
      .map(([material, list]) => ({ material, indices: Uint32Array.from(list) }));
    for (const primitive of primitives) triangles += primitive.indices.length / 3;
    return (
      meshes.push({
        name: doc.getDefinition(definition).attributes.name,
        positions: Float64Array.from(positions),
        normals: Float64Array.from(normals),
        primitives,
      }) - 1
    );
  };

  const meshFor = (definition: DefinitionId, inherited: MaterialId | null): number | null => {
    const key = `${String(definition)}:${String(inherited)}`;
    if (!meshCache.has(key)) meshCache.set(key, buildMesh(definition, inherited, null));
    return meshCache.get(key) ?? null;
  };

  const addNode = (
    definition: DefinitionId,
    name: string,
    transform: Mat4,
    inherited: MaterialId | null,
    instances: readonly InstanceId[] | null,
    faceFilter: ReadonlySet<FaceId> | null,
    depth: number,
  ): number | null => {
    if (depth > 256) throw new ExportError('The model hierarchy is too deep to export');
    const store = doc.store(definition);
    const mesh = faceFilter ? buildMesh(definition, inherited, faceFilter) : meshFor(definition, inherited);
    const children: number[] = [];
    const childIds = instances ?? [...store.instances()].map((instance) => instance.id);
    for (const id of [...childIds].sort((a, b) => a - b)) {
      const instance = store.instance(id);
      if (!instance || instance.attributes.hidden || !isTagVisible(doc, instance.attributes.tagId)) continue;
      const child = addNode(
        instance.definitionId,
        instance.attributes.name === ''
          ? doc.getDefinition(instance.definitionId).attributes.name
          : instance.attributes.name,
        convertTransform(conversion, instance.transform),
        instance.attributes.materialId ?? inherited,
        null,
        null,
        depth + 1,
      );
      if (child !== null) children.push(child);
    }
    if (mesh === null && children.length === 0) return null;
    return nodes.push({ name, transform, mesh, children }) - 1;
  };

  const selection = source.selection;
  const root = addNode(
    source.context,
    source.name,
    convertTransform(conversion, source.contextTransform),
    null,
    selection ? selection.instances : null,
    selection ? new Set(selection.faces) : null,
    0,
  );
  if (root === null || triangles === 0) {
    throw new ExportError(
      selection ? 'The selection has no visible faces to export' : 'The model has no visible faces to export',
    );
  }
  return { materials, meshes, nodes, roots: [root], triangles };
}

export interface FlatObject {
  readonly name: string;
  /** Nine coordinates per triangle, in file space. */
  readonly positions: Float64Array;
  /** Three coordinates per triangle. */
  readonly normals: Float64Array;
  /** Per triangle, a material index or -1. */
  readonly materials: Int32Array;
}

/** Every node's mesh transformed into file space, one object per node that draws a mesh. For OBJ and STL. */
export function flattenScene(scene: ExportScene): FlatObject[] {
  const objects: FlatObject[] = [];
  const visit = (nodeIndex: number, parent: Mat4 | null): void => {
    const node = scene.nodes[nodeIndex];
    if (!node) return;
    const world = parent ? multiply(parent, node.transform) : node.transform;
    const mesh = node.mesh === null ? undefined : scene.meshes[node.mesh];
    if (mesh) {
      const mirrored = linearDeterminant(world) < 0;
      let count = 0;
      for (const primitive of mesh.primitives) count += primitive.indices.length / 3;
      const positions = new Float64Array(count * 9);
      const normals = new Float64Array(count * 3);
      const materials = new Int32Array(count);
      const at = (index: number): Vec3 =>
        vec3(
          mesh.positions[index * 3] ?? 0,
          mesh.positions[index * 3 + 1] ?? 0,
          mesh.positions[index * 3 + 2] ?? 0,
        );
      let t = 0;
      for (const primitive of mesh.primitives) {
        for (let k = 0; k + 2 < primitive.indices.length; k += 3) {
          const a = primitive.indices[k] ?? 0;
          const b = primitive.indices[mirrored ? k + 2 : k + 1] ?? 0;
          const c = primitive.indices[mirrored ? k + 1 : k + 2] ?? 0;
          [a, b, c].forEach((index, corner) => {
            const p = transformPoint(world, at(index));
            positions[t * 9 + corner * 3] = p.x;
            positions[t * 9 + corner * 3 + 1] = p.y;
            positions[t * 9 + corner * 3 + 2] = p.z;
          });
          const localNormal = vec3(
            mesh.normals[a * 3] ?? 0,
            mesh.normals[a * 3 + 1] ?? 0,
            mesh.normals[a * 3 + 2] ?? 1,
          );
          const worldNormal = transformNormal(world, localNormal);
          const n = (worldNormal ? normalize(worldNormal) : null) ?? vec3(0, 0, 1);
          normals[t * 3] = n.x;
          normals[t * 3 + 1] = n.y;
          normals[t * 3 + 2] = n.z;
          materials[t] = primitive.material;
          t++;
        }
      }
      objects.push({ name: node.name, positions, normals, materials });
    }
    for (const child of node.children) visit(child, world);
  };
  for (const root of scene.roots) visit(root, null);
  return objects;
}
