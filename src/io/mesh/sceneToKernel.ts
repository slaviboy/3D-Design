import type { DefinitionId, InstanceId, MaterialId, TagId } from '../../kernel/ids';
import { IDENTITY, invertAffine, transformPoint } from '../../kernel/math/mat4';
import { cross, length, sub, vec3, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { addDefinition, addInstance, addMaterial, removeDefinition } from '../../kernel/model/mutations';
import {
  DEFAULT_FACE_ATTRIBUTES,
  DEFAULT_INSTANCE_ATTRIBUTES,
  type FaceAttributes,
} from '../../kernel/model/types';
import { uniqueDefinitionName } from '../../kernel/ops/hierarchy';
import { insertTriangleMesh, type FaceProvenance, type TriangleMesh } from '../../kernel/ops/solids/mesh';
import { EPS_AREA } from '../../kernel/tolerance';
import { convertTransform, importConversion, isIdentity, type Conversion } from './axes';
import { validateImportedScene, type ImportedMesh, type ImportedScene } from './importedScene';
import { DEFAULT_IMPORT_LIMITS, ImportError, type ImportLimits } from './limits';

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
  readonly triangles: number;
  /** Triangles dropped because they had repeated corners or no area. */
  readonly degenerateTriangles: number;
  /** Nodes that were skipped, with the reason. */
  readonly warnings: readonly string[];
}

const byKey = (material: number): number => material + 2;

function point(positions: Float64Array, index: number): Vec3 {
  return vec3(positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0);
}

/**
 * Inserts an imported scene into `context` as one new group (or component) at the context origin, in one undoable
 * transaction. The node hierarchy becomes nested groups; a mesh drawn by several nodes becomes a component with one
 * instance per use. Units and axes are baked into the geometry so kernel tolerances stay in meters. On any error the
 * transaction is rolled back and the model is left unchanged.
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

  return doc.transact('Import', () => {
    const materialIds = new Map<number, MaterialId>();
    const materialFor = (index: number): MaterialId | null => {
      if (index < 0) return null;
      const existing = materialIds.get(index);
      if (existing !== undefined) return existing;
      const source = scene.materials[index];
      if (!source) return null;
      const reuse = [...doc.materials()].find(
        (material) =>
          material.name === source.name &&
          material.opacity === source.opacity &&
          material.color.r === source.color.r &&
          material.color.g === source.color.g &&
          material.color.b === source.color.b,
      );
      const id =
        reuse?.id ??
        addMaterial(doc, {
          name: source.name === '' ? `Material ${String(index + 1)}` : source.name,
          color: source.color,
          opacity: Math.min(1, Math.max(0, source.opacity)),
        });
      materialIds.set(index, id);
      return id;
    };

    let faces = 0;
    let groups = 0;
    let triangles = 0;
    let degenerate = 0;
    const components = new Map<string, DefinitionId | null>();

    const insertMesh = (definition: DefinitionId, mesh: ImportedMesh): boolean => {
      const vertexCount = mesh.positions.length / 3;
      const positions = new Float64Array(mesh.positions.length);
      for (let i = 0; i < vertexCount; i++) {
        const p = transformPoint(convert.matrix, point(mesh.positions, i));
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      }
      const indices: number[] = [];
      const keys: number[] = [];
      const provenance = new Map<number, FaceProvenance>();
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
        const key = byKey(material);
        if (!provenance.has(key)) {
          const id = materialFor(material);
          const attributes: FaceAttributes = {
            ...DEFAULT_FACE_ATTRIBUTES,
            frontMaterialId: id,
            backMaterialId: id,
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
        const mesh = scene.meshes[meshIndex];
        if (mesh && insertMesh(definition, mesh)) filled = true;
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
          const mesh = scene.meshes[meshIndex];
          if (mesh && insertMesh(definition, mesh)) filled = true;
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
      triangles,
      degenerateTriangles: degenerate,
      warnings,
    };
  });
}
