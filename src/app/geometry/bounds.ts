import type { DefinitionId } from '../../kernel/ids';
import { aabbFromPoints, aabbIsEmpty, aabbUnion, EMPTY_AABB, type Aabb } from '../../kernel/math/aabb';
import { transformPoint, type Mat4 } from '../../kernel/math/mat4';
import { vec3, type Vec3 } from '../../kernel/math/vec3';
import type { ModelDocument } from '../../kernel/model/ModelDocument';

export function aabbCorners(box: Aabb): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) corners.push(vec3(x, y, z));
    }
  }
  return corners;
}

/** Axis-aligned box enclosing `box` after transforming it. */
export function transformAabb(box: Aabb, transform: Mat4): Aabb {
  if (aabbIsEmpty(box)) return box;
  return aabbFromPoints(aabbCorners(box).map((corner) => transformPoint(transform, corner)));
}

/**
 * Bounds of everything in a definition in its local coordinates, including visible nested instances.
 * Pass the same cache when computing several bounds against one unchanged document.
 */
export function definitionBounds(
  doc: ModelDocument,
  definitionId: DefinitionId,
  cache = new Map<DefinitionId, Aabb>(),
): Aabb {
  const cached = cache.get(definitionId);
  if (cached) return cached;
  cache.set(definitionId, EMPTY_AABB); // guards against (invalid) cycles
  const store = doc.store(definitionId);
  let box = aabbFromPoints([...store.vertices()].map((vertex) => vertex.position));
  for (const instance of store.instances()) {
    if (instance.attributes.hidden) continue;
    const child = definitionBounds(doc, instance.definitionId, cache);
    if (!aabbIsEmpty(child)) box = aabbUnion(box, transformAabb(child, instance.transform));
  }
  cache.set(definitionId, box);
  return box;
}
