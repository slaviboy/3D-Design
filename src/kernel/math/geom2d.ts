import earcut from 'earcut';
import { orient2d } from 'robust-predicates';

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Exact orientation predicate built on Shewchuk's adaptive-precision arithmetic.
 * The result is positive when `c` lies to the left of the directed line `a → b` (counter-clockwise),
 * negative when it lies to the right, and exactly zero when the three points are collinear.
 */
export function orient(a: Point2, b: Point2, c: Point2): number {
  // robust-predicates uses the opposite sign convention, so negate its result.
  return -orient2d(a.x, a.y, b.x, b.y, c.x, c.y);
}

/** Signed area (shoelace formula). Positive for counter-clockwise rings. */
export function signedArea(ring: readonly Point2[]): number {
  let twiceArea = 0;
  const count = ring.length;
  for (let i = 0; i < count; i++) {
    const current = ring[i];
    const next = ring[(i + 1) % count];
    if (!current || !next) continue;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

export type RingClassification = 'inside' | 'outside' | 'boundary';

/**
 * Classifies a point against a closed ring (either orientation), using the winding number
 * with exact orientation tests.
 */
export function classifyPointInRing(p: Point2, ring: readonly Point2[]): RingClassification {
  let winding = 0;
  const count = ring.length;
  for (let i = 0; i < count; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % count];
    if (!a || !b) continue;
    const side = orient(a, b, p);
    if (
      side === 0 &&
      p.x >= Math.min(a.x, b.x) &&
      p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) &&
      p.y <= Math.max(a.y, b.y)
    ) {
      return 'boundary';
    }
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) winding++;
    } else if (b.y <= p.y && side < 0) {
      winding--;
    }
  }
  return winding === 0 ? 'outside' : 'inside';
}

/** Classifies a point against a polygon with holes: inside means inside the outer ring and outside every hole. */
export function classifyPointInPolygon(
  p: Point2,
  outer: readonly Point2[],
  holes: readonly (readonly Point2[])[],
): RingClassification {
  const outerClass = classifyPointInRing(p, outer);
  if (outerClass !== 'inside') return outerClass;
  for (const hole of holes) {
    const holeClass = classifyPointInRing(p, hole);
    if (holeClass === 'boundary') return 'boundary';
    if (holeClass === 'inside') return 'outside';
  }
  return 'inside';
}

/**
 * Triangulates a polygon with holes. Returns vertex indices into the concatenation `[...outer, ...holes.flat()]`,
 * three per triangle.
 */
export function triangulatePolygon(
  outer: readonly Point2[],
  holes: readonly (readonly Point2[])[],
): number[] {
  const coordinates: number[] = [];
  const holeIndices: number[] = [];
  for (const p of outer) coordinates.push(p.x, p.y);
  for (const hole of holes) {
    holeIndices.push(coordinates.length / 2);
    for (const p of hole) coordinates.push(p.x, p.y);
  }
  return earcut(coordinates, holeIndices.length > 0 ? holeIndices : undefined, 2);
}

/**
 * A point strictly inside a polygon with holes: the centroid of the largest triangle in its triangulation.
 * Returns `null` when the polygon has no area.
 */
export function interiorPoint(
  outer: readonly Point2[],
  holes: readonly (readonly Point2[])[],
): Point2 | null {
  const all = [...outer, ...holes.flat()];
  const indices = triangulatePolygon(outer, holes);
  let best: Point2 | null = null;
  let bestArea = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = all[indices[i] ?? -1];
    const b = all[indices[i + 1] ?? -1];
    const c = all[indices[i + 2] ?? -1];
    if (!a || !b || !c) continue;
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (area > bestArea) {
      bestArea = area;
      best = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    }
  }
  return best;
}
