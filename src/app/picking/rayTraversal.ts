import type { DefinitionId } from '../../kernel/ids';
import { aabbExpand, aabbFromPoints, aabbIsEmpty, type Aabb } from '../../kernel/math/aabb';
import {
  invertAffine,
  multiply,
  transformDirection,
  transformPoint,
  type Mat4,
} from '../../kernel/math/mat4';
import { add, AXIS_X, AXIS_Y, AXIS_Z, length, scale, type Vec3 } from '../../kernel/math/vec3';
import type { EntityStore } from '../../kernel/model/EntityStore';
import type { ModelDocument } from '../../kernel/model/ModelDocument';
import { isTagVisible } from '../../kernel/model/visibility';
import { worldUnitsPerPixel, type CameraState, type Ray, type ViewportSize } from '../camera/camera';
import { aabbCorners, definitionBounds } from '../geometry/bounds';
import type { EntityRef } from '../selection/Selection';

/** One definition that the ray passes near, in that definition's local coordinates. */
export interface RayVisit {
  readonly store: EntityStore;
  readonly toWorld: Mat4;
  /** `origin + direction·t` is the same point as the world ray at `t`. */
  readonly origin: Vec3;
  readonly direction: Vec3;
  /** Where the ray enters and leaves the definition's (tolerance-grown) bounds. */
  readonly start: Vec3;
  readonly end: Vec3;
  /** Local box around the ray segment, grown by the pixel tolerance. Use it to query the store's spatial index. */
  readonly box: Aabb;
  /** The top-level instance being traversed, or null for the context itself. */
  readonly topLevel: EntityRef | null;
}

/** Parameter interval where a ray is inside a box (slab method), clipped to t ≥ 0, or null when it misses. */
export function rayBoxInterval(origin: Vec3, direction: Vec3, box: Aabb): [number, number] | null {
  let near = 0;
  let far = Infinity;
  const slabs: [number, number, number, number][] = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, min, max] of slabs) {
    if (d === 0) {
      if (o < min || o > max) return null;
      continue;
    }
    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  return far >= near ? [near, far] : null;
}

function localUnitsPerWorldUnit(fromWorld: Mat4): number {
  return Math.max(
    length(transformDirection(fromWorld, AXIS_X)),
    length(transformDirection(fromWorld, AXIS_Y)),
    length(transformDirection(fromWorld, AXIS_Z)),
  );
}

/**
 * Visits the context and every visible nested definition whose bounds the ray passes within `tolerancePx` of.
 * Shared by picking and inference so both see exactly the same candidates.
 */
export function traverseAlongRay(
  doc: ModelDocument,
  context: DefinitionId,
  contextTransform: Mat4,
  camera: CameraState,
  size: ViewportSize,
  worldRay: Ray,
  tolerancePx: number,
  visit: (visit: RayVisit) => void,
): void {
  const boundsCache = new Map<DefinitionId, Aabb>();
  const walk = (definitionId: DefinitionId, toWorld: Mat4, topLevel: EntityRef | null): void => {
    const bounds = definitionBounds(doc, definitionId, boundsCache);
    const fromWorld = invertAffine(toWorld);
    if (aabbIsEmpty(bounds) || !fromWorld) return;
    const origin = transformPoint(fromWorld, worldRay.origin);
    const direction = transformDirection(fromWorld, worldRay.direction);
    const worldPerPixel = Math.max(
      ...aabbCorners(bounds).map((corner) =>
        worldUnitsPerPixel(camera, transformPoint(toWorld, corner), size),
      ),
    );
    const margin = tolerancePx * worldPerPixel * localUnitsPerWorldUnit(fromWorld);
    const interval = rayBoxInterval(origin, direction, aabbExpand(bounds, margin));
    if (!interval) return;
    const store = doc.store(definitionId);
    const start = add(origin, scale(direction, interval[0]));
    const end = add(origin, scale(direction, interval[1]));
    visit({
      store,
      toWorld,
      origin,
      direction,
      start,
      end,
      box: aabbExpand(aabbFromPoints([start, end]), margin),
      topLevel,
    });
    for (const instance of store.instances()) {
      // An instance hidden directly or by its tag hides everything inside it.
      if (instance.attributes.hidden || !isTagVisible(doc, instance.attributes.tagId)) continue;
      walk(
        instance.definitionId,
        multiply(toWorld, instance.transform),
        topLevel ?? { kind: 'instance', id: instance.id },
      );
    }
  };
  walk(context, contextTransform, null);
}
